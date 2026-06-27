/**
 * ============================================================
 *  fundData.ts — 基金数据源封装
 *
 *  数据来源：
 *    天天基金 fundgz.1234567.com.cn  → JSONP（最新净值 + 实时估值）
 *    东方财富 fund.eastmoney.com       → Script 注入（历史净值 / 基金列表）
 *
 *  所有请求 10 秒超时，失败抛出可读错误。
 *  浏览器环境使用动态 <script> 标签（无跨域限制）。
 *  Node 环境回退到内建 mock 数据（用于单元测试）。
 * ============================================================
 */

import type { FundNavData, HistoryNavPoint, FundSearchItem } from '../types'

// ============================================================
// Environment detection
// ============================================================

const isBrowser =
  typeof document !== 'undefined' &&
  typeof window !== 'undefined' &&
  typeof document.createElement === 'function'

// ============================================================
// JSONP / Script injection core (browser only)
// ============================================================

const DEFAULT_TIMEOUT = 10_000

/**
 * JSONP — 动态插入 <script>，等待全局回调被调用。
 *
 * 天天基金 API 固定回调名为 `jsonpgz`，因此并发调用必须串行化。
 * 使用一个简单的串行队列保证同一时刻只有一个 JSONP 请求进行中。
 */
function jsonp<T>(url: string, callbackName: string, timeout = DEFAULT_TIMEOUT): Promise<T> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    let settled = false

    const timer = setTimeout(() => {
      settled = true
      cleanup()
      reject(new Error('请求超时，请检查网络连接'))
    }, timeout)

    function cleanup(): void {
      clearTimeout(timer)
      if (script.parentNode) script.parentNode.removeChild(script)
      try { delete (window as any)[callbackName] } catch { /* var-declared global, can't delete in ES module */ }
    }

    (window as any)[callbackName] = (data: T) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(data)
    }

    script.src = url
    script.onerror = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('网络请求失败，请稍后重试'))
    }

    document.head.appendChild(script)
  })
}

/**
 * Script 注入 — 加载 JS 文件，读取其设置的全局变量。
 *
 * 适用于东方财富脚本（没有回调，直接将数据写到 window 上）。
 * 调用前由上层负责删除旧的全局变量以强制刷新。
 */
function injectScript(url: string, timeout = DEFAULT_TIMEOUT): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    let settled = false

    const timer = setTimeout(() => {
      settled = true
      script.remove()
      reject(new Error('请求超时，请检查网络连接'))
    }, timeout)

    script.onload = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      script.remove()
      resolve()
    }

    script.onerror = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      script.remove()
      reject(new Error('网络请求失败，请稍后重试'))
    }

    script.src = url
    document.head.appendChild(script)
  })
}

// ============================================================
// JSONP 串行化（天天基金 jsonpgz 回调是全局单例）
// ============================================================

let jsonpgzQueue: Promise<void> = Promise.resolve()

function serialJsonp<T>(url: string, timeout = DEFAULT_TIMEOUT): Promise<T> {
  const task = jsonpgzQueue.then(() => jsonp<T>(url, 'jsonpgz', timeout))
  // Swallow errors so the queue continues
  jsonpgzQueue = task.then(() => {}).catch(() => {})
  return task
}

// ============================================================
// fetchLatestNav
//
// GET https://fundgz.1234567.com.cn/js/{code}.js?rt={ts}
// 响应：jsonpgz({ fundcode, name, jzrq, dwjz, gsz, gszzl, gztime })
// ============================================================

interface JsonpgzResponse {
  fundcode: string
  name: string
  jzrq: string    // 净值日期 YYYY-MM-DD
  dwjz: string    // 单位净值
  gsz?: string    // 实时估算净值（QDII/货币基金可能缺失）
  gszzl?: string  // 估算涨跌幅 %
  gztime?: string // 估值时间 YYYY-MM-DD HH:mm
}

export async function fetchLatestNav(fundCode: string): Promise<FundNavData> {
  if (!isBrowser) {
    return mockLatestNav(fundCode)
  }

  let name = ''
  let nav = 0
  let date = ''
  let estimate: number | undefined
  let change: number | undefined
  let time: string | undefined

  // ---- Step 1: 天天基金 JSONP (fast, includes real-time estimate) ----
  let jsonpOk = false
  try {
    const url = `https://fundgz.1234567.com.cn/js/${fundCode}.js?rt=${Date.now()}`
    const raw = await serialJsonp<JsonpgzResponse>(url)

    if (!raw.name || raw.name === '') {
      throw new Error('天天基金返回空名称')
    }

    name = raw.name
    nav = parseFloat(raw.dwjz)
    date = raw.jzrq
    estimate = raw.gsz != null && raw.gsz !== '' ? parseFloat(raw.gsz) : undefined
    change = raw.gszzl != null && raw.gszzl !== '' ? parseFloat(raw.gszzl) : undefined
    time = raw.gztime || undefined
    jsonpOk = true
  } catch (_jsonpErr) {
    // Will try Eastmoney fallback below
  }

  // ---- Step 2: 东方财富补充 / 降级 ----
  // For QDII/HK funds, the JSONP NAV date may be 1-2 days behind.
  // Eastmoney pingzhongdata often has a more recent confirmed NAV.
  const today = new Date().toISOString().slice(0, 10)
  const isStale = !jsonpOk || (date && date < today)

  if (isStale) {
    if (!jsonpOk) {
      console.log(`[fundData] JSONP failed for ${fundCode}, trying Eastmoney fallback...`)
    } else {
      console.log(`[fundData] NAV date ${date} is stale, supplementing from Eastmoney...`)
    }
    try {
      const url = `https://fund.eastmoney.com/pingzhongdata/${fundCode}.js?v=${Date.now()}`
      await injectScript(url)

      const eastName = (window as any).fS_name as string | undefined
      const trend = (window as any).Data_netWorthTrend as NetWorthPoint[] | undefined

      if (eastName && trend && trend.length > 0) {
        if (!jsonpOk) name = eastName  // use Eastmoney name if JSONP didn't provide one

        const latest = trend[trend.length - 1]
        const d = new Date(latest.x + 8 * 60 * 60 * 1000)
        const eastDate = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`

        // Use Eastmoney NAV if it's more recent, or if JSONP failed entirely
        if (!jsonpOk || eastDate > date) {
          nav = latest.y
          date = eastDate
          console.log(`[fundData] Updated NAV from Eastmoney: ${name} ${date} NAV=${nav}`)
        }
      }
    } catch (_eastErr) {
      // If JSONP succeeded, Eastmoney supplement failure is non-fatal
      if (!jsonpOk) {
        throw new Error('天天基金和东方财富均不可用')
      }
    }
  }

  if (!jsonpOk && !name) {
    throw new Error(`无法获取基金 ${fundCode} 的数据`)
  }

  return { name, nav, date, estimate, change, time }
}

// ============================================================
// fetchHistoryNav
//
// GET https://fund.eastmoney.com/pingzhongdata/{code}.js
// 加载后 window.Data_netWorthTrend 变为可用：
//   [{ x: ms_timestamp, y: nav, equityReturn: number, unitMoney: ''|number }]
// ============================================================

interface NetWorthPoint {
  x: number   // 毫秒时间戳
  y: number   // 单位净值
  equityReturn: number
  unitMoney: string  // 分红金额，空字符串表示无分红
}

export async function fetchHistoryNav(fundCode: string): Promise<HistoryNavPoint[]> {
  if (!isBrowser) {
    return mockHistoryNav(fundCode)
  }

  try {
    // Can't delete var-declared globals in ES module context.
    // Just read whatever is currently set; the next script load will overwrite it.
    const url = `https://fund.eastmoney.com/pingzhongdata/${fundCode}.js?v=${Date.now()}`
    console.log(`[fundData] fetchHistoryNav: loading ${url}`)
    await injectScript(url)

    const raw = (window as any).Data_netWorthTrend as NetWorthPoint[] | undefined

    if (!raw || !Array.isArray(raw) || raw.length === 0) {
      console.warn(`[fundData] fetchHistoryNav: Data_netWorthTrend not found for ${fundCode}`)
      return []
    }

    console.log(`[fundData] fetchHistoryNav: got ${raw.length} data points for ${fundCode}`)

    const result = raw.map((pt) => {
      const d = new Date(pt.x + 8 * 60 * 60 * 1000)
      const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
      return {
        date,
        nav: pt.y,
        dividend: pt.unitMoney && pt.unitMoney !== '' ? parseFloat(pt.unitMoney as unknown as string) : undefined,
      }
    })

    // Log last few dates for debugging
    console.log(`[fundData] fetchHistoryNav: latest dates for ${fundCode}:`,
      result.slice(-3).map(p => `${p.date}=${p.nav}`))

    return result
  } catch (err) {
    console.error(`[fundData] fetchHistoryNav FAILED for ${fundCode}:`, err)
    const msg = err instanceof Error ? err.message : '未知错误'
    throw new Error(`获取 ${fundCode} 历史净值失败：${msg}`)
  }
}

// ============================================================
// searchFundName
//
// 加载全量基金列表（约 500 KB），内存缓存，后续请求直接过滤。
// GET https://fund.eastmoney.com/js/fundcode_search.js
// 全局变量 window.r = [ [code, pinyin, name, type, pinyinFull], ... ]
// ============================================================

type FundRawEntry = [string, string, string, string, string]

let fundListCache: FundSearchItem[] | null = null
let fundListLoading: Promise<void> | null = null

async function loadFundList(): Promise<void> {
  if (fundListCache) return
  if (fundListLoading) return fundListLoading

  fundListLoading = (async () => {
    if (!isBrowser) {
      fundListCache = getMockFundList()
      return
    }

    try {
      // var-declared globals can't be deleted in ES module context; just overwrite
      const url = `https://fund.eastmoney.com/js/fundcode_search.js?v=${Date.now()}`
      await injectScript(url, 15_000) // 大文件，给 15 秒

      const raw = (window as any).r as FundRawEntry[] | undefined

      if (Array.isArray(raw) && raw.length > 0) {
        fundListCache = raw.map((item) => ({
          code: item[0],
          name: item[2],
        }))
      } else {
        fundListCache = []
      }
    } catch {
      // 基金列表加载失败，使用空列表（搜索功能降级）
      fundListCache = []
    }
  })()

  return fundListLoading
}

export async function searchFundName(keyword: string): Promise<FundSearchItem[]> {
  await loadFundList()

  if (!fundListCache || fundListCache.length === 0) {
    return []
  }

  const kw = keyword.trim().toLowerCase()
  if (!kw) return fundListCache.slice(0, 20) // 空输入返回前 20 条

  // 优先匹配代码开头，其次匹配名称
  const codeMatch = fundListCache.filter((f) => f.code.startsWith(kw))
  const nameMatch = fundListCache.filter(
    (f) => !f.code.startsWith(kw) && (
      f.name.toLowerCase().includes(kw) ||
      f.code.includes(kw)
    ),
  )

  return [...codeMatch, ...nameMatch].slice(0, 30)
}

// ============================================================
// isTradingHours — A 股交易时段判断
// ============================================================

export function isTradingHours(): boolean {
  const now = new Date()
  const day = now.getDay()
  if (day === 0 || day === 6) return false
  const h = now.getHours()
  const m = now.getMinutes()
  const t = h * 60 + m
  return t >= 570 && t <= 900 // 9:30–15:00
}

// ============================================================
// Node.js fallback — mock data (unit tests / SSR)
// ============================================================

const MOCK_NAV: Record<string, FundNavData> = {
  '005827': { name: '易方达蓝筹精选混合', nav: 2.4012, date: '2026-06-20', estimate: 2.4150, change: 0.57, time: '2026-06-20 14:46' },
  '003095': { name: '中欧医疗健康混合A', nav: 1.8520, date: '2026-06-20', estimate: 1.8390, change: -0.70, time: '2026-06-20 14:46' },
  '000961': { name: '天弘沪深300ETF联接A', nav: 1.5240, date: '2026-06-20', estimate: 1.5310, change: 0.46, time: '2026-06-20 14:45' },
  '161725': { name: '招商中证白酒指数(LOF)A', nav: 1.8100, date: '2026-06-20', estimate: 1.8220, change: 0.66, time: '2026-06-20 14:46' },
  '163406': { name: '兴全合润混合(LOF)', nav: 2.1860, date: '2026-06-20', estimate: 2.1910, change: 0.23, time: '2026-06-20 14:45' },
  '011363': { name: '南方中证500ETF联接A', nav: 1.4620, date: '2026-06-20', estimate: 1.4620, change: 0, time: '2026-06-20 14:44' },
}

const MOCK_HISTORY: Record<string, HistoryNavPoint[]> = {
  '005827': [
    { date: '2026-06-18', nav: 2.3456 },
    { date: '2026-06-17', nav: 2.3400 },
    { date: '2026-06-15', nav: 2.3200 },
  ],
  '003095': [
    { date: '2026-06-17', nav: 1.8400 },
    { date: '2026-06-15', nav: 1.8300 },
  ],
}

async function mockLatestNav(fundCode: string): Promise<FundNavData> {
  const data = MOCK_NAV[fundCode]
  if (data) return { ...data }
  throw new Error(`无法获取基金 ${fundCode} 的净值数据（mock）`)
}

async function mockHistoryNav(fundCode: string): Promise<HistoryNavPoint[]> {
  return MOCK_HISTORY[fundCode] ?? []
}

function getMockFundList(): FundSearchItem[] {
  return Object.entries(MOCK_NAV).map(([code, data]) => ({ code, name: data.name }))
}
