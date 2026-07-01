import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Transaction } from '../types'
import { useFundStore } from '../stores/useFundStore'
import { showToast } from '../components/Toast'
import Button from '../components/Button'
import Badge from '../components/Badge'
import FilterPills from '../components/FilterPills'
import DataTable from '../components/DataTable'
import ConfirmDialog from '../components/ConfirmDialog'
import { money, shares, nav as fmtNav } from '../utils/format'
import type { Column } from '../components/DataTable'
import type { NavEntry } from '../utils/calculator'

const TX_LABELS: Record<string, string> = { buy: '买入', sell: '卖出', dividend_cash: '现金分红', dividend_reinvest: '红利再投资' }
const TX_COLORS: Record<string, string> = { buy: 'text-accent', sell: 'text-warn', dividend_cash: 'text-[#7e22ce]', dividend_reinvest: 'text-[#7e22ce]' }

export default function TxLogPage() {
  const storeTransactions = useFundStore((s) => s.transactions)
  const storeNavCache = useFundStore((s) => s.navCache)
  const deleteTransaction = useFundStore((s) => s.deleteTransaction)
  const batchFillNav = useFundStore((s) => s.batchFillNav)
  const navigate = useNavigate()
  const isPC = typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches

  function setEditTx(tx: Transaction) {
    sessionStorage.setItem('edit-tx-id', tx.id)
    navigate('/entry')
  }

  const { transactions } = useMemo(() => {
    let txs = storeTransactions
    let cache = storeNavCache
    if (txs.length === 0) {
      try { const raw = localStorage.getItem('fund-ledger-v1'); if (raw) { const p = JSON.parse(raw); const s = p?.state ?? p; if (s?.transactions?.length > 0) { txs = s.transactions as Transaction[]; cache = (s.navCache ?? {}) as Record<string, NavEntry> } } } catch { /* */ }
    }
    return { transactions: txs, navCache: cache }
  }, [storeTransactions, storeNavCache])


  const [filter, setFilter] = useState('all')
  const [expandedTx, setExpandedTx] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [backfillId, setBackfillId] = useState<string | null>(null)
  const [backfillNav, setBackfillNav] = useState('')

  const filterPills = [
    { key: 'all', label: '全部' },
    { key: 'confirmed', label: '已确认' },
    { key: 'pending', label: '待回填' },
  ]

  const filteredTxs = useMemo(() => {
    let list = [...transactions]
    if (filter === 'pending') list = list.filter((t) => t.navSource === 'pending')
    else if (filter === 'confirmed') list = list.filter((t) => t.navSource !== 'pending')
    list.sort((a, b) => b.tradeDate.localeCompare(a.tradeDate) || b.createdAt - a.createdAt)
    return list
  }, [transactions, filter])

  const pendingCount = transactions.filter((t) => t.navSource === 'pending').length

  async function handleBatchBackfill() {
    const { success, fail } = await batchFillNav()
    showToast(`一键回填完成：成功 ${success} 条${fail > 0 ? `，失败 ${fail} 条` : ''}`, fail > 0 ? 'info' : 'success')
  }

  function confirmBackfill() {
    const nav = parseFloat(backfillNav)
    if (isNaN(nav) || nav <= 0) { showToast('请输入有效净值', 'error'); return }
    if (backfillId) {
      useFundStore.getState().updateTransaction(backfillId, { nav: Math.round(nav * 10000) / 10000 })
      showToast('净值回填成功', 'success')
    }
    setBackfillId(null)
  }

  // ---- PC Table Columns ----
  const columns: Column<Transaction>[] = [
    { key: 'date', title: '日期', render: (t) => t.tradeDate },
    { key: 'code', title: '基金代码', mono: true, render: (t) => t.fundCode },
    { key: 'name', title: '基金', render: (t) => <span className="max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap block" title={t.fundName}>{t.fundName}</span> },
    { key: 'type', title: '类型', render: (t) => <span className={`font-medium text-xs ${TX_COLORS[t.type] ?? ''}`}>{TX_LABELS[t.type] ?? t.type}</span> },
    { key: 'amount', title: '金额/份额', mono: true, render: (t) => {
      if (t.type === 'sell') return t.shares != null ? `${shares(t.shares)} 份` : '—'
      return t.amount != null ? `${money(t.amount)} 元` : '—'
    }},
    { key: 'fee', title: '手续费', mono: true, render: (t) => t.fee != null && t.fee > 0 ? <span className="text-muted">{money(t.fee)} 元</span> : <span className="text-flat">—</span> },
    { key: 'nav', title: '净值', mono: true, render: (t) => t.nav != null ? fmtNav(t.nav) : <span className="text-warn">—</span> },
    { key: 'confirm', title: '确认份额/到账', mono: true, render: (t) => {
      if (t.type === 'sell') return t.amount != null ? <span className="text-loss font-medium">{money(t.amount)} 元</span> : '—'
      return t.confirmedShares != null ? `${shares(t.confirmedShares)} 份` : '—'
    }},
    { key: 'status', title: '状态', render: (t) => <Badge status={t.navSource === 'pending' ? 'pending' : t.navSource === 'init' ? 'init' : 'confirmed'} /> },
    { key: 'actions', title: '操作', render: (t) => (
      <div className="flex gap-1">
        {t.navSource === 'pending' ? <Button variant="ghost" size="xs" onClick={() => { setBackfillId(t.id); setBackfillNav('') }}>回填</Button> : null}
        <Button variant="danger" size="xs" onClick={() => setDeleteId(t.id)}>删除</Button>
      </div>
    )},
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-base font-semibold tracking-wider text-fg">交易流水</h2>
        {pendingCount > 0 && <Button variant="warn" size="sm" onClick={handleBatchBackfill}>一键回填净值 ({pendingCount})</Button>}
      </div>
      <div className="mb-1"><FilterPills pills={filterPills} active={filter} onChange={setFilter} /></div>

      {/* ---- Mobile Card List ---- */}
      {!isPC && (
        <div className="flex flex-col gap-3">
          {filteredTxs.length === 0 && <div className="text-center py-10 text-muted"><p className="mb-3">暂无交易记录</p></div>}
          {filteredTxs.map((t) => {
            const isPending = t.navSource === 'pending'
            const confirmed = !isPending
            const amtCls = confirmed ? 'text-accent' : 'text-warn'
            const amountDisplay = t.type === 'sell'
              ? (t.amount != null ? `${money(t.amount)} 元` : (t.shares != null ? `${shares(t.shares)} 份` : '—'))
              : (t.amount != null ? `${money(t.amount)} 元` : '—')
            const expanded = expandedTx === t.id
            return (
              <div key={t.id} className="bg-surface border border-border rounded-md overflow-hidden" onClick={() => setExpandedTx(expanded ? null : t.id)}>
                <div className="p-3.5 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] font-semibold leading-snug">{t.fundName}</div>
                    <div className="text-[11px] text-muted">{t.fundCode}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-lg font-semibold font-mono tabular-nums leading-tight ${amtCls}`}>{amountDisplay}</div>
                    <div className="text-[11px] text-muted mt-0.5">{t.tradeDate}</div>
                  </div>
                </div>
                {expanded && (
                  <div className="px-3.5 pb-3.5 border-t border-border pt-3">
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                      <dt className="text-muted">交易日期</dt><dd className="font-mono">{t.tradeDate}</dd>
                      <dt className="text-muted">单位净值</dt><dd className="font-mono">{t.nav != null ? fmtNav(t.nav) : '—'}</dd>
                      <dt className="text-muted">确认份额</dt><dd className="font-mono">{t.confirmedShares != null ? shares(t.confirmedShares) : '—'}</dd>
                      <dt className="text-muted">代销渠道</dt><dd>{t.channel}</dd>
                      <dt className="text-muted">交易费率</dt><dd className="font-mono">{(t.feeRate * 100).toFixed(2)}%</dd>
                      {t.fee != null && <><dt className="text-muted">手续费</dt><dd className="font-mono">{money(t.fee)} 元</dd></>}
                    </dl>
                    <div className="flex gap-2 mt-3">
                      {isPending
                        ? <Button variant="ghost" size="xs" onClick={(e) => { e.stopPropagation(); setBackfillId(t.id); setBackfillNav('') }}>回填</Button>
                        : <Button variant="ghost" size="xs" onClick={(e) => { e.stopPropagation(); setEditTx(t) }}>编辑</Button>
                      }
                      <Button variant="danger" size="xs" onClick={(e) => { e.stopPropagation(); setDeleteId(t.id) }}>删除</Button>
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
        <DataTable columns={columns} data={filteredTxs} rowKey={(t) => t.id} emptyText="暂无交易记录，请先录入" />
      )}

      {/* Backfill Modal */}
      {backfillId && (
        <div className="fixed inset-0 bg-black/40 z-[1500] flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setBackfillId(null) }}>
          <div className="bg-surface rounded-lg p-6 max-w-[400px] w-full shadow-[0_20px_60px_rgba(0,0,0,0.2)]">
            <h3 className="text-base font-semibold mb-3">手动回填净值</h3>
            <div className="text-sm text-muted mb-4">基金：{transactions.find((t) => t.id === backfillId)?.fundName ?? '—'}<br/>日期：{transactions.find((t) => t.id === backfillId)?.tradeDate ?? '—'}</div>
            <label className="block text-[13px] font-medium text-fg mb-1">单位净值</label>
            <input className="w-full h-10 px-3 text-sm font-mono border border-accent rounded-sm outline-none" type="number" step="0.0001" min="0" value={backfillNav} onChange={(e) => setBackfillNav(e.target.value)} placeholder="输入净值" autoFocus />
            <div className="flex gap-2 justify-end mt-5"><Button variant="secondary" size="sm" onClick={() => setBackfillId(null)}>取消</Button><Button size="sm" onClick={confirmBackfill}>确认回填</Button></div>
          </div>
        </div>
      )}

      <ConfirmDialog open={deleteId !== null} title="确认删除" message="确定要删除这条交易记录吗？" onConfirm={() => { if (deleteId) { deleteTransaction(deleteId); showToast('已删除', 'info'); } setDeleteId(null) }} onCancel={() => setDeleteId(null)} />
    </div>
  )
}
