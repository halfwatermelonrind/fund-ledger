import { useMemo, useEffect } from 'react'
import type { Transaction } from '../types'
import { useFundStore } from '../stores/useFundStore'
import { aggregatePositions } from '../utils/calculator'
import { isTradingHours } from '../services/fundData'
import { money, moneySigned, percent, pnlColor } from '../utils/format'
import type { NavEntry } from '../utils/calculator'
import SummaryCards from '../components/SummaryCards'
import type { SummarySlot } from '../components/SummaryCards'

export default function SummaryPage() {
  const storeTransactions = useFundStore((s) => s.transactions)
  const storeNavCache = useFundStore((s) => s.navCache)
  const refreshLatestNav = useFundStore((s) => s.refreshLatestNav)

  const { txs, cache } = useMemo(() => {
    let t = storeTransactions; let c = storeNavCache
    if (t.length === 0) {
      try { const raw = localStorage.getItem('fund-ledger-v1'); if (raw) { const p = JSON.parse(raw); const s = p?.state ?? p; if (s?.transactions?.length > 0) { t = s.transactions as Transaction[]; c = (s.navCache ?? {}) as Record<string, NavEntry> } } } catch { /* */ }
    }
    return { txs: t, cache: c }
  }, [storeTransactions, storeNavCache])

  const positions = useMemo(() => aggregatePositions(txs, cache), [txs, cache])
  const trading = isTradingHours()

  // Auto-refresh stale cache
  useEffect(() => {
    const codes = [...new Set(txs.map((t) => t.fundCode))]
    if (codes.length === 0) return
    const today = new Date().toISOString().slice(0, 10)
    const stale = codes.some((c) => !cache[c] || !cache[c].date || cache[c].date < today)
    if (stale || Object.keys(cache).length === 0) refreshLatestNav(codes)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const summary = useMemo((): SummarySlot[] => {
    let totalMv = 0, totalCost = 0, floatPnL = 0, realized = 0, dailyEstimate = 0
    for (const p of positions) {
      totalMv += p.marketValue
      totalCost += p.totalCost
      floatPnL += p.unrealizedProfit
      realized += p.realizedProfit
      // Daily estimate P&L: Σ(shares × (estimateNav − latestNav))
      if (p.estimateNav != null && p.latestNav > 0) {
        dailyEstimate += p.totalShares * (p.estimateNav - p.latestNav)
      }
    }
    const totalPnL = floatPnL + realized
    const totalRate = totalCost > 0 ? (totalPnL / totalCost * 100) : 0

    return [
      { label: '总市值', value: `${money(totalMv)} 元` },
      { label: '总成本', value: `${money(totalCost)} 元` },
      { label: trading ? '当日预估盈亏' : '当日预估（休市）', value: trading ? `${moneySigned(dailyEstimate)} 元` : '--', valueClass: trading ? pnlColor(dailyEstimate) : 'text-flat' },
      { label: '总浮动盈亏', value: `${moneySigned(floatPnL)} 元`, valueClass: pnlColor(floatPnL) },
      { label: '总已实现盈亏', value: `${moneySigned(realized)} 元`, valueClass: pnlColor(realized) },
      { label: '总盈亏', value: `${moneySigned(totalPnL)} 元`, valueClass: pnlColor(totalPnL) },
      { label: '持仓盈亏比例', value: `${percent(totalRate)}%`, valueClass: pnlColor(totalRate) },
    ]
  }, [positions, trading])

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-base font-semibold tracking-wider text-fg">持仓汇总</h2>
      <SummaryCards items={summary} />
      <div className="text-center"><button className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', height: 40, padding: '0 20px', fontSize: 14, fontWeight: 500, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'var(--accent)', color: '#fff' }} onClick={() => refreshLatestNav()}>刷新估值</button></div>
      {positions.some((p) => p.estimateTime) && <div className="text-[11px] text-muted text-center">{(() => { const p = positions.find((p) => p.estimateTime); return p?.estimateTime ? `估算于 ${p.estimateTime.split(' ')[1] ?? p.estimateTime}` : '' })()}</div>}
    </div>
  )
}
