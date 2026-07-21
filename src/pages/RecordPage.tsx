import { useState, useMemo, useRef, useCallback } from 'react'
import type { Transaction } from '../types'
import { useFundStore } from '../stores/useFundStore'
import { showToast } from '../components/Toast'
import Button from '../components/Button'
import Badge from '../components/Badge'
import DataTable from '../components/DataTable'
import ConfirmDialog from '../components/ConfirmDialog'
import BatchImportModal from '../components/BatchImportModal'
import EntrySheet from '../components/EntrySheet'
import { useIsPC } from '../hooks/useMediaQuery'
import { money, shares, nav as fmtNav } from '../utils/format'
import type { Column } from '../components/DataTable'
import { Download, Upload, Trash2, FolderOpen } from 'lucide-react'

const TX_LABELS: Record<string, string> = { buy: '买入', sell: '卖出', dividend_cash: '现金分红', dividend_reinvest: '红利再投资' }
const TX_COLORS: Record<string, string> = { buy: 'text-accent', sell: 'text-warn', dividend_cash: 'text-reinvest', dividend_reinvest: 'text-reinvest' }
const TX_BADGE: Record<string, string> = { buy: 'bg-accent-light text-accent', sell: 'bg-warn-bg text-warn-text', dividend_cash: 'bg-reinvest-bg text-reinvest', dividend_reinvest: 'bg-reinvest-bg text-reinvest', init: 'bg-flat-bg text-flat' }
const TX_BADGE_LABEL: Record<string, string> = { buy: '买入', sell: '卖出', dividend_cash: '分红', dividend_reinvest: '分红', init: '初始化' }
const filterPills = [{ key: 'all', label: '全部' }, { key: 'buy', label: '买入' }, { key: 'sell', label: '卖出' }, { key: 'dividend', label: '分红' }, { key: 'reinvest', label: '再投' }]

export default function RecordPage() {
  const storeTransactions = useFundStore((s) => s.transactions)
  const deleteTransaction = useFundStore((s) => s.deleteTransaction)
  const batchFillNav = useFundStore((s) => s.batchFillNav)
  const exportData = useFundStore((s) => s.exportData)
  const importData = useFundStore((s) => s.importData)
  const clearAllData = useFundStore((s) => s.clearAllData)
  const isPC = useIsPC()

  const { transactions } = useMemo(() => {
    let t = storeTransactions
    if (t.length === 0) { try { const raw = localStorage.getItem('fund-ledger-v1'); if (raw) { const p = JSON.parse(raw); const s = p?.state ?? p; if (s?.transactions?.length > 0) t = s.transactions as Transaction[] } } catch { /* */ } }
    return { transactions: t }
  }, [storeTransactions])

  const [filter, setFilter] = useState('all')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetCode, setSheetCode] = useState<string | undefined>()
  const [expandedTx, setExpandedTx] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [backfillId, setBackfillId] = useState<string | null>(null)
  const [backfillNav, setBackfillNav] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const [clearOpen, setClearOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  const handleExport = useCallback(() => {
    const txs = useFundStore.getState().transactions
    if (txs.length === 0) { showToast('暂无数据可导出', 'info'); return }
    try { const json = exportData(); const blob = new Blob([json], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `fund-ledger-${new Date().toISOString().slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url); showToast('已导出', 'success') } catch { showToast('导出失败', 'error') }
  }, [exportData])
  const handleImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    const reader = new FileReader(); reader.onload = () => { try { importData(reader.result as string); showToast('已导入', 'success') } catch (err) { showToast(err instanceof Error ? err.message : '导入失败', 'error') } }; reader.onerror = () => showToast('文件读取失败', 'error'); reader.readAsText(file); e.target.value = ''
  }, [importData])
  const handleClear = useCallback(() => { clearAllData(); setClearOpen(false); showToast('所有数据已清除', 'info') }, [clearAllData])
  async function handleBatchBackfill() { const { success, fail } = await batchFillNav(); showToast(`回填完成：成功 ${success} 条${fail > 0 ? `，失败 ${fail} 条` : ''}`, fail > 0 ? 'info' : 'success') }
  function confirmBackfill() { const n = parseFloat(backfillNav); if (isNaN(n) || n <= 0) { showToast('请输入有效净值', 'error'); return }; if (backfillId) { useFundStore.getState().updateTransaction(backfillId, { nav: Math.round(n * 10000) / 10000 }); showToast('回填成功', 'success') } setBackfillId(null) }

  function openSheet(code?: string) { setSheetCode(code); setSheetOpen(true) }
  function handleSheetClose() { setSheetOpen(false); setSheetCode(undefined) }

  const pendingCount = transactions.filter((t) => t.navSource === 'pending').length
  const filteredTxs = useMemo(() => {
    let list = [...transactions]
    if (filter === 'buy') list = list.filter((t) => t.type === 'buy')
    else if (filter === 'sell') list = list.filter((t) => t.type === 'sell')
    else if (filter === 'dividend') list = list.filter((t) => t.type === 'dividend_cash' || t.type === 'dividend_reinvest')
    else if (filter === 'reinvest') list = list.filter((t) => t.type === 'dividend_reinvest')
    list.sort((a, b) => b.tradeDate.localeCompare(a.tradeDate) || b.createdAt - a.createdAt)
    return list
  }, [transactions, filter])

  const columns: Column<Transaction>[] = [
    { key: 'date', title: '日期', render: (t) => t.tradeDate },
    { key: 'code', title: '基金代码', mono: true, render: (t) => t.fundCode },
    { key: 'name', title: '基金', render: (t) => <span className="max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap block" title={t.fundName}>{t.fundName}</span> },
    { key: 'type', title: '类型', render: (t) => <span className={`font-medium text-xs ${TX_COLORS[t.type] ?? ''}`}>{TX_LABELS[t.type] ?? t.type}</span> },
    { key: 'amount', title: '金额/份额', mono: true, render: (t) => t.type === 'sell' ? (t.shares != null ? `${shares(t.shares)} 份` : '—') : (t.amount != null ? `${money(t.amount)} 元` : '—') },
    { key: 'fee', title: '手续费', mono: true, render: (t) => t.fee != null && t.fee > 0 ? <span className="text-muted">{money(t.fee)} 元</span> : <span className="text-flat">—</span> },
    { key: 'nav', title: '净值', mono: true, render: (t) => t.nav != null ? fmtNav(t.nav) : <span className="text-warn">—</span> },
    { key: 'confirm', title: '确认份额/到账', mono: true, render: (t) => t.type === 'sell' ? (t.amount != null ? <span className="text-loss font-medium">{money(t.amount)} 元</span> : '—') : (t.confirmedShares != null ? `${shares(t.confirmedShares)} 份` : '—') },
    { key: 'status', title: '状态', render: (t) => <Badge status={t.navSource === 'pending' ? 'pending' : t.navSource === 'init' ? 'init' : 'confirmed'} /> },
    { key: 'actions', title: '操作', render: (t) => (<div className="flex gap-1">{t.navSource === 'pending' ? <Button variant="ghost" size="xs" onClick={() => { setBackfillId(t.id); setBackfillNav('') }}>回填</Button> : <Button variant="ghost" size="xs" onClick={() => { sessionStorage.setItem('edit-tx-id', t.id); openSheet() }}>编辑</Button>}<Button variant="danger" size="xs" onClick={() => setDeleteId(t.id)}>删除</Button></div>) },
  ]

  return (
    <div className="flex flex-col pc:grid pc:grid-cols-[38fr_62fr] gap-4 pc:gap-6 items-start">
      {isPC && (
        <div className="bg-surface border border-border rounded-md p-4 pc:p-6 shadow-sm">
          <h2 className="text-base font-semibold mb-4">录入交易</h2>
          <EntrySheet editId={null} onClose={() => {}} />
        </div>
      )}
      <div className="bg-surface border border-border rounded-md p-4 pc:p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4 gap-1">
          <h2 className="text-base font-semibold tracking-wider text-fg shrink-0">交易流水</h2>
          <div className="flex items-center gap-0.5">
            <button className="w-8 h-8 flex items-center justify-center rounded text-muted hover:text-accent hover:bg-accent-light transition-colors" title="批量导入已有持仓" onClick={() => setImportOpen(true)}><FolderOpen className="w-4 h-4" /></button>
            <button className="w-8 h-8 flex items-center justify-center rounded text-muted hover:text-accent hover:bg-accent-light transition-colors" title="导出数据" onClick={handleExport}><Download className="w-4 h-4" /></button>
            <button className="w-8 h-8 flex items-center justify-center rounded text-muted hover:text-accent hover:bg-accent-light transition-colors" title="导入数据" onClick={() => fileInputRef.current?.click()}><Upload className="w-4 h-4" /></button>
            <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
            <button className="w-8 h-8 flex items-center justify-center rounded text-muted hover:text-gain hover:bg-gain-bg transition-colors" title="清除所有数据" onClick={() => setClearOpen(true)}><Trash2 className="w-4 h-4" /></button>
          </div>
        </div>
        {pendingCount > 0 && <div className="mb-3"><Button variant="warn" size="sm" onClick={handleBatchBackfill}>一键回填 ({pendingCount})</Button></div>}
        <div className="flex gap-2 flex-wrap mb-3">
          {filterPills.map((p) => <button key={p.key} className={`px-3 py-1.5 min-h-10 text-xs font-medium border rounded-full transition-colors ${filter === p.key ? 'bg-accent text-white border-accent' : 'bg-surface text-muted border-border hover:border-accent hover:text-accent'}`} onClick={() => setFilter(p.key)}>{p.label}</button>)}
        </div>
        {isPC && <DataTable columns={columns} data={filteredTxs} rowKey={(t) => t.id} emptyText="暂无交易记录" />}
        {!isPC && (
          <div className="flex flex-col gap-3">
            {filteredTxs.length === 0 && <div className="text-center py-10 text-muted"><p className="mb-3">暂无交易记录</p><Button variant="primary" size="sm" onClick={() => openSheet()}>录入第一笔</Button></div>}
            {filteredTxs.map((t) => {
              const isPending = t.navSource === 'pending'; const expanded = expandedTx === t.id
              const amtCls = !isPending ? 'text-accent' : 'text-warn'
              const amountDisplay = t.type === 'sell' ? (t.amount != null ? `${money(t.amount)} 元` : (t.shares != null ? `${shares(t.shares)} 份` : '—')) : (t.amount != null ? `${money(t.amount)} 元` : '—')
              return (
                <div key={t.id} className="bg-surface border border-border rounded-md overflow-hidden" onClick={() => setExpandedTx(expanded ? null : t.id)}>
                  <div className="p-3.5 flex items-start gap-3">
                    <div className="flex-1 min-w-0"><div className="flex items-center gap-2"><div className="text-[15px] font-semibold leading-snug">{t.fundName}</div><span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${TX_BADGE[t.navSource === 'init' ? 'init' : t.type] ?? TX_BADGE.buy}`}>{TX_BADGE_LABEL[t.navSource === 'init' ? 'init' : t.type] ?? t.type}</span></div><div className="text-[11px] text-muted">{t.fundCode}</div></div>
                    <div className="text-right shrink-0"><div className={`text-lg font-semibold font-mono tabular-nums leading-tight ${amtCls}`}>{amountDisplay}</div><div className="text-[11px] text-muted mt-0.5">{t.tradeDate}</div></div>
                  </div>
                  {expanded && (
                    <div className="px-3.5 pb-3.5 border-t border-border pt-3">
                      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs"><dt className="text-muted">交易日期</dt><dd className="font-mono">{t.tradeDate}</dd><dt className="text-muted">单位净值</dt><dd className="font-mono">{t.nav != null ? fmtNav(t.nav) : '—'}</dd><dt className="text-muted">确认份额</dt><dd className="font-mono">{t.confirmedShares != null ? shares(t.confirmedShares) : '—'}</dd><dt className="text-muted">代销渠道</dt><dd>{t.channel}</dd><dt className="text-muted">交易费率</dt><dd className="font-mono">{(t.feeRate * 100).toFixed(2)}%</dd>{t.fee != null && <><dt className="text-muted">手续费</dt><dd className="font-mono">{money(t.fee)} 元</dd></>}</dl>
                      <div className="flex gap-2 mt-3">{isPending ? <Button variant="ghost" size="xs" onClick={(e) => { e.stopPropagation(); setBackfillId(t.id); setBackfillNav('') }}>回填</Button> : <Button variant="ghost" size="xs" onClick={(e) => { e.stopPropagation(); sessionStorage.setItem('edit-tx-id', t.id); openSheet() }}>编辑</Button>}<Button variant="primary" size="xs" onClick={(e) => { e.stopPropagation(); openSheet(t.fundCode) }}>再买一笔</Button><Button variant="danger" size="xs" onClick={(e) => { e.stopPropagation(); setDeleteId(t.id) }}>删除</Button></div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {!isPC && <button className="fixed bottom-20 right-4 w-[52px] h-[52px] bg-accent text-white border-0 rounded-full text-[26px] flex items-center justify-center cursor-pointer shadow-[0_4px_16px_rgba(30,58,138,.35)] z-[90] active:scale-95" onClick={() => openSheet()} aria-label="录入交易">+</button>}
      {!isPC && sheetOpen && (
        <div className="fixed inset-0 bg-black/40 z-[1500] flex items-end" onClick={(e) => { if (e.target === e.currentTarget) handleSheetClose() }}>
          <div ref={sheetRef} className="bg-surface rounded-t-xl w-full max-h-[88vh] overflow-y-auto overscroll-contain p-5 pb-[calc(20px+env(safe-area-inset-bottom,0))]" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div className="flex items-center justify-between mb-4"><div className="w-9 h-1 bg-border rounded-sm" /><button className="w-8 h-8 flex items-center justify-center rounded-full text-muted hover:bg-bg transition-colors text-lg leading-none shrink-0" onClick={handleSheetClose} aria-label="关闭">×</button></div>
            <h3 className="text-[17px] font-semibold mb-4 text-center">录入交易</h3>
            <EntrySheet key={sheetCode} editId={null} prefilledCode={sheetCode} onClose={handleSheetClose} />
          </div>
        </div>
      )}
      <ConfirmDialog open={deleteId !== null} title="确认删除" message="确定要删除这条交易记录吗？" onConfirm={() => { if (deleteId) { deleteTransaction(deleteId); showToast('已删除', 'info') } setDeleteId(null) }} onCancel={() => setDeleteId(null)} />
      <ConfirmDialog open={clearOpen} title="清除所有数据" message="确定要删除所有本地交易记录和缓存数据吗？此操作不可撤销。建议先导出备份。" confirmLabel="确认清除" onConfirm={handleClear} onCancel={() => setClearOpen(false)} />
      {importOpen && <BatchImportModal open={importOpen} onClose={() => setImportOpen(false)} />}
      {backfillId && (
        <div className="fixed inset-0 bg-black/40 z-[1500] flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setBackfillId(null) }}>
          <div className="bg-surface rounded-lg p-6 max-w-[400px] w-full shadow-[0_20px_60px_rgba(0,0,0,0.2)]"><h3 className="text-base font-semibold mb-3">手动回填净值</h3><div className="text-sm text-muted mb-4">基金：{transactions.find((t) => t.id === backfillId)?.fundName ?? '—'}<br/>日期：{transactions.find((t) => t.id === backfillId)?.tradeDate ?? '—'}</div><label className="block text-[13px] font-medium text-fg mb-1">单位净值</label><input className="w-full h-10 px-3 text-sm font-mono border border-accent rounded-sm outline-none" type="number" step="0.0001" min="0" value={backfillNav} onChange={(e) => setBackfillNav(e.target.value)} placeholder="输入净值" autoFocus /><div className="flex gap-2 justify-end mt-5"><Button variant="secondary" size="sm" onClick={() => setBackfillId(null)}>取消</Button><Button size="sm" onClick={confirmBackfill}>确认回填</Button></div></div>
        </div>
      )}
    </div>
  )
}
