import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import type { Position, Transaction } from '../types'
import { useFundStore } from '../stores/useFundStore'
import { isTradingHours, getSnapshotMeta, refreshEstimateCache } from '../services/fundData'
import { showToast } from '../components/Toast'
import Button from '../components/Button'
import Badge from '../components/Badge'
import RefreshButton from '../components/RefreshButton'
import SummaryCards from '../components/SummaryCards'
import DataTable from '../components/DataTable'
import { useIsPC } from '../hooks/useMediaQuery'
import { money, moneySigned, shares, nav, percent, pnlColor } from '../utils/format'
import { aggregatePositions } from '../utils/calculator'
import type { NavEntry } from '../utils/calculator'
import type { Column } from '../components/DataTable'
import type { SummarySlot } from '../components/SummaryCards'

// ---- Refresh state ----

interface RefreshState {
  spinning: Set<string>
}

// ---- Snapshot time display ----

function SnapshotTime() {
  const meta = getSnapshotMeta()
  if (!meta) return <span>数据未加载</span>
  const date = meta.gxrq || meta.gzrq
  const time = new Date(meta.loadTime)
  const hhmm = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
  return <span>数据更新于 {date} {hhmm}</span>
}

// ---- Transaction type labels ----

const TX_LABELS: Record<string, string> = {
  buy: '买入', sell: '卖出', dividend_cash: '现金分红', dividend_reinvest: '红利再投资',
}
const TX_COLORS: Record<string, string> = {
  buy: 'text-accent', sell: 'text-loss', dividend_cash: 'text-warn', dividend_reinvest: 'text-reinvest',
}

// ---- Component ----

export default function PositionsPage() {
  // Subscribe to entire store to ensure re-render on rehydration
  const store = useFundStore()
  const storeTransactions = store.transactions
  const navCache = store.navCache
  const isLoading = store.isLoading
  const refreshLatestNav = store.refreshLatestNav

  // Derive effective transactions + navCache.
  // If Zustand rehydration hasn't fired yet, fall back to raw localStorage.
  const effective = useMemo(() => {
    let txs = storeTransactions
    let cache = navCache
    if (txs.length === 0) {
      try {
        const raw = localStorage.getItem('fund-ledger-v1')
        if (raw) {
          const parsed = JSON.parse(raw)
          // Zustand persist stores state as { state: { transactions, navCache } }
          const state = parsed?.state ?? parsed
          if (state?.transactions?.length > 0) {
            txs = state.transactions as Transaction[]
            cache = (state.navCache ?? {}) as Record<string, NavEntry>
          }
        }
      } catch { /* ignore */ }
    }
    return { txs, cache }
  }, [storeTransactions, navCache])

  const allPositions = useMemo(
    () => {
      if (effective.txs.length > 0) {
        console.log('[PositionsPage] first tx sample:', JSON.stringify(effective.txs[0], null, 2).slice(0, 400))
      }
      console.log('[PositionsPage] computing from', effective.txs.length, 'txs →',
        aggregatePositions(effective.txs, effective.cache).length, 'positions')
      return aggregatePositions(effective.txs, effective.cache)
    },
    [effective.txs, effective.cache],
  )

  const isPC = useIsPC()

  const [expandedCode, setExpandedCode] = useState<string | null>(null)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
  const [clearedOpen, setClearedOpen] = useState(false)
  const [refresh, setRefresh] = useState<RefreshState>({ spinning: new Set() })
  const [navEdit, setNavEdit] = useState<{ code: string; value: string } | null>(null)
  const [mobileExpanded, setMobileExpanded] = useState<Set<string>>(new Set())

  const trading = isTradingHours()

  // Separate active vs cleared
  const activePositions = useMemo(() => allPositions.filter((p) => !p.isCleared), [allPositions])
  const clearedPositions = useMemo(() => allPositions.filter((p) => p.isCleared), [allPositions])

  // Auto-refresh when positions first become available and cache is stale
  const didAutoRefresh = useRef(false)
  useEffect(() => {
    if (didAutoRefresh.current) return
    const codes = activePositions.map((p) => p.fundCode)
    if (codes.length === 0) return  // positions not computed yet, wait for next render

    const cache = useFundStore.getState().navCache
    const today = new Date().toISOString().slice(0, 10)
    const hasStale = codes.some((c) => {
      const entry = cache[c]
      return !entry || !entry.date || entry.date < today
    })

    if (hasStale || Object.keys(cache).length === 0) {
      didAutoRefresh.current = true
      refreshLatestNav(codes)
    }
  }, [activePositions, refreshLatestNav])

  // ---- Summary ----

  const summary = useMemo((): SummarySlot[] => {
    let totalMv = 0, totalCost = 0, floatPnL = 0, realized = 0, dividends = 0
    for (const p of allPositions) {
      totalMv += p.marketValue
      totalCost += p.totalCost
      floatPnL += p.unrealizedProfit
      realized += p.realizedProfit
      dividends += p.dividendProfit
    }
    const totalPnL = floatPnL + realized + dividends
    const totalRate = totalCost > 0 ? (totalPnL / totalCost * 100) : 0

    return [
      { label: '总市值', value: `${money(totalMv)} 元` },
      { label: '总成本', value: `${money(totalCost)} 元` },
      { label: '总浮动盈亏', value: `${moneySigned(floatPnL)} 元`, valueClass: pnlColor(floatPnL) },
      { label: '总已实现盈亏', value: `${moneySigned(realized)} 元`, valueClass: pnlColor(realized) },
      { label: '累计分红', value: `${money(dividends)} 元` },
      { label: '总盈亏', value: `${moneySigned(totalPnL)} 元`, valueClass: pnlColor(totalPnL) },
      { label: '总盈亏率', value: `${percent(totalRate)}%`, valueClass: pnlColor(totalRate) },
    ]
  }, [allPositions])

  // ---- Sort ----

  const sortedActive = useMemo(() => {
    const list = [...activePositions]
    if (!sortKey) {
      list.sort((a, b) => Math.abs(b.totalProfit) - Math.abs(a.totalProfit))
      return list
    }
    list.sort((a, b) => {
      const va = (a as unknown as Record<string, unknown>)[sortKey]
      const vb = (b as unknown as Record<string, unknown>)[sortKey]
      const na = typeof va === 'number' ? va : 0
      const nb = typeof vb === 'number' ? vb : 0
      return sortDir * (na - nb)
    })
    return list
  }, [activePositions, sortKey, sortDir])

  const handleSort = useCallback((key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === -1 ? 1 : -1) as 1 | -1)
    } else {
      setSortKey(key)
      setSortDir(-1)
    }
  }, [sortKey, sortDir])

  // ---- Refresh ----

  async function handleRefreshOne(code: string) {
    setRefresh((r) => ({ ...r, spinning: new Set([...r.spinning, code]) }))
    try {
      await refreshLatestNav([code])
      showToast('估值刷新完成', 'success')
    } catch {
      showToast('刷新失败', 'error')
    } finally {
      setRefresh((r) => {
        const s = new Set(r.spinning); s.delete(code)
        return { ...r, spinning: s }
      })
    }
  }

  async function handleRefreshAll() {
    if (activePositions.length === 0) return
    await refreshEstimateCache()
    await refreshLatestNav()
    showToast('估值数据已更新', 'success')
  }

  // ---- Inline NAV edit ----

  function startNavEdit(code: string, currentNav: number) {
    setNavEdit({ code, value: currentNav > 0 ? String(currentNav) : '' })
  }

  function confirmNavEdit(code: string) {
    if (!navEdit || navEdit.code !== code) return
    const val = parseFloat(navEdit.value)
    if (isNaN(val) || val <= 0) { showToast('请输入有效净值', 'error'); return }

    // Update navCache via a refresh-like mechanism — for now, directly mutate navCache
    const store = useFundStore.getState()
    const existing = store.navCache[code]
    const updatedCache = {
      ...store.navCache,
      [code]: { ...existing, nav: val, date: existing?.date ?? new Date().toISOString().slice(0, 10) },
    }
    useFundStore.setState({
      navCache: updatedCache,
      positions: aggregatePositions(store.transactions, updatedCache),
    })
    showToast('净值已更新', 'success')
    setNavEdit(null)
  }

  // ---- Transaction history for expanded row ----

  function getFundTransactions(code: string): Transaction[] {
    return effective.txs
      .filter((t: Transaction) => t.fundCode === code)
      .sort((a: Transaction, b: Transaction) => b.tradeDate.localeCompare(a.tradeDate))
  }

  /** Group transactions by channel, sorted by total invested desc */
  function groupByChannel(txs: Transaction[]): Map<string, Transaction[]> {
    const map = new Map<string, Transaction[]>()
    for (const tx of txs) {
      const ch = tx.channel || '其他'
      if (!map.has(ch)) map.set(ch, [])
      map.get(ch)!.push(tx)
    }
    // Sort channels by total buy amount desc
    const sorted = new Map([...map.entries()].sort((a, b) => {
      const sumA = a[1].reduce((s, t) => s + (t.type === 'buy' || t.type === 'dividend_reinvest' ? (t.amount ?? 0) : 0), 0)
      const sumB = b[1].reduce((s, t) => s + (t.type === 'buy' || t.type === 'dividend_reinvest' ? (t.amount ?? 0) : 0), 0)
      return sumB - sumA
    }))
    return sorted
  }

  function renderExpandedRow(pos: Position) {
    const txs = getFundTransactions(pos.fundCode)
    if (txs.length === 0) return <div className="text-muted text-xs">暂无交易记录</div>

    const grouped = groupByChannel(txs)

    return (
      <div className="flex flex-col gap-3">
        <div className="font-semibold text-[13px]">📋 {pos.fundName} — 历史交易流水</div>

        {[...grouped.entries()].map(([channel, channelTxs]) => {
          // Per-channel summary
          const buyAmount = channelTxs
            .filter((t) => t.type === 'buy' || t.type === 'dividend_reinvest')
            .reduce((s, t) => s + (t.amount ?? 0), 0)
          const sellAmount = channelTxs
            .filter((t) => t.type === 'sell')
            .reduce((s, t) => s + (t.amount ?? 0), 0)
          const dividendAmount = channelTxs
            .filter((t) => t.type === 'dividend_cash')
            .reduce((s, t) => s + (t.amount ?? 0), 0)
          const buyCount = channelTxs.filter((t) => t.type === 'buy' || t.type === 'dividend_reinvest').length
          const sellCount = channelTxs.filter((t) => t.type === 'sell').length

          return (
            <div key={channel} className="border border-border rounded-sm overflow-hidden">
              {/* Channel header */}
              <div className="bg-bg px-3 py-2 flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-semibold text-fg tracking-wider">{channel}</span>
                <span className="text-[11px] text-muted">
                  {buyCount > 0 && <span>买入 {buyCount} 笔 / 投入 {money(buyAmount)} 元</span>}
                  {buyCount > 0 && sellCount > 0 && <span> &nbsp;|&nbsp; </span>}
                  {sellCount > 0 && <span>卖出 {sellCount} 笔 / 到账 {money(sellAmount)} 元</span>}
                  {dividendAmount > 0 && <span> &nbsp;|&nbsp; 🧧 {money(dividendAmount)} 元</span>}
                </span>
              </div>
              {/* Transactions in this channel (newest first) */}
              <div className="divide-y divide-dashed divide-border">
                {channelTxs.map((tx) => {
                  const amountDisplay = tx.type === 'sell'
                    ? (tx.shares != null ? `${shares(tx.shares)} 份` : '—')
                    : (tx.amount != null ? `${money(tx.amount)} 元` : '—')
                  return (
                    <div key={tx.id} className="grid grid-cols-[90px_100px_80px_1fr_80px] gap-2 items-center text-xs py-1.5 px-3">
                      <span className="text-muted">{tx.tradeDate}</span>
                      <span className={`font-medium ${TX_COLORS[tx.type] ?? ''}`}>{TX_LABELS[tx.type] ?? tx.type}</span>
                      <span className="font-mono tabular-nums">{amountDisplay}</span>
                      <span className="font-mono tabular-nums text-muted">净值 {tx.nav != null ? nav(tx.nav) : '—'}</span>
                      <Badge status={
                        tx.navSource === 'pending' ? 'pending' :
                        tx.navSource === 'init' ? 'init' :
                        pos.isCleared ? 'cleared' : 'confirmed'
                      } />
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        <div className="font-semibold text-[13px]">
          🧧 累计现金分红：<span className="font-mono tabular-nums">{money(pos.dividendProfit)} 元</span>
        </div>
      </div>
    )
  }

  // ---- Columns (PC) ----

  const columns: Column<Position>[] = [
    { key: 'code', title: '基金代码', sortable: true, mono: true, render: (p) => p.fundCode },
    { key: 'name', title: '名称', render: (p) => (
      <span className="max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap block" title={p.fundName}>{p.fundName}</span>
    )},
    { key: 'totalShares', title: '持仓份额', sortable: true, mono: true, render: (p) => shares(p.totalShares) },
    { key: 'marketValue', title: '持仓市值', sortable: true, mono: true, render: (p) => money(p.marketValue) },
    { key: 'totalCost', title: '持仓成本', sortable: true, mono: true, render: (p) => money(p.totalCost) },
    { key: 'avgCostNav', title: '成本单价', mono: true, render: (p) => nav(p.avgCostNav) },
    { key: 'latestNav', title: '最新净值', mono: true, render: (p) => {
      if (navEdit && navEdit.code === p.fundCode) {
        return (
          <input
            className="w-20 h-7 px-1.5 text-xs font-mono border border-accent rounded-sm outline-none focus:shadow-[0_0_0_2px_rgba(30,58,138,0.15)]"
            type="number" step="0.0001" min="0"
            value={navEdit.value}
            autoFocus
            onChange={(e) => setNavEdit({ ...navEdit, value: e.target.value })}
            onBlur={() => confirmNavEdit(p.fundCode)}
            onKeyDown={(e) => { if (e.key === 'Enter') confirmNavEdit(p.fundCode); if (e.key === 'Escape') setNavEdit(null) }}
          />
        )
      }
      return (
        <span
          className="cursor-pointer hover:text-accent border-b border-dotted border-muted"
          title="点击修改净值"
          onClick={() => startNavEdit(p.fundCode, p.latestNav)}
        >
          {p.latestNav > 0 ? nav(p.latestNav) : <span className="text-muted">—</span>}
        </span>
      )
    }},
    { key: 'estimateNav', title: '实时估值', mono: true, render: (p) =>
      trading && p.estimateNav != null ? nav(p.estimateNav) : <span className="text-muted">--</span>
    },
    { key: 'change', title: '预估涨跌', sortable: true, render: (p) => {
      if (!trading || p.estimateChange == null) return <span className="text-muted">--</span>
      return <span className={`font-mono tabular-nums ${pnlColor(p.estimateChange)}`}>{percent(p.estimateChange)}%</span>
    }},
    { key: 'unrealizedProfit', title: '浮动盈亏', sortable: true, render: (p) => (
      <span className={`font-mono tabular-nums ${pnlColor(p.unrealizedProfit)}`}>{moneySigned(p.unrealizedProfit)}</span>
    )},
    { key: 'realizedProfit', title: '已实现盈亏', sortable: true, render: (p) => (
      <span className={`font-mono tabular-nums ${pnlColor(p.realizedProfit)}`}>{moneySigned(p.realizedProfit)}</span>
    )},
    { key: 'dividendProfit', title: '累计分红', mono: true, render: (p) => money(p.dividendProfit) },
    { key: 'totalProfit', title: '总盈亏', sortable: true, render: (p) => (
      <span className={`font-mono tabular-nums ${pnlColor(p.totalProfit)}`}>{moneySigned(p.totalProfit)}</span>
    )},
    { key: 'totalProfitRate', title: '总盈亏率', sortable: true, render: (p) => (
      <span className={`font-mono tabular-nums ${pnlColor(p.totalProfitRate)}`}>{percent(p.totalProfitRate)}%</span>
    )},
    { key: 'actions', title: '操作', render: (p) => (
      <div className="flex items-center gap-1">
        <RefreshButton spinning={refresh.spinning.has(p.fundCode)} onClick={() => handleRefreshOne(p.fundCode)} />
        <Button variant="ghost" size="xs" onClick={() => setExpandedCode(expandedCode === p.fundCode ? null : p.fundCode)}>详情</Button>
      </div>
    )},
  ]

  // ---- Mobile card toggle ----

  function toggleMobileCard(code: string) {
    setMobileExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code); else next.add(code)
      return next
    })
  }

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="flex flex-col gap-4 pc:gap-6">
      {/* Summary Cards */}
      <SummaryCards items={summary} />

      {/* Active Holdings */}
      <div className="bg-surface border border-border rounded-md p-4 pc:p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-base font-semibold tracking-wider text-fg">持仓明细</h2>
          <Button size="sm" onClick={handleRefreshAll} disabled={isLoading || activePositions.length === 0}>刷新全部估值</Button>
        </div>
        <div className="text-[11px] text-muted mb-3 tracking-wider">
          {trading ? '盘中实时估值' : '非交易时段，实时估值不可用'}
          {' · '}
          <SnapshotTime />
        </div>

        {/* ---- PC Table ---- */}
        {isPC && (
          <DataTable
            columns={columns}
            data={sortedActive}
            rowKey={(p) => p.fundCode}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={handleSort}
            expandedKey={expandedCode}
            renderExpanded={(p) => renderExpandedRow(p)}
            emptyText="暂无持仓数据，请先录入交易"
            maxHeight="70vh"
          />
        )}

        {/* ---- Mobile Cards ---- */}
        {!isPC && (
          <div className="flex flex-col gap-3">
            {sortedActive.length === 0 && (
              <div className="text-center py-8 text-muted text-sm">暂无持仓数据，请先录入交易</div>
            )}
            {sortedActive.map((p) => {
              const expanded = mobileExpanded.has(p.fundCode)
              return (
                <div key={p.fundCode} className="border border-border rounded-md p-4 bg-surface">
                  {/* Row 1: name + totalProfitRate */}
                  <div className="flex items-center justify-between" onClick={() => toggleMobileCard(p.fundCode)}>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold truncate">{p.fundName}</div>
                      <div className="text-xs text-muted font-mono mt-0.5">{p.fundCode}</div>
                    </div>
                    <div className={`text-lg font-semibold font-mono tabular-nums ml-2 ${pnlColor(p.totalProfitRate)}`}>
                      {percent(p.totalProfitRate)}%
                    </div>
                  </div>

                  {/* Row 2: shares | marketValue | avgCostNav */}
                  <div className="flex gap-3 mt-3 text-xs text-muted">
                    <span>份额 <span className="font-mono text-fg">{shares(p.totalShares)}</span></span>
                    <span>市值 <span className="font-mono text-fg">{money(p.marketValue)}</span></span>
                    <span>成本单价 <span className="font-mono text-fg">{nav(p.avgCostNav)}</span></span>
                  </div>

                  {/* Expanded detail */}
                  {expanded && (
                    <div className="mt-3 pt-3 border-t border-border space-y-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted">浮动盈亏</span>
                        <span className={`font-mono tabular-nums font-medium ${pnlColor(p.unrealizedProfit)}`}>{moneySigned(p.unrealizedProfit)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted">已实现盈亏</span>
                        <span className={`font-mono tabular-nums ${pnlColor(p.realizedProfit)}`}>{moneySigned(p.realizedProfit)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted">累计分红</span>
                        <span className="font-mono tabular-nums">{money(p.dividendProfit)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted">最新净值</span>
                        <span className="font-mono tabular-nums">{p.latestNav > 0 ? nav(p.latestNav) : '—'}</span>
                      </div>
                      {trading && (
                        <>
                          <div className="flex justify-between">
                            <span className="text-muted">实时估值</span>
                            <span className="font-mono tabular-nums">{p.estimateNav != null ? nav(p.estimateNav) : '--'}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted">预估涨跌</span>
                            <span className={`font-mono tabular-nums ${pnlColor(p.estimateChange ?? 0)}`}>
                              {p.estimateChange != null ? `${percent(p.estimateChange)}%` : '--'}
                            </span>
                          </div>
                        </>
                      )}
                      {/* Transaction history — grouped by channel */}
                      <div className="pt-2 mt-2 border-t border-dashed border-border">
                        <div className="text-muted mb-2 font-medium">历史交易</div>
                        {getFundTransactions(p.fundCode).length === 0 ? (
                          <div className="text-muted">暂无交易记录</div>
                        ) : (
                          [...groupByChannel(getFundTransactions(p.fundCode)).entries()].map(([channel, channelTxs]) => (
                            <div key={channel} className="mb-2">
                              <div className="text-[11px] font-medium text-fg mb-1">{channel}</div>
                              {channelTxs.slice(0, 5).map((tx) => (
                                <div key={tx.id} className="flex justify-between py-0.5 text-[11px] pl-2">
                                  <span>{tx.tradeDate} <span className={TX_COLORS[tx.type]}>{TX_LABELS[tx.type] ?? tx.type}</span></span>
                                  <span className="font-mono text-muted">
                                    {tx.type === 'sell'
                                      ? (tx.shares != null ? `${shares(tx.shares)} 份` : '—')
                                      : (tx.amount != null ? `${money(tx.amount)} 元` : '—')}
                                  </span>
                                </div>
                              ))}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex items-center gap-2 mt-3">
                    <RefreshButton spinning={refresh.spinning.has(p.fundCode)} onClick={() => handleRefreshOne(p.fundCode)} />
                    <Button variant="ghost" size="xs" onClick={() => toggleMobileCard(p.fundCode)}>
                      {expanded ? '收起' : '详情'}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Cleared Section */}
      <div>
        <div
          className="text-[13px] font-semibold text-muted cursor-pointer tracking-wider select-none"
          onClick={() => setClearedOpen(!clearedOpen)}
        >
          {clearedOpen ? '▾' : '▸'} 已清仓{clearedPositions.length > 0 && ` (${clearedPositions.length})`}
        </div>
        {clearedOpen && clearedPositions.length > 0 && (
          <div className="overflow-x-auto border border-border rounded-md bg-surface mt-2">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="bg-bg text-xs font-semibold tracking-wider text-muted text-left px-3 py-2.5 border-b-2 border-border">基金代码</th>
                  <th className="bg-bg text-xs font-semibold tracking-wider text-muted text-left px-3 py-2.5 border-b-2 border-border">名称</th>
                  <th className="bg-bg text-xs font-semibold tracking-wider text-muted text-left px-3 py-2.5 border-b-2 border-border">已实现盈亏</th>
                  <th className="bg-bg text-xs font-semibold tracking-wider text-muted text-left px-3 py-2.5 border-b-2 border-border">累计分红</th>
                  <th className="bg-bg text-xs font-semibold tracking-wider text-muted text-left px-3 py-2.5 border-b-2 border-border">总盈亏</th>
                </tr>
              </thead>
              <tbody>
                {clearedPositions.map((p) => (
                  <tr key={p.fundCode} className="bg-flat-bg text-muted border-b border-border last:border-b-0">
                    <td className="px-3 py-2.5 font-mono">{p.fundCode}</td>
                    <td className="px-3 py-2.5">{p.fundName}</td>
                    <td className={`px-3 py-2.5 font-mono tabular-nums ${pnlColor(p.realizedProfit)}`}>{moneySigned(p.realizedProfit)}</td>
                    <td className="px-3 py-2.5 font-mono tabular-nums">{money(p.dividendProfit)}</td>
                    <td className={`px-3 py-2.5 font-mono tabular-nums ${pnlColor(p.totalProfit)}`}>{moneySigned(p.totalProfit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {clearedOpen && clearedPositions.length === 0 && (
          <div className="text-center py-4 text-muted text-sm">暂无已清仓基金</div>
        )}
      </div>
    </div>
  )
}
