/**
 * valuationEngine.ts — 三层 Fallback 基金估值引擎
 *
 * Layer 1: fundcomapi.tiantianfunds.com — 官方估值，CORS *，批量 50 只
 * Layer 2: stock.finance.sina.com.cn — 估值曲线 JSONP，取末点
 * Layer 3: 自算估值 — 跟踪标的/重仓股加权 + β 回归校准（TODO）
 *
 * 每只基金返回 { estimate?, change?, source, time? }，GSZ 为 null 自动降级。
 */

// ---- Types ----

export interface ValuationResult {
  estimate?: number   // gsz — 估算净值
  change?: number     // gszzl — 估算涨跌幅 %
  source: 'eastmoney' | 'sina' | 'self_calc'
  time?: string       // gztime — 估值时间
}

// ---- Layer 1: tiantianfunds batch API ----

const L1_URL = 'https://fundcomapi.tiantianfunds.com/mm/newCore/FundValuationLast'
const L1_BATCH_SIZE = 50
const L1_FIELDS = 'FCODE,SHORTNAME,GSZZL,GZTIME,GSZ,NAV,PDATE'

interface L1Item {
  FCODE: string
  SHORTNAME?: string
  GSZ?: number | null
  GSZZL?: number | null
  GZTIME?: string | null
  NAV?: number
  PDATE?: string
}

interface L1Response {
  data: L1Item[]
  errorCode: number
  success: boolean
  totalCount: number
}

// Simple in-memory cache (TTL: 30 seconds during trading, 5 min otherwise)
const l1Cache = new Map<string, { data: ValuationResult; ts: number }>()

/** Last batch result, keyed by code. Populated by preFetchValuations, read by fetchLatestNav. */
let lastBatchResult: Map<string, ValuationResult> | null = null

/** Populate lastBatchResult with fresh L1 data for the given codes */
export async function preFetchAndStore(codes: string[]): Promise<void> {
  l1Cache.clear()
  lastBatchResult = await fetchValuationBatch(codes)
}

/** Read pre-fetched L1 estimate for a single code */
export function getPreFetchedEstimate(code: string): ValuationResult | null {
  return lastBatchResult?.get(code) ?? null
}

/** Clear all cached valuations — call before force refresh */
export function clearValuationCache(): void {
  l1Cache.clear()
  lastBatchResult = null
}
const L1_TTL_ACTIVE = 30_000
const L1_TTL_IDLE = 300_000

export function isTradingHoursStrict(): boolean {
  const now = new Date()
  const day = now.getDay()
  if (day === 0 || day === 6) return false
  const h = now.getHours()
  const m = now.getMinutes()
  const t = h * 60 + m
  // 9:15-15:00 trading window (includes pre-market at 9:15)
  return t >= 555 && t <= 900
}

export async function fetchValuationBatch(codes: string[]): Promise<Map<string, ValuationResult>> {
  const results = new Map<string, ValuationResult>()
  const now = Date.now()
  const ttl = isTradingHoursStrict() ? L1_TTL_ACTIVE : L1_TTL_IDLE

  // Check cache first
  const uncached: string[] = []
  for (const c of codes) {
    const cached = l1Cache.get(c)
    if (cached && now - cached.ts < ttl) {
      results.set(c, cached.data)
    } else {
      uncached.push(c)
    }
  }

  if (uncached.length === 0) return results

  // Batch fetch (50 per request)
  for (let i = 0; i < uncached.length; i += L1_BATCH_SIZE) {
    const batch = uncached.slice(i, i + L1_BATCH_SIZE)
    try {
      const url = `${L1_URL}?FCODES=${batch.join(',')}&FIELDS=${L1_FIELDS}`
      const resp = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(10_000) })
      if (!resp.ok) continue

      const json: L1Response = await resp.json()
      if (!json.success || !json.data) continue

      for (const item of json.data) {
        const code = item.FCODE
        // Check if estimate data is actually present (not null)
        if (item.GSZ != null && item.GSZZL != null) {
          const result: ValuationResult = {
            estimate: item.GSZ,
            change: item.GSZZL,
            source: 'eastmoney',
            time: item.GZTIME ?? undefined,
          }
          results.set(code, result)
          l1Cache.set(code, { data: result, ts: Date.now() })
        } else {
          // GSZ is null → cache the "no data" result to avoid repeated L1 calls
          const result: ValuationResult = { source: 'eastmoney' }
          results.set(code, result)
          l1Cache.set(code, { data: result, ts: Date.now() })
        }
      }
    } catch (err) {
      console.warn(`[valuationEngine] L1 batch failed for ${batch.length} codes:`, err)
    }
  }

  return results
}

// ---- Layer 2: Sina estimate curve (JSONP) ----

const L2_URL = 'https://stock.finance.sina.com.cn/fundInfo/api/openapi.php/FdFundService.getEstimateNetworthPic'

interface L2Response {
  result?: {
    status?: { code?: number }
    data?: {
      worth?: string
      worth_rate?: number
      worth_date?: string
      networth?: Array<{
        min_time?: string
        pre_nav?: string | number | null
        nav_pct?: string | number | null
        pre_nav2?: string | number | null
        nav2_pct?: string | number | null
        pre_date?: string
      }>
    }
  }
}

function toNum(v: string | number | null | undefined): number | null {
  if (v == null || v === '' || v === '---') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return isNaN(n) ? null : n
}

function jsonpSina(url: string, timeout = 8000): Promise<L2Response> {
  return new Promise((resolve, reject) => {
    const callbackName = '__sina_est_' + Math.random().toString(36).slice(2)
    const script = document.createElement('script')
    let settled = false

    const timer = setTimeout(() => {
      settled = true
      cleanup()
      reject(new Error('新浪估值超时'))
    }, timeout)

    function cleanup() {
      clearTimeout(timer)
      if (script.parentNode) script.parentNode.removeChild(script)
      try { delete (window as any)[callbackName] } catch { /* */ }
    }

    ;(window as any)[callbackName] = (data: L2Response) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(data)
    }

    script.src = `${url}&callback=${callbackName}`
    script.onerror = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('新浪估值网络错误'))
    }

    document.head.appendChild(script)
  })
}

export async function fetchSinaEstimate(code: string): Promise<ValuationResult | null> {
  try {
    const url = `${L2_URL}?symbol=${code}`
    const raw = await jsonpSina(url)

    if (raw?.result?.status?.code !== 0) return null
    const d = raw.result?.data
    const curve = d?.networth
    if (!curve || curve.length === 0) return null

    // Take the LAST point of the intraday estimate curve
    const last = curve[curve.length - 1]
    const nav = toNum(last.pre_nav)
    const pct = toNum(last.nav_pct)  // Already in percentage (e.g. 1.63 = +1.63%)
    if (nav == null || pct == null) return null

    return {
      estimate: nav,
      change: pct,
      source: 'sina',
      time: last.pre_date || new Date().toISOString().slice(0, 10),
    }
  } catch {
    return null
  }
}

// ---- Unified fetch: 3-layer fallback for a single fund ----

export async function fetchFundEstimate(
  code: string,
): Promise<ValuationResult> {
  // Layer 1: tiantianfunds batch (cached)
  const l1Results = await fetchValuationBatch([code])
  const l1 = l1Results.get(code)
  if (l1 && l1.estimate != null) return l1

  // Layer 2: Sina estimate curve
  const l2 = await fetchSinaEstimate(code)
  if (l2) return l2

  // Layer 3: Self-calc (TODO)
  // return selfCalcEstimate(code)

  // No estimate available
  return { source: 'eastmoney' }
}
