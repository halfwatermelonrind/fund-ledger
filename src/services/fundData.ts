/**
 * ============================================================
 *  fundData.ts — 基金数据源封装
 *
 *  数据来源：
 *    东方财富 api.fund.eastmoney.com  → JSONP（全量基金估值缓存，含实时估算）
 *    东方财富 fund.eastmoney.com       → Script 注入（历史净值 / 基金列表）
 *
 *  基金估值 GetFundGZList 全量一次加载（~23000 只，~13 MB），
 *  后续查询直接从内存缓存返回。
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
 * 与旧天天基金接口不同，新 API 支持自定义回调名（callback 参数），
 * 因此无需串行化，直接并发即可。
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
// 全量基金估值缓存（东方财富 FundGuZhi API）
//
// GET https://api.fund.eastmoney.com/FundGuZhi/GetFundGZList
//   ?type=1&sort=3&orderType=desc&canbuy=0
//   &pageIndex=1&pageSize=23672
//   &callback=__fundgz_cache
//
// 全量 ~23000 只基金，约 13 MB，JSONP 单次加载后内存缓存。
// 后续 fetchLatestNav 直接查缓存，毫秒级返回。
// ============================================================

interface GZFundItem {
  bzdm: string      // 基金代码
  jjjc: string      // 基金简称
  gsz?: string      // 实时估算净值
  gszzl?: string    // 估算增长率 %
  dwjz: string      // 确认单位净值
  jzzzl?: string    // 确认净值增长率 %
  gzrq: string      // 估值日期 YYYY-MM-DD
  gxrq: string      // 更新日期 YYYY-MM-DD
  sgzt?: string     // 申购状态
  shzt?: string     // 赎回状态
}

interface GZListResponse {
  Data: {
    list: GZFundItem[]
    gzrq: string
    gxrq: string
  }
  ErrCode: number
  TotalCount: number
}

interface FundGZEntry {
  name: string
  nav: number          // dwjz (0 if API returned ---)
  date: string         // gzrq
  estimate?: number    // gsz
  change?: number      // gszzl
  navChange?: number   // jzzzl
  time: string         // gxrq
  navIsValid: boolean  // true if API actually provided dwjz
}

let fundGZCache: Map<string, FundGZEntry> | null = null
let fundGZLoading: Promise<void> | null = null
let cacheLoadTime: number = 0
let snapshotMeta: { gzrq: string; gxrq: string; loadTime: number } | null = null

const FUNDGZ_CALLBACK = '__fundgz_cache_cb'
const FUNDGZ_PAGE_SIZE = 23672  // 全量一次拉取
const CACHE_TTL_TRADING = 5 * 60 * 1000   // 盘中 5 分钟刷新
const CACHE_TTL_IDLE    = 30 * 60 * 1000  // 非交易时段 30 分钟

/** Parse a numeric string, treating non-numeric sentinels (---, --, etc.) as null */
function parseNum(s?: string): number | undefined {
  if (s == null || s === '') return undefined
  // Reject anything that isn't a plain number (e.g. '---', '--', 'N/A')
  if (!/^-?\d/.test(s)) return undefined
  const n = parseFloat(s)
  return isNaN(n) ? undefined : n
}

function isCacheExpired(): boolean {
  if (!fundGZCache) return true
  const ttl = isTradingHours() ? CACHE_TTL_TRADING : CACHE_TTL_IDLE
  return Date.now() - cacheLoadTime > ttl
}

async function loadFundGZCache(force = false): Promise<void> {
  if (!force && fundGZCache && !isCacheExpired()) return
  if (fundGZLoading) return fundGZLoading

  fundGZLoading = (async () => {
    if (!isBrowser) {
      fundGZCache = buildMockCache()
      cacheLoadTime = Date.now()
      return
    }

    // Try sources in order:
    //  1. Static JSON snapshot (GitHub Actions, same-origin — no Referer issue)
    //  2. Vite dev proxy → direct API (works in local dev)
    //  3. Falls back to pingzhongdata (confirmed NAV only)
    let loaded = false

    // ---- Source 1: static snapshot from GitHub Actions ----
    try {
      loaded = await tryLoadStaticJSON()
    } catch (_) { /* fall through */ }

    // ---- Source 2: JSONP direct API (dev proxy or direct) ----
    if (!loaded) {
      try {
        loaded = await tryLoadJSONP()
      } catch (_) { /* fall through */ }
    }

    // If neither worked, cache stays null → fetchLatestNav falls back to pingzhongdata
    if (!loaded) {
      console.warn('[fundData] FundGuZhi unavailable — estimates will not be available')
      fundGZLoading = null
    }
  })()

  return fundGZLoading
}

// Compact JSON format produced by GitHub Actions workflow
interface GZSnapshot {
  gzrq: string
  gxrq: string
  funds: {
    c: string         // code
    n: string         // name
    e?: string        // estimate NAV
    ez?: string       // estimate change %
    v: string         // confirmed NAV
    vz?: string       // confirmed change %
    d: string         // NAV date
    t: string         // update time
  }[]
}

async function tryLoadStaticJSON(): Promise<boolean> {
  const snapshotUrl = import.meta.env.BASE_URL + 'data/fundgz.json?_=' + Date.now()
  console.log(`[fundData] trying static snapshot: ${snapshotUrl}`)
  const t0 = Date.now()

  const resp = await fetch(snapshotUrl, { cache: 'no-store' })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)

  // Use file's Last-Modified as the authoritative update time
  const fileTime = resp.headers.get('Last-Modified')
  const loadTime = fileTime ? new Date(fileTime).getTime() : Date.now()

  const raw: GZSnapshot = await resp.json()
  if (!raw.funds || raw.funds.length === 0) throw new Error('empty snapshot')

  const cache = new Map<string, FundGZEntry>()
  for (const f of raw.funds) {
    if (!f.c || !f.n) continue
    cache.set(f.c, {
      name: f.n,
      nav: parseNum(f.v) ?? 0,
      date: f.d || raw.gzrq || '',
      estimate: parseNum(f.e),
      change: parseNum(f.ez),
      navChange: parseNum(f.vz),
      time: f.t || raw.gxrq || '',
      // Track whether the confirmed NAV was actually present
      navIsValid: parseNum(f.v) != null,
    })
  }

  fundGZCache = cache
  cacheLoadTime = loadTime
  snapshotMeta = { gzrq: raw.gzrq, gxrq: raw.gxrq, loadTime }
  fundGZLoading = null
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  const sizeKB = Math.round(JSON.stringify(raw).length / 1024)
  console.log(`[fundData] static snapshot loaded: ${cache.size} funds, ${sizeKB} KB in ${elapsed}s`)
  return true
}

async function tryLoadJSONP(): Promise<boolean> {
  const baseUrl = import.meta.env.VITE_FUNDGZ_PROXY
    || (import.meta.env.DEV ? '/api/fundgz' : 'https://api.fund.eastmoney.com')

  const url = [
    `${baseUrl}/FundGuZhi/GetFundGZList`,
    '?type=1&sort=3&orderType=desc&canbuy=0',
    `&pageIndex=1&pageSize=${FUNDGZ_PAGE_SIZE}`,
    `&callback=${FUNDGZ_CALLBACK}`,
    `&_=${Date.now()}`,
  ].join('')

  const isRefresh = !!fundGZCache
  console.log(`[fundData] ${isRefresh ? 'refreshing' : 'loading'} FundGuZhi via JSONP...`)
  const t0 = Date.now()

  const raw = await jsonp<GZListResponse>(url, FUNDGZ_CALLBACK, 30_000)

  if (raw.ErrCode !== 0 || !raw.Data?.list) {
    throw new Error(`FundGuZhi API ErrCode=${raw.ErrCode}`)
  }

  const cache = new Map<string, FundGZEntry>()
  for (const item of raw.Data.list) {
    if (!item.bzdm || !item.jjjc) continue
    cache.set(item.bzdm, {
      name: item.jjjc,
      nav: parseNum(item.dwjz) ?? 0,
      date: item.gzrq || '',
      estimate: parseNum(item.gsz),
      change: parseNum(item.gszzl),
      navChange: parseNum(item.jzzzl),
      time: item.gxrq || '',
      navIsValid: parseNum(item.dwjz) != null,
    })
  }

  fundGZCache = cache
  cacheLoadTime = Date.now()
  fundGZLoading = null
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`[fundData] JSONP cache ready: ${cache.size} funds in ${elapsed}s`)
  return true
}

// ============================================================
// fetchLatestNav
//
// 优先从 FundGuZhi 全量缓存查找（含实时估值）。
// 缓存未命中时降级到东方财富 pingzhongdata。
// ============================================================

export async function fetchLatestNav(fundCode: string): Promise<FundNavData> {
  if (!isBrowser) {
    return mockLatestNav(fundCode)
  }

  // ---- Step 1: 尝试从 FundGuZhi 缓存获取 ----
  let fromCache: FundNavData | null = null
  try {
    await loadFundGZCache()
    const entry = fundGZCache?.get(fundCode)

    if (entry && entry.name) {
      fromCache = {
        name: entry.name,
        nav: entry.nav,
        date: entry.date,
        estimate: entry.estimate,
        change: entry.change,
        navChange: entry.navChange,
        time: entry.time,
      }
    }
  } catch (_cacheErr) {
    console.warn(`[fundData] FundGuZhi cache unavailable`)
  }

  // ---- Step 2: 从 pingzhongdata 补充最新净值和涨跌幅 ----
  // QDII 等基金 FundGuZhi 可能 dwjz=---（navIsValid=false），必须从 pingzhongdata 补充
  if (fromCache) {
    const needSupplement = !fromCache.navIsValid || fromCache.navChange == null
    if (needSupplement) {
      const supplement = await trySupplementFromPingzhong(fundCode)
      if (supplement) {
        // navChange: prefer API value if available, else compute from pingzhongdata
        if (fromCache.navChange == null) {
          fromCache.navChange = supplement.navChange
        }
        // NAV: use pingzhongdata if FundGuZhi had no valid NAV, or if it's newer
        if (!fromCache.navIsValid || supplement.date > fromCache.date) {
          fromCache.nav = supplement.nav
          fromCache.date = supplement.date
        }
      }
    }
  }

  if (fromCache) return fromCache

  // ---- Step 3: 缓存完全未命中，降级到 pingzhongdata ----
  try {
    const fallback = await tryPingzhongFull(fundCode)
    if (fallback) return fallback
  } catch (err) {
    const msg = err instanceof Error ? err.message : '未知错误'
    throw new Error(`无法获取基金 ${fundCode} 的数据：${msg}`)
  }

  throw new Error(`无法获取基金 ${fundCode} 的数据`)
}

/** Fetch the last 2 NAV points from pingzhongdata to compute navChange */
async function trySupplementFromPingzhong(fundCode: string): Promise<{ nav: number; date: string; navChange?: number } | null> {
  if (!isBrowser) return null
  try {
    const url = `https://fund.eastmoney.com/pingzhongdata/${fundCode}.js?v=${Date.now()}`
    await injectScript(url)
    const trend = (window as any).Data_netWorthTrend as NetWorthPoint[] | undefined
    if (!trend || trend.length < 2) return null

    const latest = trend[trend.length - 1]
    const d = new Date(latest.x + 8 * 60 * 60 * 1000)
    const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`

    const prev = trend[trend.length - 2]
    const navChange = prev.y > 0
      ? Math.round((latest.y - prev.y) / prev.y * 10000) / 100
      : undefined

    return { nav: latest.y, date, navChange }
  } catch {
    return null
  }
}

/** Full fallback when fund is not in FundGuZhi cache at all */
async function tryPingzhongFull(fundCode: string): Promise<FundNavData | null> {
  if (!isBrowser) return null
  const url = `https://fund.eastmoney.com/pingzhongdata/${fundCode}.js?v=${Date.now()}`
  await injectScript(url)

  const eastName = (window as any).fS_name as string | undefined
  const trend = (window as any).Data_netWorthTrend as NetWorthPoint[] | undefined

  if (!eastName || !trend || trend.length === 0) return null

  const latest = trend[trend.length - 1]
  const d = new Date(latest.x + 8 * 60 * 60 * 1000)
  const date = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`

  let navChange: number | undefined
  if (trend.length >= 2) {
    const prev = trend[trend.length - 2]
    if (prev.y > 0) {
      navChange = Math.round((latest.y - prev.y) / prev.y * 10000) / 100
    }
  }

  return { name: eastName, nav: latest.y, date, navChange }
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

/** Snapshot metadata — when the underlying data was published */
export function getSnapshotMeta(): { gzrq: string; gxrq: string; loadTime: number } | null {
  return snapshotMeta
}

/** Force reload the fund estimate cache (bypasses TTL) */
export async function refreshEstimateCache(): Promise<void> {
  await loadFundGZCache(true)
}

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

function buildMockCache(): Map<string, FundGZEntry> {
  const cache = new Map<string, FundGZEntry>()
  for (const [code, data] of Object.entries(MOCK_NAV)) {
    cache.set(code, {
      name: data.name,
      nav: data.nav,
      date: data.date,
      estimate: data.estimate,
      change: data.change,
      navChange: data.navChange,
      time: data.time || data.date,
      navIsValid: true,
    })
  }
  return cache
}

async function mockLatestNav(fundCode: string): Promise<FundNavData> {
  // 优先从 mock 缓存查
  if (!fundGZCache) fundGZCache = buildMockCache()
  const entry = fundGZCache.get(fundCode)
  if (entry) {
    return {
      name: entry.name,
      nav: entry.nav,
      date: entry.date,
      estimate: entry.estimate,
      change: entry.change,
      navChange: entry.navChange,
      time: entry.time,
    }
  }
  throw new Error(`无法获取基金 ${fundCode} 的净值数据（mock）`)
}

async function mockHistoryNav(fundCode: string): Promise<HistoryNavPoint[]> {
  return MOCK_HISTORY[fundCode] ?? []
}

function getMockFundList(): FundSearchItem[] {
  return Object.entries(MOCK_NAV).map(([code, data]) => ({ code, name: data.name }))
}
