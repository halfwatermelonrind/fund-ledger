// ============================================================
// Core data types for 基金交易账簿
// ============================================================

/** Transaction type */
export type TransactionType = 'buy' | 'sell' | 'dividend_cash' | 'dividend_reinvest'

/** NAV source */
export type NavSource = 'manual' | 'auto' | 'pending' | 'init'

/** A single transaction record */
export interface Transaction {
  id: string
  fundCode: string
  fundName: string
  type: TransactionType
  tradeDate: string // YYYY-MM-DD
  nav?: number
  amount?: number // buy / dividend_cash amount (yuan)
  shares?: number // sell shares
  confirmedShares?: number // confirmed after NAV backfill
  channel: string
  feeRate: number // e.g. 0.0015 = 0.15%
  fee?: number // 手续费金额（元），自动计算后可手动修改
  navSource: NavSource
  createdAt: number
  updatedAt: number
}

/** Aggregated position for a fund */
export interface Position {
  fundCode: string
  fundName: string

  // current holdings
  totalShares: number
  totalCost: number
  avgCostNav: number

  // cumulative stats
  totalInvested: number
  totalSoldCash: number
  totalCashDividend: number

  // market value & P&L
  latestNav: number
  latestNavDate: string
  marketValue: number

  // real-time estimate (display only)
  estimateNav?: number
  estimateChange?: number
  estimateTime?: string

  // P&L breakdown
  unrealizedProfit: number
  realizedProfit: number
  dividendProfit: number
  totalProfit: number
  totalProfitRate: number

  isCleared: boolean
}

/** Fund NAV + estimate response from JSONP */
export interface FundNavData {
  name: string
  nav: number // dwjz
  date: string // jzrq
  estimate?: number // gsz
  change?: number // gszzl
  time?: string // gztime
}

/** Historical NAV point */
export interface HistoryNavPoint {
  date: string // YYYY-MM-DD
  nav: number
  dividend?: number
}

/** Fund search result */
export interface FundSearchItem {
  code: string
  name: string
}
