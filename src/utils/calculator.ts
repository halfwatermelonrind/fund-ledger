/**
 * ============================================================
 *  calculator.ts — 基金持仓聚合与盈亏计算
 *
 *  核心算法：移动加权平均成本法
 *  精度策略：所有金额/份额/净值使用整数分（×100）取整，
 *           避免 JavaScript 浮点误差累积。
 * ============================================================
 */

import type { Transaction, Position } from '../types'

// ============================================================
// Precision helpers
//
// 金额 → 2 位小数（分）
// 份额 → 2 位小数（0.01 份）
// 净值 → 4 位小数（0.0001 元）
// ============================================================

const rMoney  = (n: number): number => Math.round(n * 100) / 100
const rShares = (n: number): number => Math.round(n * 100) / 100
const rNav    = (n: number): number => Math.round(n * 10000) / 10000

// ============================================================
// Internal accumulator (per-fund state while processing)
// ============================================================

interface FundAcc {
  fundCode: string
  fundName: string
  totalShares: number
  totalCost: number
  totalInvested: number
  totalSoldCash: number
  totalCashDividend: number
  realizedProfit: number
  transactions: Transaction[]
}

function createAcc(code: string, name: string): FundAcc {
  return {
    fundCode: code,
    fundName: name,
    totalShares: 0,
    totalCost: 0,
    totalInvested: 0,
    totalSoldCash: 0,
    totalCashDividend: 0,
    realizedProfit: 0,
    transactions: [],
  }
}

/**
 * Compute weighted-average cost NAV from current state.
 */
function avgCost(acc: FundAcc): number {
  return acc.totalShares > 0 ? rNav(acc.totalCost / acc.totalShares) : 0
}

// ============================================================
// Per-transaction-type apply functions
//
// Each is a pure function: FundAcc → FundAcc.
// Transactions without confirmed NAV are skipped (identity).
// ============================================================

/**
 * 买入
 *
 * confirmedShares = amount × (1 − feeRate) ÷ nav
 * totalShares    += confirmedShares
 * totalCost      += amount × (1 − feeRate)
 * totalInvested  += amount × (1 − feeRate)
 */
export function applyBuy(acc: FundAcc, tx: Transaction): FundAcc {
  const { nav, amount, feeRate } = tx
  if (nav == null || amount == null || nav <= 0 || amount <= 0) {
    return { ...acc, transactions: [...acc.transactions, tx] }
  }

  const netAmount  = rMoney(amount * (1 - feeRate))
  const shares     = rShares(netAmount / nav)

  return {
    ...acc,
    totalShares:   rShares(acc.totalShares + shares),
    totalCost:     rMoney(acc.totalCost + netAmount),
    totalInvested: rMoney(acc.totalInvested + netAmount),
    transactions:  [...acc.transactions, tx],
  }
}

/**
 * 卖出
 *
 * sellRatio       = sellShares ÷ totalShares
 * sellCost        = totalCost × sellRatio
 * sellRevenue     = sellShares × nav × (1 − feeRate)
 * realizedProfit += sellRevenue − sellCost
 * totalShares    −= sellShares
 * totalCost      −= sellCost
 * totalSoldCash  += sellRevenue
 */
export function applySell(acc: FundAcc, tx: Transaction): FundAcc {
  const { nav, shares: sellShares, feeRate } = tx
  if (nav == null || sellShares == null || nav <= 0 || sellShares <= 0) {
    return { ...acc, transactions: [...acc.transactions, tx] }
  }

  // Guard: cannot sell more than held (clamp to available)
  const effectiveShares = Math.min(sellShares, acc.totalShares)
  if (acc.totalShares <= 0) {
    return { ...acc, transactions: [...acc.transactions, tx] }
  }

  const sellRatio   = effectiveShares / acc.totalShares
  const sellCost    = rMoney(acc.totalCost * sellRatio)
  const grossRevenue = effectiveShares * nav
  const sellRevenue = rMoney(grossRevenue * (1 - feeRate))
  const realized    = rMoney(sellRevenue - sellCost)

  return {
    ...acc,
    totalShares:    rShares(Math.max(0, acc.totalShares - effectiveShares)),
    totalCost:      rMoney(Math.max(0, acc.totalCost - sellCost)),
    totalSoldCash:  rMoney(acc.totalSoldCash + sellRevenue),
    realizedProfit: rMoney(acc.realizedProfit + realized),
    transactions:   [...acc.transactions, tx],
  }
}

/**
 * 现金分红
 *
 * dividendAmount     = amount（用户录入的分红总额）
 * totalCashDividend += dividendAmount
 * 不影响 totalShares / totalCost
 */
export function applyDividendCash(acc: FundAcc, tx: Transaction): FundAcc {
  const dividendAmount = tx.amount
  if (dividendAmount == null || dividendAmount <= 0) {
    return { ...acc, transactions: [...acc.transactions, tx] }
  }

  return {
    ...acc,
    totalCashDividend: rMoney(acc.totalCashDividend + dividendAmount),
    transactions:      [...acc.transactions, tx],
  }
}

/**
 * 红利再投资
 *
 * newShares      = dividendAmount ÷ reinvestNav
 * totalShares   += newShares
 * totalCost     += dividendAmount
 * totalInvested += dividendAmount
 * （dividendAmount 在 totalCashDividend 中也会体现？PRD 未明确要求合并展示，
 *   此处保持 totalCashDividend 不变，因为红利再投资已转换为份额。）
 */
export function applyDividendReinvest(acc: FundAcc, tx: Transaction): FundAcc {
  const dividendAmount = tx.amount
  const reinvestNav = tx.nav
  if (dividendAmount == null || reinvestNav == null || dividendAmount <= 0 || reinvestNav <= 0) {
    return { ...acc, transactions: [...acc.transactions, tx] }
  }

  const newShares = rShares(dividendAmount / reinvestNav)

  return {
    ...acc,
    totalShares:   rShares(acc.totalShares + newShares),
    totalCost:     rMoney(acc.totalCost + dividendAmount),
    totalInvested: rMoney(acc.totalInvested + dividendAmount),
    transactions:  [...acc.transactions, tx],
  }
}

// ============================================================
// Transaction dispatcher
// ============================================================

function applyTransaction(acc: FundAcc, tx: Transaction): FundAcc {
  switch (tx.type) {
    case 'buy':
      return applyBuy(acc, tx)
    case 'sell':
      return applySell(acc, tx)
    case 'dividend_cash':
      return applyDividendCash(acc, tx)
    case 'dividend_reinvest':
      return applyDividendReinvest(acc, tx)
    default:
      return { ...acc, transactions: [...acc.transactions, tx] }
  }
}

// ============================================================
// Public API: aggregatePositions
// ============================================================

/** NAV input for P&L enrichment */
export interface NavEntry {
  nav: number   // latest confirmed NAV (dwjz)
  date: string  // NAV date (jzrq)
  /** Real-time estimate (display only, does not affect P&L) */
  estimate?: number
  change?: number   // 预估涨跌幅 (gszzl)
  navChange?: number // 确认净值涨跌幅 (dwjz day-over-day %)
  time?: string
}

/**
 * Aggregate confirmed transactions into fund positions.
 *
 * @param transactions - all transactions (pending ones with no nav are silently skipped)
 * @param navMap       - latest NAV per fundCode, used to compute marketValue & P&L
 * @returns Position array sorted by |totalProfit| descending (absolute value)
 */
export function aggregatePositions(
  transactions: Transaction[],
  navMap?: Record<string, NavEntry>,
): Position[] {
  // 1. Group confirmed transactions by fundCode
  const byCode = new Map<string, Transaction[]>()
  let skippedPending = 0
  let skippedNoNav = 0
  for (const tx of transactions) {
    if (tx.navSource === 'pending') { skippedPending++; continue }
    // Also skip if no nav or no amount/shares for buy/sell
    if (tx.type === 'buy' && (tx.nav == null || tx.amount == null)) { skippedNoNav++; continue }
    if (tx.type === 'sell' && (tx.nav == null || tx.shares == null)) { skippedNoNav++; continue }
    const list = byCode.get(tx.fundCode)
    if (list) {
      list.push(tx)
    } else {
      byCode.set(tx.fundCode, [tx])
    }
  }
  console.log('[calculator]', transactions.length, 'txs →', skippedPending, 'pending skipped,', skippedNoNav, 'no-nav skipped →', byCode.size, 'funds grouped')

  // 2. Process each fund's transactions in date order
  const positions: Position[] = []

  for (const [code, txs] of byCode) {
    // Sort by tradeDate ascending, then by createdAt for same-day ordering
    txs.sort((a, b) =>
      a.tradeDate.localeCompare(b.tradeDate) || (a.createdAt - b.createdAt),
    )

    const name = txs[0]?.fundName ?? ''
    let acc = createAcc(code, name)

    for (const tx of txs) {
      acc = applyTransaction(acc, tx)
    }

    // 3. Enrich with NAV and compute P&L
    const nd = navMap?.[code]
    const latestNav = nd?.nav ?? 0
    const latestNavDate = nd?.date ?? ''
    const marketValue = rMoney(acc.totalShares * latestNav)

    // P&L decomposition
    const unrealizedProfit = rMoney(marketValue - acc.totalCost)
    const realizedProfit   = acc.realizedProfit
    const dividendProfit   = acc.totalCashDividend
    const totalProfit      = rMoney(unrealizedProfit + realizedProfit + dividendProfit)
    const totalProfitRate  = acc.totalInvested > 0
      ? rMoney((totalProfit / acc.totalInvested) * 100)
      : 0

    const isCleared = acc.totalShares < 0.005 // effectively zero

    positions.push({
      fundCode: code,
      fundName: name,

      totalShares:     isCleared ? 0 : acc.totalShares,
      totalCost:       isCleared ? 0 : acc.totalCost,
      avgCostNav:      isCleared ? 0 : avgCost(acc),

      totalInvested:   acc.totalInvested,
      totalSoldCash:   acc.totalSoldCash,
      totalCashDividend: acc.totalCashDividend,

      latestNav,
      latestNavDate,
      marketValue,

      estimateNav:   nd?.estimate,
      estimateChange: nd?.change,
      navChange:      nd?.navChange,
      estimateTime:  nd?.time,

      unrealizedProfit,
      realizedProfit,
      dividendProfit,
      totalProfit,
      totalProfitRate,

      isCleared,
    })
  }

  // 4. Sort by |totalProfit| descending (PRD §5.2)
  positions.sort((a, b) => Math.abs(b.totalProfit) - Math.abs(a.totalProfit))

  return positions
}
