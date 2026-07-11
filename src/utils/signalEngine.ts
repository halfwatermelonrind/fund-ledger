/**
 * signalEngine.ts — R1-R8 v2.0 交易信号规则引擎
 *
 * 已实现：R5（分步清仓）、R1（动态缓冲防线）、R4（利润保护）、R8（时间止损）、R3（浮盈加仓）
 * 跳过：  R6（倒金字塔）、R7（趋势确认）、R2（单笔止损）
 *
 * 阈值：统一 -3%（不区分基金类型）
 * R_max：方案 B（localStorage 持久化）+ 首次打开用东方财富历史净值回填
 */

import type { Transaction, Position } from '../types'
import type { NavEntry } from './calculator'
import { aggregatePositions } from './calculator'

// ============================================================
// Types
// ============================================================

export type SignalDirection = 'reduce' | 'add' | 'watch'
export type SignalType = 'action' | 'watch'
export type SignalPriority = '最高' | '高' | '中' | '接近' | '缓冲期'

export interface SignalDetail {
  label: string
  value: string
  cls?: string
}

export interface Signal {
  type: SignalType
  dir: SignalDirection
  rule: string
  prio: SignalPriority
  fundCode: string
  fundName: string
  title: string
  detail: SignalDetail[]
}

// ============================================================
// Constants
// ============================================================

const R1_THRESHOLD = -3       // unified -3% threshold
const R1_BUFFER_DAYS = 20     // 20 trading day buffer
const R5_TIER1 = -10
const R5_TIER2 = -15
const R5_TIER3 = -20
const R4_RMAX_MIN = 10         // R_max must exceed 10%
const R8_MONTH6 = 180          // ~6 months in days
const R8_MONTH12 = 365         // ~12 months in days
const R8_RATE = -3             // must be < -3%
const R3_RMAX_MAX = 15         // R_max < 15% to allow adding

const PRIORITY_ORDER: Record<SignalPriority, number> = {
  '最高': 0, '高': 1, '中': 2, '接近': 3, '缓冲期': 4,
}

// ============================================================
// Helpers
// ============================================================

function pnlText(rate: number): string {
  return (rate >= 0 ? '+' : '') + rate.toFixed(2) + '%'
}

function pnlCls(rate: number): string {
  return rate > 0 ? 'pnl-up' : rate < 0 ? 'pnl-down' : 'pnl-zero'
}

function getBuildDate(transactions: Transaction[], fundCode: string): Date | null {
  const txs = transactions
    .filter((t) => t.fundCode === fundCode)
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
  return txs.length > 0 ? new Date(txs[0].tradeDate) : null
}

function getBuildDays(transactions: Transaction[], fundCode: string): number {
  const d = getBuildDate(transactions, fundCode)
  if (!d) return 0
  return Math.floor((Date.now() - d.getTime()) / 86400000)
}

/**
 * Compute R_max from Eastmoney history data.
 * Walks through all historical NAV points from the earliest buy date,
 * computes what the yield rate would have been at each point,
 * and returns the maximum.
 */
function computeRMaxFromHistory(
  pos: Position,
  historyNavs: HistoryNavPoint[],
  buildDate: Date,
): number {
  if (historyNavs.length === 0) return pos.totalProfitRate

  let maxRate = -Infinity
  const costPerShare = pos.totalShares > 0 ? pos.totalCost / pos.totalShares : 0

  for (const pt of historyNavs) {
    if (new Date(pt.date) < buildDate) continue
    if (costPerShare <= 0 || pt.nav <= 0) continue
    const rate = ((pt.nav - costPerShare) / costPerShare) * 100
    if (rate > maxRate) maxRate = rate
  }

  return maxRate > -Infinity ? Math.round(maxRate * 100) / 100 : pos.totalProfitRate
}

interface HistoryNavPoint {
  date: string
  nav: number
}

// ============================================================
// R_max Management
// ============================================================

const RMAX_KEY = 'fund-ledger-rmax'

function loadRMax(): Record<string, number> {
  try {
    const raw = localStorage.getItem(RMAX_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

function saveRMax(data: Record<string, number>): void {
  localStorage.setItem(RMAX_KEY, JSON.stringify(data))
}

export function getRMax(fundCode: string): number {
  return loadRMax()[fundCode] ?? 0
}

export function updateRMax(fundCode: string, currentRate: number): void {
  const data = loadRMax()
  const prev = data[fundCode] ?? 0
  if (currentRate > prev) {
    data[fundCode] = Math.round(currentRate * 100) / 100
    saveRMax(data)
  }
}

export function seedRMaxFromHistory(
  fundCode: string,
  pos: Position,
  transactions: Transaction[],
  historyNavs: HistoryNavPoint[],
): number {
  const buildDate = getBuildDate(transactions, fundCode)
  if (!buildDate) return pos.totalProfitRate
  const rmax = computeRMaxFromHistory(pos, historyNavs, buildDate)
  const data = loadRMax()
  if (!data[fundCode] || rmax > data[fundCode]) {
    data[fundCode] = rmax
    saveRMax(data)
  }
  return data[fundCode]
}

// ============================================================
// Main compute function
// ============================================================

export function computeSignals(
  transactions: Transaction[],
  navCache: Record<string, NavEntry>,
  historyNavs?: Record<string, HistoryNavPoint[]>,
): Signal[] {
  const positions = aggregatePositions(transactions, navCache)
  const signals: Signal[] = []

  for (const pos of positions) {
    if (pos.isCleared) continue
    if (pos.totalCost <= 0) continue

    const rate = pos.totalProfitRate // current yield rate %
    const buildDays = getBuildDays(transactions, pos.fundCode)

    // R_max: try stored value first, seed from history if available
    let rMax = getRMax(pos.fundCode)
    if (rMax === 0 && historyNavs?.[pos.fundCode]) {
      rMax = seedRMaxFromHistory(pos.fundCode, pos, transactions, historyNavs[pos.fundCode])
    }
    // Update and sync local variable
    if (rate > rMax) {
      updateRMax(pos.fundCode, rate)
      rMax = rate
    }

    let r5Triggered = false

    // ---- R5: 分步清仓线（最高优先级）----
    const r5Result = evaluateR5(pos, rate)
    if (r5Result) {
      signals.push(r5Result)
      r5Triggered = r5Result.title.includes('第三档') // tier 3 means fully cleared
    }

    if (r5Triggered) continue // R5 tier 3: skip other rules

    // ---- R1: 动态缓冲防线 ----
    const r1Result = evaluateR1(pos, rate, buildDays)
    if (r1Result) signals.push(r1Result)

    // ---- R4: 利润保护线 ----
    const r4Result = evaluateR4(pos, rate, rMax)
    if (r4Result) signals.push(r4Result)

    // ---- R8: 时间止损 ----
    const r8Result = evaluateR8(pos, rate, buildDays)
    if (r8Result) signals.push(r8Result)

    // ---- R2: 单笔5%止损 ----
    const r2Result = evaluateR2(pos, transactions, navCache)
    if (r2Result) signals.push(r2Result)

    // ---- R3: 浮盈加仓控制 ----
    const r3Result = evaluateR3(pos, rate, rMax)
    if (r3Result) signals.push(r3Result)
  }

  signals.sort((a, b) => PRIORITY_ORDER[a.prio] - PRIORITY_ORDER[b.prio])
  return signals
}

// ============================================================
// Individual rule evaluators
// ============================================================

function evaluateR5(pos: Position, rate: number): Signal | null {
  let tier: number, threshold: number, action: string
  if (rate < R5_TIER3) { tier = 3; threshold = R5_TIER3; action = '清仓剩余仓位' }
  else if (rate < R5_TIER2) { tier = 2; threshold = R5_TIER2; action = '再减仓 50%（剩余 25%）' }
  else if (rate < R5_TIER1) { tier = 1; threshold = R5_TIER1; action = '减仓 50%（剩余 50%）' }
  else return null

  return {
    type: 'action', dir: 'reduce', rule: 'R5', prio: '最高',
    fundCode: pos.fundCode, fundName: pos.fundName,
    title: `收益率 ${pnlText(rate)}，触发分步清仓第${['','一','二','三'][tier]}档`,
    detail: [
      { label: '规则', value: `收益率 < ${threshold}% → ${action}` },
      { label: '当前收益率', value: pnlText(rate), cls: pnlCls(rate) },
      { label: '建议操作', value: action },
      { label: '风险', value: tier < 3 ? '若不执行，继续下跌将触发下一档' : '已触及底线，建议立即清仓' },
    ],
  }
}

function evaluateR1(pos: Position, rate: number, buildDays: number): Signal | null {
  const inBuffer = buildDays < R1_BUFFER_DAYS
  const triggered = rate < R1_THRESHOLD && rate >= R5_TIER1 // below -3% but above R5

  if (!triggered && !inBuffer) return null

  if (triggered && !inBuffer) {
    return {
      type: 'action', dir: 'reduce', rule: 'R1', prio: '高',
      fundCode: pos.fundCode, fundName: pos.fundName,
      title: `收益率 ${pnlText(rate)}，跌破动态缓冲线 -3%`,
      detail: [
        { label: '规则', value: `收益率 < ${R1_THRESHOLD}% → 减仓 30%` },
        { label: '当前收益率', value: pnlText(rate), cls: pnlCls(rate) },
        { label: '建仓天数', value: `${buildDays} 天（已过 ${R1_BUFFER_DAYS} 天缓冲期）` },
        { label: '建议操作', value: '减仓 30%' },
        { label: '风险', value: '若不执行，继续下跌到 -10% 将触发 R5' },
      ],
    }
  }

  if (inBuffer && rate < 0) {
    return {
      type: 'watch', dir: 'watch', rule: 'R1', prio: '缓冲期',
      fundCode: pos.fundCode, fundName: pos.fundName,
      title: `收益率 ${pnlText(rate)}，缓冲期内（${buildDays}/${R1_BUFFER_DAYS} 天）`,
      detail: [
        { label: '规则', value: `建仓 ${R1_BUFFER_DAYS} 天内不触发 R1` },
        { label: '当前收益率', value: pnlText(rate), cls: pnlCls(rate) },
        { label: '建仓天数', value: `${buildDays} 天` },
        { label: '建议', value: '继续观察，暂不操作' },
      ],
    }
  }

  return null
}

function evaluateR4(pos: Position, rate: number, rMax: number): Signal | null {
  if (rMax <= R4_RMAX_MIN) return null
  if (rate >= rMax * 0.5) return null

  return {
    type: 'action', dir: 'reduce', rule: 'R4', prio: '高',
    fundCode: pos.fundCode, fundName: pos.fundName,
    title: `利润回撤超 50%，R_max ${pnlText(rMax)} → 当前 ${pnlText(rate)}`,
    detail: [
      { label: '规则', value: `R_max > 10% 且利润回撤 > 50% → 减仓 30%` },
      { label: '历史最高', value: pnlText(rMax), cls: pnlCls(rMax) },
      { label: '当前收益率', value: pnlText(rate), cls: pnlCls(rate) },
      { label: '建议操作', value: '减仓 30%' },
      { label: '风险', value: '若不执行，利润可能继续流失' },
    ],
  }
}

function evaluateR8(pos: Position, rate: number, buildDays: number): Signal | null {
  if (rate >= R8_RATE) return null
  if (buildDays < R8_MONTH6) return null

  if (buildDays >= R8_MONTH12) {
    return {
      type: 'action', dir: 'reduce', rule: 'R8', prio: '高',
      fundCode: pos.fundCode, fundName: pos.fundName,
      title: `持仓 ${buildDays} 天（超 12 个月），收益率仍 < -3%，建议清仓`,
      detail: [
        { label: '规则', value: '持仓满 12 个月且收益率 < -3% → 清仓' },
        { label: '持仓天数', value: `${buildDays} 天` },
        { label: '当前收益率', value: pnlText(rate), cls: pnlCls(rate) },
        { label: '建议操作', value: '清仓' },
        { label: '风险', value: '资金长期被套，机会成本持续增加' },
      ],
    }
  }

  return {
    type: 'action', dir: 'reduce', rule: 'R8', prio: '高',
    fundCode: pos.fundCode, fundName: pos.fundName,
    title: `持仓 ${buildDays} 天（超 6 个月），收益率仍 < -3%，建议减仓 50%`,
    detail: [
      { label: '规则', value: '持仓满 6 个月且收益率 < -3% → 减仓 50%' },
      { label: '持仓天数', value: `${buildDays} 天` },
      { label: '当前收益率', value: pnlText(rate), cls: pnlCls(rate) },
      { label: '建议操作', value: '减仓 50%' },
      { label: '风险', value: '若继续持仓到 12 个月，将触发清仓' },
    ],
  }
}

// ============================================================
// R2: 单笔5%止损
// ============================================================

function evaluateR2(
  pos: Position,
  transactions: Transaction[],
  navCache: Record<string, NavEntry>,
): Signal | null {
  const currentNav = navCache[pos.fundCode]?.nav
  if (!currentNav || currentNav <= 0) return null

  // Find the most recent BUY (exclude init — they represent existing holdings, not real purchases)
  const buys = transactions
    .filter((t) => t.fundCode === pos.fundCode && (t.type === 'buy' || t.type === 'dividend_reinvest'))
    .filter((t) => t.navSource !== 'init')
    .filter((t) => t.nav != null && t.nav > 0)
    .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))

  if (buys.length === 0) return null
  const lastBuy = buys[0]
  if (!lastBuy.nav) return null

  const loss = ((currentNav - lastBuy.nav) / lastBuy.nav) * 100
  if (loss > -5) return null  // not triggered

  return {
    type: 'action', dir: 'reduce', rule: 'R2', prio: '中',
    fundCode: pos.fundCode, fundName: pos.fundName,
    title: `最近加仓 ${lastBuy.tradeDate}（${lastBuy.nav.toFixed(4)}）跌至 ${currentNav.toFixed(4)}，跌幅 ${loss.toFixed(2)}%`,
    detail: [
      { label: '规则', value: '单笔加仓跌幅 ≥ 5% → 卖出该笔加仓' },
      { label: '加仓日期', value: lastBuy.tradeDate },
      { label: '加仓净值', value: lastBuy.nav.toFixed(4) },
      { label: '当前净值', value: currentNav.toFixed(4) },
      { label: '跌幅', value: `${loss.toFixed(2)}%`, cls: 'pnl-down' },
      { label: '建议操作', value: '卖出该笔加仓的全部份额' },
    ],
  }
}

function evaluateR3(pos: Position, rate: number, rMax: number): Signal | null {
  if (rate <= 0) return null // only when in profit
  if (rMax >= R3_RMAX_MAX) return null // thick profit cushion → no signal

  return {
    type: 'watch', dir: 'add', rule: 'R3', prio: '中',
    fundCode: pos.fundCode, fundName: pos.fundName,
    title: `薄利润垫（R_max ${pnlText(rMax)}），可小额加仓 ≤10%`,
    detail: [
      { label: '规则', value: `R_max < 15% → 允许加仓 ≤ 计划仓位 10%` },
      { label: 'R_max', value: pnlText(rMax), cls: pnlCls(rMax) },
      { label: '当前收益率', value: pnlText(rate), cls: pnlCls(rate) },
      { label: '建议', value: '可小幅加仓，注意控制仓位' },
    ],
  }
}
