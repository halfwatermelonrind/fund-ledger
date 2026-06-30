import { useState, useEffect, useMemo } from 'react'
import type { Transaction, Position } from '../types'
import { useFundStore } from '../stores/useFundStore'
import { aggregatePositions } from '../utils/calculator'
import Button from '../components/Button'
import RefreshButton from '../components/RefreshButton'
import DataTable from '../components/DataTable'
import { useIsPC } from '../hooks/useMediaQuery'
import { money, moneySigned, shares, nav as fmtNav, percent, pnlColor } from '../utils/format'
import type { NavEntry } from '../utils/calculator'
import type { Column } from '../components/DataTable'

// ---- Position Calculator (inline) ----
function PositionCalculator({ pos, onClose }: { pos: Position; onClose: () => void }) {
  const [opType, setOpType] = useState<'buy' | 'sell'>('buy')
  const [buyAmount, setBuyAmount] = useState('')
  const [sellShares, setSellShares] = useState('')
  const [feeRate, setFeeRate] = useState('0.15')

  const result = useMemo(() => {
    const rate = parseFloat(feeRate) / 100 || 0
    const estNav = pos.estimateNav || pos.latestNav
    if (estNav <= 0) return null

    let newShares: number, newCost: number
    if (opType === 'buy') {
      const amt = parseFloat(buyAmount)
      if (isNaN(amt) || amt <= 0) return null
      newShares = pos.totalShares + (amt * (1 - rate)) / estNav
      newCost = pos.totalCost + amt * (1 - rate)
    } else {
      const sh = parseFloat(sellShares)
      if (isNaN(sh) || sh <= 0 || pos.totalShares <= 0) return null
      const ratio = sh / pos.totalShares
      newShares = pos.totalShares - sh
      newCost = pos.totalCost - pos.totalCost * ratio
    }

    const newAvgCost = newShares > 0 ? newCost / newShares : 0
    const costVsNav = estNav > 0 ? (newAvgCost - estNav) / estNav : 0
    const totalPnL = (newShares * estNav - newCost) + pos.realizedProfit + pos.dividendProfit
    const totalRate = newCost > 0 ? totalPnL / newCost * 100 : 0
    const oldRate = pos.totalCost > 0 ? pos.totalProfit / pos.totalCost * 100 : 0

    return { newShares, newCost, newAvgCost, costVsNav, totalRate, oldRate }
  }, [opType, buyAmount, sellShares, feeRate, pos])

  return (
    <div className="fixed inset-0 bg-black/40 z-[1500] flex items-end" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-surface rounded-t-xl w-full max-w-[100vw] max-h-[85vh] overflow-y-auto p-4 pb-[calc(16px+env(safe-area-inset-bottom,0))]">
        <div className="w-9 h-1 bg-border rounded-sm mx-auto mb-4" />
        <h3 className="text-[17px] font-semibold mb-4 text-center">调仓计算器</h3>
        <div className="text-xs text-muted mb-4 leading-relaxed">
          当前：{pos.fundName}<br/>
          市值 {money(pos.marketValue)} | 成本 {money(pos.totalCost)} | 浮动盈亏 <span className={pnlColor(pos.totalProfitRate)}>{percent(pos.totalProfitRate)}%</span>
        </div>

        <div className="flex gap-1 bg-bg rounded-md p-1 mb-4">
          <button className={`flex-1 py-2 text-sm font-medium rounded-md border-0 ${opType === 'buy' ? 'bg-surface text-accent shadow-sm' : 'text-muted'}`} onClick={() => setOpType('buy')}>买入</button>
          <button className={`flex-1 py-2 text-sm font-medium rounded-md border-0 ${opType === 'sell' ? 'bg-surface text-accent shadow-sm' : 'text-muted'}`} onClick={() => setOpType('sell')}>卖出</button>
        </div>

        {opType === 'buy' ? (
          <div className="mb-3.5"><label className="block text-[13px] font-medium mb-1">买入金额（元）</label><input className="w-full h-10 px-3 text-base font-mono border border-border rounded-sm outline-none focus:border-accent" type="number" step="0.01" value={buyAmount} onChange={(e) => setBuyAmount(e.target.value)} placeholder="输入金额" /></div>
        ) : (
          <div className="mb-3.5"><label className="block text-[13px] font-medium mb-1">卖出份额</label><input className="w-full h-10 px-3 text-base font-mono border border-border rounded-sm outline-none focus:border-accent" type="number" step="0.01" value={sellShares} onChange={(e) => setSellShares(e.target.value)} placeholder="输入份额" /></div>
        )}
        <div className="mb-3.5"><label className="block text-[13px] font-medium mb-1">交易费率（%）</label><input className="w-full h-10 px-3 text-base font-mono border border-border rounded-sm outline-none focus:border-accent" type="number" step="0.01" value={feeRate} onChange={(e) => setFeeRate(e.target.value)} /></div>

        {result && (
          <div className="bg-accent-light rounded-md p-3.5 mt-4 space-y-2 overflow-hidden">
            <div className="flex justify-between text-[12px] gap-2"><span className="shrink-0">调仓后份额</span><span className="font-mono font-semibold truncate">{shares(result.newShares)}</span></div>
            <div className="flex justify-between text-[12px] gap-2"><span className="shrink-0">调仓后成本</span><span className="font-mono font-semibold truncate">{money(result.newCost)}</span></div>
            <div className="flex justify-between text-[12px] gap-2"><span className="shrink-0">调仓后成本单价</span><span className="font-mono font-semibold truncate">{fmtNav(result.newAvgCost)}</span></div>
            <div className="flex justify-between text-[12px] gap-2"><span className="shrink-0">成本 vs 净值</span><span className={`font-mono font-semibold truncate ${result.costVsNav > 0 ? 'text-loss' : result.costVsNav < 0 ? 'text-gain' : ''}`}>{percent(result.costVsNav * 100)}%</span></div>
            <div className="flex justify-between text-[12px] gap-2"><span className="shrink-0">调仓后盈亏比例</span><span className={`font-mono font-semibold truncate ${pnlColor(result.totalRate)}`}>{percent(result.totalRate)}%</span></div>
            <div className="flex justify-between text-[12px] gap-2"><span className="shrink-0">盈亏比例变化</span><span className={`font-mono font-semibold truncate ${pnlColor(result.totalRate - result.oldRate)}`}>{percent(result.totalRate - result.oldRate)}%</span></div>
            <div className="text-[11px] text-muted pt-1">* 仅供模拟测算，不产生真实交易记录</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---- DetailsPage ----

export default function DetailsPage() {
  const storeTransactions = useFundStore((s) => s.transactions)
  const storeNavCache = useFundStore((s) => s.navCache)
  const refreshLatestNav = useFundStore((s) => s.refreshLatestNav)
  const isPC = useIsPC()

  const { txs, cache } = useMemo(() => {
    let t = storeTransactions; let c = storeNavCache
    if (t.length === 0) {
      try { const raw = localStorage.getItem('fund-ledger-v1'); if (raw) { const p = JSON.parse(raw); const s = p?.state ?? p; if (s?.transactions?.length > 0) { t = s.transactions as Transaction[]; c = (s.navCache ?? {}) as Record<string, NavEntry> } } } catch { /* */ }
    }
    return { txs: t, cache: c }
  }, [storeTransactions, storeNavCache])

  const allPositions = useMemo(() => aggregatePositions(txs, cache), [txs, cache])
  const activePositions = useMemo(() => allPositions.filter((p) => !p.isCleared), [allPositions])
  const clearedPositions = useMemo(() => allPositions.filter((p) => p.isCleared), [allPositions])

  const [sortKey, setSortKey] = useState<string>('mv')
  const [sortDir, setSortDir] = useState<1 | -1>(-1)
  const [updateTime, setUpdateTime] = useState('')
  const [calculatorPos, setCalculatorPos] = useState<Position | null>(null)
  const [expandedCode, setExpandedCode] = useState<string | null>(null)
  const [clearedOpen, setClearedOpen] = useState(false)

  // Auto-refresh valuations on mount
  useEffect(() => {
    const codes = [...new Set(txs.map((t) => t.fundCode))]
    if (codes.length === 0) return
    refreshLatestNav(codes).then(() => setUpdateTime(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const sortedActive = useMemo(() => {
    const list = [...activePositions]
    list.sort((a, b) => {
      let va: number, vb: number
      if (sortKey === 'mv') { va = a.marketValue; vb = b.marketValue }
      else if (sortKey === 'rate') { va = a.totalProfitRate; vb = b.totalProfitRate }
      else { va = a.estimateChange ?? 0; vb = b.estimateChange ?? 0 }
      return sortDir * (va - vb)
    })
    return list
  }, [activePositions, sortKey, sortDir])

  function handleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === -1 ? 1 : -1) as 1 | -1)
    else { setSortKey(k); setSortDir(-1) }
  }


  const columns: Column<Position>[] = [
    { key: 'code', title: '基金代码', sortable: true, mono: true, render: (p) => p.fundCode },
    { key: 'name', title: '名称', render: (p) => <span className="max-w-[120px] overflow-hidden text-ellipsis whitespace-nowrap block">{p.fundName}</span> },
    { key: 'marketValue', title: '持仓市值', sortable: true, mono: true, render: (p) => money(p.marketValue) },
    { key: 'totalProfitRate', title: '盈亏比例', sortable: true, render: (p) => <span className={`font-mono tabular-nums ${pnlColor(p.totalProfitRate)}`}>{percent(p.totalProfitRate)}%</span> },
    { key: 'change', title: '当日涨跌', sortable: true, render: (p) => p.estimateChange != null ? <span className={`font-mono tabular-nums ${pnlColor(p.estimateChange)}`}>{percent(p.estimateChange)}%</span> : <span className="text-muted">--</span> },
    { key: 'totalShares', title: '持仓份额', sortable: true, mono: true, render: (p) => shares(p.totalShares) },
    { key: 'totalCost', title: '持仓成本', sortable: true, mono: true, render: (p) => money(p.totalCost) },
    { key: 'avgCostNav', title: '成本单价', mono: true, render: (p) => fmtNav(p.avgCostNav) },
    { key: 'latestNav', title: '最新净值', mono: true, render: (p) => p.latestNav > 0 ? fmtNav(p.latestNav) : <span className="text-muted">—</span> },
    { key: 'estimateNav', title: '实时估值', mono: true, render: (p) => p.estimateNav != null ? fmtNav(p.estimateNav) : <span className="text-muted">--</span> },
    { key: 'unrealizedProfit', title: '浮动盈亏', sortable: true, render: (p) => <span className={`font-mono tabular-nums ${pnlColor(p.unrealizedProfit)}`}>{moneySigned(p.unrealizedProfit)}</span> },
    { key: 'realizedProfit', title: '已实现盈亏', sortable: true, render: (p) => <span className={`font-mono tabular-nums ${pnlColor(p.realizedProfit)}`}>{moneySigned(p.realizedProfit)}</span> },
    { key: 'dividendProfit', title: '累计分红', mono: true, render: (p) => money(p.dividendProfit) },
    { key: 'actions', title: '操作', render: (p) => <div className="flex items-center gap-1"><RefreshButton onClick={() => refreshLatestNav([p.fundCode])} /><Button variant="ghost" size="xs" onClick={() => setCalculatorPos(p)}>调仓</Button></div> },
  ]

  const sortPills = [
    { key: 'mv', label: `持仓市值 ${sortKey === 'mv' ? (sortDir === -1 ? '↓' : '↑') : ''}` },
    { key: 'rate', label: `盈亏比例 ${sortKey === 'rate' ? (sortDir === -1 ? '↓' : '↑') : ''}` },
    { key: 'change', label: `当日涨跌 ${sortKey === 'change' ? (sortDir === -1 ? '↓' : '↑') : ''}` },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-wider text-fg">持仓明细</h2>
          {updateTime && <span className="text-[11px] text-muted">数据更新于 {updateTime}</span>}
        </div>
        <Button size="sm" onClick={() => refreshLatestNav().then(() => setUpdateTime(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })))}>刷新估值</Button>
      </div>

      {/* Mobile sort bar */}
      {!isPC && (
        <div className="flex gap-2 flex-wrap">
          {sortPills.map((p) => (
            <button key={p.key} className={`px-3.5 py-1.5 text-xs font-medium border rounded-full transition-colors ${sortKey === p.key ? 'bg-accent text-white border-accent' : 'bg-surface text-muted border-border'}`} onClick={() => handleSort(p.key)}>{p.label}</button>
          ))}
        </div>
      )}

      {/* ---- Mobile Cards ---- */}
      {!isPC && (
        <div className="flex flex-col gap-3">
          {sortedActive.length === 0 && <div className="text-center py-10 text-muted"><p>暂无持仓数据</p></div>}
          {sortedActive.map((p) => {
            const expanded = expandedCode === p.fundCode
            return (
              <div key={p.fundCode} className="bg-surface border border-border rounded-md overflow-hidden" onClick={() => setExpandedCode(expanded ? null : p.fundCode)}>
                <div className="p-3.5 flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-semibold leading-snug">{p.fundName}</div>
                    <div className="text-[11px] text-muted">{p.fundCode}</div>
                    <div className="flex items-baseline gap-1.5 mt-1.5 flex-wrap">
                      <span className={`text-lg font-bold font-mono ${pnlColor(p.totalProfitRate)}`}>{percent(p.totalProfitRate)}%</span>
                      <span className="text-[10px] text-muted">总盈亏</span>
                      <span className="text-border">|</span>
                      <span className={`text-[13px] font-mono ${pnlColor(p.estimateChange ?? 0)}`}>{p.estimateChange != null ? `${percent(p.estimateChange)}%` : '--'}</span>
                      <span className="text-[10px] text-muted">预估</span>
                      <span className="text-border">|</span>
                      <span className={`text-[13px] font-mono ${pnlColor(p.navChange ?? 0)}`}>{p.navChange != null ? `${percent(p.navChange)}%` : '--'}</span>
                      <span className="text-[10px] text-muted">确认</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-lg font-semibold font-mono tabular-nums">{money(p.marketValue)}</div>
                    <div className="text-[10px] text-muted">市值</div>
                  </div>
                </div>
                {expanded && (
                  <div className="px-3.5 pb-3.5 border-t border-border pt-3">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                      <dt className="text-muted">持仓份额</dt><dd className="font-mono">{shares(p.totalShares)}</dd>
                      <dt className="text-muted">持仓成本</dt><dd className="font-mono">{money(p.totalCost)}</dd>
                      <dt className="text-muted">成本单价</dt><dd className="font-mono">{fmtNav(p.avgCostNav)}</dd>
                      <dt className="text-muted">最新净值</dt><dd className="font-mono">{p.latestNav > 0 ? fmtNav(p.latestNav) : '—'}</dd>
                      <dt className="text-muted">实时估值</dt><dd className="font-mono">{p.estimateNav != null ? fmtNav(p.estimateNav) : '--'}</dd>
                      <dt className="text-muted">浮动盈亏</dt><dd className={`font-mono ${pnlColor(p.unrealizedProfit)}`}>{moneySigned(p.unrealizedProfit)}</dd>
                      <dt className="text-muted">已实现盈亏</dt><dd className={`font-mono ${pnlColor(p.realizedProfit)}`}>{moneySigned(p.realizedProfit)}</dd>
                      <dt className="text-muted">累计分红</dt><dd className="font-mono">{money(p.dividendProfit)}</dd>
                    </dl>
                    <div className="flex gap-2 mt-3">
                      <RefreshButton onClick={() => refreshLatestNav([p.fundCode])} />
                      <Button variant="ghost" size="xs" onClick={(e) => { e.stopPropagation(); setCalculatorPos(p) }}>调仓计算器</Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ---- PC Table ---- */}
      {isPC && (
        <DataTable columns={columns} data={sortedActive} rowKey={(p) => p.fundCode} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} maxHeight="65vh" emptyText="暂无持仓数据" />
      )}

      {/* Cleared */}
      <div>
        <div className="text-[13px] font-semibold text-muted cursor-pointer tracking-wider select-none" onClick={() => setClearedOpen(!clearedOpen)}>
          {clearedOpen ? '▾' : '▸'} 已清仓{clearedPositions.length > 0 && ` (${clearedPositions.length})`}
        </div>
        {clearedOpen && clearedPositions.length > 0 && (
          <div className="overflow-x-auto border border-border rounded-md bg-surface mt-2">
            <table className="w-full border-collapse text-[13px]">
              <thead><tr><th className="bg-bg text-xs font-semibold tracking-wider text-muted text-left px-3 py-2.5 border-b-2 border-border">基金代码</th><th className="bg-bg text-xs font-semibold tracking-wider text-muted text-left px-3 py-2.5 border-b-2 border-border">名称</th><th className="bg-bg text-xs font-semibold tracking-wider text-muted text-left px-3 py-2.5 border-b-2 border-border">已实现盈亏</th><th className="bg-bg text-xs font-semibold tracking-wider text-muted text-left px-3 py-2.5 border-b-2 border-border">累计分红</th><th className="bg-bg text-xs font-semibold tracking-wider text-muted text-left px-3 py-2.5 border-b-2 border-border">总盈亏</th></tr></thead>
              <tbody>{clearedPositions.map((p) => (
                <tr key={p.fundCode} className="bg-flat-bg text-muted border-b border-border last:border-b-0">
                  <td className="px-3 py-2.5 font-mono">{p.fundCode}</td><td className="px-3 py-2.5">{p.fundName}</td>
                  <td className={`px-3 py-2.5 font-mono tabular-nums ${pnlColor(p.realizedProfit)}`}>{moneySigned(p.realizedProfit)}</td>
                  <td className="px-3 py-2.5 font-mono tabular-nums">{money(p.dividendProfit)}</td>
                  <td className={`px-3 py-2.5 font-mono tabular-nums ${pnlColor(p.totalProfit)}`}>{moneySigned(p.totalProfit)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>

      {/* Position Calculator Bottom Sheet */}
      {calculatorPos && <PositionCalculator pos={calculatorPos} onClose={() => setCalculatorPos(null)} />}
    </div>
  )
}
