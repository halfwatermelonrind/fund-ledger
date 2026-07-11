import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import type { Transaction, TransactionType } from '../types'
import { useFundStore } from '../stores/useFundStore'
import { fetchLatestNav } from '../services/fundData'
import { aggregatePositions } from '../utils/calculator'
import { showToast } from '../components/Toast'
import Button from '../components/Button'
import Badge from '../components/Badge'
import TypeTabs from '../components/TypeTabs'
import DataTable from '../components/DataTable'
import ConfirmDialog from '../components/ConfirmDialog'
import BatchImportModal from '../components/BatchImportModal'
import { useIsPC } from '../hooks/useMediaQuery'
import { money, shares, nav as fmtNav } from '../utils/format'
import type { Column } from '../components/DataTable'
import { Download, Upload, Trash2, FolderOpen } from 'lucide-react'

const CHANNELS = ['支付宝', '天天基金', '理财通', '招商银行', '平安银行', '兴业银行', '交通银行', '汇丰银行', '建设银行']
const TX_LABELS: Record<string, string> = { buy: '买入', sell: '卖出', dividend_cash: '现金分红', dividend_reinvest: '红利再投资' }
const TX_COLORS: Record<string, string> = { buy: 'text-accent', sell: 'text-warn', dividend_cash: 'text-reinvest', dividend_reinvest: 'text-reinvest' }
const TX_BADGE: Record<string, string> = { buy: 'bg-accent-light text-accent', sell: 'bg-warn-bg text-warn-text', dividend_cash: 'bg-reinvest-bg text-reinvest', dividend_reinvest: 'bg-reinvest-bg text-reinvest', init: 'bg-flat-bg text-flat' }
const TX_BADGE_LABEL: Record<string, string> = { buy: '买入', sell: '卖出', dividend_cash: '分红', dividend_reinvest: '分红', init: '初始化' }

const filterPills = [
  { key: 'all', label: '全部' }, { key: 'buy', label: '买入' }, { key: 'sell', label: '卖出' },
  { key: 'dividend', label: '分红' }, { key: 'reinvest', label: '再投' },
]

const inputCls = "w-full h-11 px-3 text-base font-mono border border-border rounded-sm outline-none focus:border-accent bg-surface text-fg"
const inputClsText = "w-full h-11 px-3 text-base border border-border rounded-sm outline-none focus:border-accent bg-surface text-fg"

export default function RecordPage() {
  const storeTransactions = useFundStore((s) => s.transactions)
  const storeNavCache = useFundStore((s) => s.navCache)
  const addTransaction = useFundStore((s) => s.addTransaction)
  const updateTransaction = useFundStore((s) => s.updateTransaction)
  const deleteTransaction = useFundStore((s) => s.deleteTransaction)
  const batchFillNav = useFundStore((s) => s.batchFillNav)
  const exportData = useFundStore((s) => s.exportData)
  const importData = useFundStore((s) => s.importData)
  const clearAllData = useFundStore((s) => s.clearAllData)
  const isPC = useIsPC()

  const { transactions, navCache } = useMemo(() => {
    let t = storeTransactions; let c = storeNavCache
    if (t.length === 0) { try { const raw = localStorage.getItem('fund-ledger-v1'); if (raw) { const p = JSON.parse(raw); const s = p?.state ?? p; if (s?.transactions?.length > 0) { t = s.transactions as Transaction[]; c = s.navCache ?? {} } } } catch { /* */ } }
    return { transactions: t, navCache: c }
  }, [storeTransactions, storeNavCache])

  const positions = useMemo(() => aggregatePositions(transactions, navCache), [transactions, navCache])

  // ---- Uncontrolled form: refs + mutable preview state ----
  const formRef = useRef<HTMLFormElement>(null)
  const fcodeRef = useRef<HTMLInputElement>(null)
  const fnameRef = useRef<HTMLInputElement>(null)
  const [txType, setTxType] = useState<TransactionType>('buy')
  const [editId, setEditId] = useState<string | null>(null)
  const [lookingUp, setLookingUp] = useState(false)
  // Preview state (mutable, used only for real-time preview display)
  const [previewState, setPreviewState] = useState<{ nav: string; buyAmount: string; sellShares: string; divAmount: string; reinvAmount: string; feeRate: string; fee: string }>({ nav: '', buyAmount: '', sellShares: '', divAmount: '', reinvAmount: '', feeRate: '0.15', fee: '' })

  // Reset form defaults
  function resetFormDefaults(initial?: Partial<typeof previewState> & { code?: string; name?: string; date?: string; channel?: string }) {
    if (fcodeRef.current) fcodeRef.current.value = initial?.code ?? ''
    if (fnameRef.current) fnameRef.current.value = initial?.name ?? ''
    const navEl = formRef.current?.querySelector<HTMLInputElement>('input[name="nav"]')
    const dateEl = formRef.current?.querySelector<HTMLInputElement>('input[name="date"]')
    const channelEl = formRef.current?.querySelector<HTMLSelectElement>('select[name="channel"]')
    if (navEl) navEl.value = initial?.nav ?? ''
    if (dateEl) dateEl.value = initial?.date ?? new Date().toISOString().slice(0, 10)
    if (channelEl) channelEl.value = initial?.channel ?? '支付宝'
    setPreviewState({ nav: initial?.nav ?? '', buyAmount: '', sellShares: '', divAmount: '', reinvAmount: '', feeRate: initial?.feeRate ?? '0.15', fee: initial?.fee ?? '' })
  }

  // Load edit target from sessionStorage
  useEffect(() => {
    const id = sessionStorage.getItem('edit-tx-id')
    if (!id) return
    sessionStorage.removeItem('edit-tx-id')
    const tx = transactions.find((t) => t.id === id)
    if (!tx) return
    setEditId(tx.id); setTxType(tx.type); setSheetOpen(true)
    setTimeout(() => {
      resetFormDefaults({ code: tx.fundCode, name: tx.fundName, date: tx.tradeDate, nav: tx.nav != null ? String(tx.nav) : '', channel: tx.channel, feeRate: String(tx.feeRate * 100), fee: tx.fee != null ? String(tx.fee) : '' })
      if (tx.type === 'buy' && tx.amount) setPreviewState(s => ({ ...s, buyAmount: String(tx.amount) }))
      if (tx.type === 'sell' && tx.shares) setPreviewState(s => ({ ...s, sellShares: String(tx.shares) }))
      if (tx.type === 'dividend_cash' && tx.amount) setPreviewState(s => ({ ...s, divAmount: String(tx.amount) }))
      if (tx.type === 'dividend_reinvest' && tx.amount) setPreviewState(s => ({ ...s, reinvAmount: String(tx.amount) }))
    }, 50)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Fund lookup ----
  async function lookupFundCode(code: string) {
    if (code.length !== 6 || !/^\d{6}$/.test(code)) return
    setLookingUp(true)
    try { const data = await fetchLatestNav(code); if (fnameRef.current) fnameRef.current.value = data.name }
    catch { try { const m = await import('../services/fundData'); const r = await m.searchFundName(code); const match = r.find((x) => x.code === code); if (fnameRef.current) fnameRef.current.value = match ? match.name : '未找到' } catch { if (fnameRef.current) fnameRef.current.value = '查询失败' } }
    finally { setLookingUp(false) }
  }

  // ---- Preview / fee calc (uses previewState for reactivity) ----
  const preview = useMemo(() => {
    const n = parseFloat(previewState.nav); if (isNaN(n) || n <= 0) return null
    const rate = parseFloat(previewState.feeRate) / 100 || 0
    if (txType === 'buy') { const amt = parseFloat(previewState.buyAmount); if (isNaN(amt) || amt <= 0) return null; const fee = amt * rate; return { shares: shares((amt - fee) / n), amount: money(amt - fee), fee: money(fee) } }
    if (txType === 'sell') { const qty = parseFloat(previewState.sellShares); if (isNaN(qty) || qty <= 0) return null; const g = qty * n; const fee = g * rate; return { shares: shares(qty), amount: money(g - fee), fee: money(fee) } }
    if (txType === 'dividend_cash') { const amt = parseFloat(previewState.divAmount); if (isNaN(amt) || amt <= 0) return null; return { shares: '—', amount: money(amt), fee: '0.00' } }
    if (txType === 'dividend_reinvest') { const amt = parseFloat(previewState.reinvAmount); if (isNaN(amt) || amt <= 0) return null; return { shares: shares(amt / n), amount: money(amt), fee: '0.00' } }
    return null
  }, [previewState, txType])

  const autoFee = useMemo(() => {
    const rate = parseFloat(previewState.feeRate) / 100 || 0; if (rate <= 0) return ''
    if (txType === 'buy') { const amt = parseFloat(previewState.buyAmount); if (isNaN(amt) || amt <= 0) return ''; return money(amt * rate) }
    if (txType === 'sell') { const n = parseFloat(previewState.nav); const q = parseFloat(previewState.sellShares); if (isNaN(n) || isNaN(q) || n <= 0 || q <= 0) return ''; return money(q * n * rate) }
    return ''
  }, [previewState.buyAmount, previewState.sellShares, previewState.nav, previewState.feeRate, txType])

  // Update preview state on input (does NOT trigger full form re-render since inputs are uncontrolled)
  function updatePS(patch: Partial<typeof previewState>) { setPreviewState(s => ({ ...s, ...patch })) }

  // ---- Save (reads from DOM via refs) ----
  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const code = fcodeRef.current?.value?.trim() || ''
    const name = fnameRef.current?.value?.trim() || ''
    if (!code || !name) { showToast('请填写基金代码和名称', 'error'); return }
    const navRaw = previewState.nav ? parseFloat(previewState.nav) : undefined
    const feeRate = parseFloat(previewState.feeRate) / 100 || 0
    const hasNav = navRaw != null && !isNaN(navRaw) && navRaw > 0
    const manualFee = previewState.fee ? parseFloat(previewState.fee) : undefined
    const calcBuyFee = (g: number) => Math.round(g * feeRate * 100) / 100
    const calcSellFee = (s: number, n: number) => Math.round(s * n * feeRate * 100) / 100
    const dateEl = formRef.current?.querySelector<HTMLInputElement>('input[name="date"]')
    const channelEl = formRef.current?.querySelector<HTMLSelectElement>('select[name="channel"]')
    const tradeDate = dateEl?.value || new Date().toISOString().slice(0, 10)
    const channel = channelEl?.value || '支付宝'
    const base = { fundCode: code, fundName: name, tradeDate, channel, feeRate, navSource: hasNav ? 'manual' as const : 'pending' as const }

    if (txType === 'buy') { const amt = parseFloat(previewState.buyAmount); if (!amt || amt <= 0) { showToast('请填写购买金额', 'error'); return }; const fee = manualFee ?? (feeRate > 0 ? calcBuyFee(amt) : undefined); const net = Math.round(amt * (1 - feeRate) * 100) / 100
      if (editId) updateTransaction(editId, { ...base, type: 'buy', amount: amt, nav: navRaw, fee, confirmedShares: hasNav ? Math.round(net / navRaw! * 100) / 100 : undefined })
      else addTransaction({ ...base, type: 'buy', amount: amt, nav: navRaw, fee, shares: undefined, confirmedShares: hasNav ? Math.round(net / navRaw! * 100) / 100 : undefined }) }
    else if (txType === 'sell') { const sh = parseFloat(previewState.sellShares); if (!sh || sh <= 0) { showToast('请填写卖出份额', 'error'); return }; const pos = positions.find((p) => p.fundCode === code && !p.isCleared); if (pos && sh > pos.totalShares) { showToast('卖出份额超出持仓', 'error'); return }; const fee = manualFee ?? (hasNav && feeRate > 0 ? calcSellFee(sh, navRaw!) : undefined); const net = hasNav ? Math.round(sh * navRaw! * (1 - feeRate) * 100) / 100 : undefined
      if (editId) updateTransaction(editId, { ...base, type: 'sell', shares: sh, nav: navRaw, fee, amount: net })
      else addTransaction({ ...base, type: 'sell', shares: sh, nav: navRaw, fee, amount: net }) }
    else if (txType === 'dividend_cash') { const amt = parseFloat(previewState.divAmount); if (!amt || amt <= 0) { showToast('请填写分红金额', 'error'); return }
      if (editId) updateTransaction(editId, { ...base, type: 'dividend_cash', amount: amt, navSource: 'manual' })
      else addTransaction({ ...base, type: 'dividend_cash', amount: amt, navSource: 'manual' }) }
    else { const amt = parseFloat(previewState.reinvAmount); if (!amt || amt <= 0) { showToast('请填写再投资金额', 'error'); return }
      if (editId) updateTransaction(editId, { ...base, type: 'dividend_reinvest', amount: amt, nav: navRaw, confirmedShares: hasNav ? Math.round(amt / navRaw! * 100) / 100 : undefined })
      else addTransaction({ ...base, type: 'dividend_reinvest', amount: amt, nav: navRaw, shares: undefined, confirmedShares: hasNav ? Math.round(amt / navRaw! * 100) / 100 : undefined }) }
    showToast(editId ? '已更新' : '录入成功' + (!hasNav ? '，净值待回填' : ''), !hasNav ? 'info' : 'success')
    resetForm(); setSheetOpen(false)
  }

  function resetForm() { resetFormDefaults(); setEditId(null); setTxType('buy') }

  // ---- Filters ----
  const [filter, setFilter] = useState('all')
  const [sheetOpen, setSheetOpen] = useState(false)
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

  function openSheet(code?: string) {
    resetFormDefaults({ code: code || '' })
    if (code && code.length === 6) { setTimeout(() => lookupFundCode(code), 100) }
    setSheetOpen(true)
  }

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

  const sellHint = txType === 'sell' && fcodeRef.current?.value ? (() => { const pos = positions.find((p) => p.fundCode === fcodeRef.current!.value.trim() && !p.isCleared); return pos ? `可用份额：${shares(pos.totalShares)} 份` : '⚠ 无可用持仓' })() : null

  function EntryForm() {
    return (
      <form ref={formRef} onSubmit={handleSave}>
        <TypeTabs active={txType} onChange={(t) => { setTxType(t); setEditId(null) }} />
        <div className="grid grid-cols-2 gap-3">
          <div className="mb-3.5 min-w-0"><label className="block text-[13px] font-medium text-fg mb-1">基金代码</label><input ref={fcodeRef} className={inputCls} defaultValue="" onInput={(e) => { const v = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6); (e.target as HTMLInputElement).value = v; if (v.length === 6) lookupFundCode(v) }} placeholder="输入6位代码" maxLength={6} required /></div>
          <div className="mb-3.5 min-w-0"><label className="block text-[13px] font-medium text-fg mb-1">基金名称</label><input ref={fnameRef} className={inputClsText} defaultValue="" placeholder={lookingUp ? '查询中…' : '自动联想'} readOnly={lookingUp} /></div>
        </div>
        <div className="mb-3.5 min-w-0"><label className="block text-[13px] font-medium text-fg mb-1">交易日期</label><input className={inputClsText} type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} required /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="mb-3.5 min-w-0"><label className="block text-[13px] font-medium text-fg mb-1">单位净值<span className="text-muted font-normal text-xs ml-1">（可选）</span></label><input className={inputCls} type="number" name="nav" step="0.0001" min="0" defaultValue="" placeholder="可留空，后续回填" onInput={(e) => updatePS({ nav: (e.target as HTMLInputElement).value })} /></div>
        </div>
        {txType === 'buy' && <div className="mb-3.5 min-w-0"><label className="block text-[13px] font-medium text-fg mb-1">购买金额（元）</label><input className={inputCls} type="number" step="0.01" min="0" defaultValue="" placeholder="输入金额" onInput={(e) => updatePS({ buyAmount: (e.target as HTMLInputElement).value })} required /></div>}
        {txType === 'sell' && <div className="mb-3.5 min-w-0"><label className="block text-[13px] font-medium text-fg mb-1">卖出份额</label><input className={inputCls} type="number" step="0.01" min="0" defaultValue="" placeholder="输入份额" onInput={(e) => updatePS({ sellShares: (e.target as HTMLInputElement).value })} required />{sellHint && <div className="text-xs text-muted mt-1">{sellHint}</div>}</div>}
        {txType === 'dividend_cash' && <div className="mb-3.5 min-w-0"><label className="block text-[13px] font-medium text-fg mb-1">分红金额（元）</label><input className={inputCls} type="number" step="0.01" min="0" defaultValue="" placeholder="输入金额" onInput={(e) => updatePS({ divAmount: (e.target as HTMLInputElement).value })} required /></div>}
        {txType === 'dividend_reinvest' && <div className="mb-3.5 min-w-0"><label className="block text-[13px] font-medium text-fg mb-1">再投资金额（元）</label><input className={inputCls} type="number" step="0.01" min="0" defaultValue="" placeholder="输入金额" onInput={(e) => updatePS({ reinvAmount: (e.target as HTMLInputElement).value })} required /></div>}
        <div className="grid grid-cols-2 gap-3">
          <div className="mb-3.5 min-w-0"><label className="block text-[13px] font-medium text-fg mb-1">代销渠道</label><select className={inputClsText} name="channel" defaultValue="支付宝">{CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
          <div className="mb-3.5 min-w-0"><label className="block text-[13px] font-medium text-fg mb-1">交易费率（%）</label><input className={inputCls} type="number" step="0.01" min="0" max="100" defaultValue="0.15" onInput={(e) => updatePS({ feeRate: (e.target as HTMLInputElement).value })} /></div>
        </div>
        {(txType === 'buy' || txType === 'sell') && <div className="mb-3.5 min-w-0"><label className="block text-[13px] font-medium text-fg mb-1">手续费（元）{autoFee ? ' — 自动计算' : ''}</label><input className={inputCls} type="number" step="0.01" min="0" placeholder={autoFee || '输入手续费'} defaultValue="" onInput={(e) => updatePS({ fee: (e.target as HTMLInputElement).value })} /></div>}
        {preview && <div className="bg-accent-light px-3 py-3 rounded-sm mb-3.5 text-[13px] space-y-1">{(txType === 'buy' || txType === 'dividend_reinvest') && <div><strong>预计确认份额：</strong><span className="font-mono tabular-nums">{preview.shares}</span> 份</div>}{txType === 'sell' && <div><strong>预计到账金额：</strong><span className="font-mono tabular-nums">{preview.amount}</span> 元</div>}{(txType === 'buy' || txType === 'sell') && <div><strong>预计手续费：</strong><span className="font-mono tabular-nums">{preview.fee}</span> 元</div>}</div>}
        <div className="flex gap-2 flex-wrap">{editId && <Button variant="secondary" size="sm" onClick={resetForm}>取消编辑</Button>}<Button type="submit">{editId ? '更新' : '保存录入'}</Button><Button type="button" variant="secondary" onClick={resetForm}>重置</Button></div>
      </form>
    )
  }

  return (
    <div className="flex flex-col pc:grid pc:grid-cols-[38fr_62fr] gap-4 pc:gap-6 items-start">
      {isPC && (
        <div className="bg-surface border border-border rounded-md p-4 pc:p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4"><h2 className="text-base font-semibold">{editId ? '编辑交易' : '录入交易'}</h2>{editId && <Button variant="secondary" size="xs" onClick={resetForm}>取消编辑</Button>}</div>
          <EntryForm />
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
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2"><div className="text-[15px] font-semibold leading-snug">{t.fundName}</div><span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${TX_BADGE[t.navSource === 'init' ? 'init' : t.type] ?? TX_BADGE.buy}`}>{TX_BADGE_LABEL[t.navSource === 'init' ? 'init' : t.type] ?? t.type}</span></div>
                      <div className="text-[11px] text-muted">{t.fundCode}</div>
                    </div>
                    <div className="text-right shrink-0"><div className={`text-lg font-semibold font-mono tabular-nums leading-tight ${amtCls}`}>{amountDisplay}</div><div className="text-[11px] text-muted mt-0.5">{t.tradeDate}</div></div>
                  </div>
                  {expanded && (
                    <div className="px-3.5 pb-3.5 border-t border-border pt-3">
                      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs"><dt className="text-muted">交易日期</dt><dd className="font-mono">{t.tradeDate}</dd><dt className="text-muted">单位净值</dt><dd className="font-mono">{t.nav != null ? fmtNav(t.nav) : '—'}</dd><dt className="text-muted">确认份额</dt><dd className="font-mono">{t.confirmedShares != null ? shares(t.confirmedShares) : '—'}</dd><dt className="text-muted">代销渠道</dt><dd>{t.channel}</dd><dt className="text-muted">交易费率</dt><dd className="font-mono">{(t.feeRate * 100).toFixed(2)}%</dd>{t.fee != null && <><dt className="text-muted">手续费</dt><dd className="font-mono">{money(t.fee)} 元</dd></>}</dl>
                      <div className="flex gap-2 mt-3">
                        {isPending ? <Button variant="ghost" size="xs" onClick={(e) => { e.stopPropagation(); setBackfillId(t.id); setBackfillNav('') }}>回填</Button> : <Button variant="ghost" size="xs" onClick={(e) => { e.stopPropagation(); sessionStorage.setItem('edit-tx-id', t.id); openSheet() }}>编辑</Button>}
                        <Button variant="primary" size="xs" onClick={(e) => { e.stopPropagation(); openSheet(t.fundCode) }}>再买一笔</Button>
                        <Button variant="danger" size="xs" onClick={(e) => { e.stopPropagation(); setDeleteId(t.id) }}>删除</Button>
                      </div>
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
        <div className="fixed inset-0 bg-black/40 z-[1500] flex items-end" onClick={(e) => { if (e.target === e.currentTarget) { setSheetOpen(false); resetForm() } }}>
          <div ref={sheetRef} className="bg-surface rounded-t-xl w-full max-h-[88vh] overflow-y-auto overscroll-contain p-5 pb-[calc(20px+env(safe-area-inset-bottom,0))]" style={{ WebkitOverflowScrolling: 'touch' }}>
            <div className="flex items-center justify-between mb-4"><div className="w-9 h-1 bg-border rounded-sm" /><button className="w-8 h-8 flex items-center justify-center rounded-full text-muted hover:bg-bg transition-colors text-lg leading-none shrink-0" onClick={() => { setSheetOpen(false); resetForm() }} aria-label="关闭">×</button></div>
            <h3 className="text-[17px] font-semibold mb-4 text-center">{editId ? '编辑交易' : '录入交易'}</h3>
            <EntryForm />
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
