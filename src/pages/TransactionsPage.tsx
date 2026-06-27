import { useState, useMemo } from 'react'
import type { Transaction, TransactionType } from '../types'
import { useFundStore } from '../stores/useFundStore'
import { fetchLatestNav } from '../services/fundData'
import { aggregatePositions } from '../utils/calculator'
import { money, shares, nav as fmtNav } from '../utils/format'
import type { NavEntry } from '../utils/calculator'
import { showToast } from '../components/Toast'
import Button from '../components/Button'
import FormInput from '../components/FormInput'
import FormSelect from '../components/FormSelect'
import TypeTabs from '../components/TypeTabs'
import FilterPills from '../components/FilterPills'
import Badge from '../components/Badge'
import ConfirmDialog from '../components/ConfirmDialog'
import DataTable from '../components/DataTable'
import type { Column } from '../components/DataTable'

// ---- form state ----

interface FormState {
  fundCode: string
  fundName: string
  tradeDate: string
  nav: string        // user input, may be empty
  buyAmount: string
  sellShares: string
  dividendAmount: string
  reinvestAmount: string
  channel: string
  feeRate: string
  fee: string           // 手续费金额，自动计算后可手动改
}

const emptyForm: FormState = {
  fundCode: '', fundName: '', tradeDate: new Date().toISOString().slice(0, 10),
  nav: '', buyAmount: '', sellShares: '', dividendAmount: '', reinvestAmount: '',
  channel: '支付宝', feeRate: '0.15', fee: '',
}

const channels = ['支付宝', '天天基金', '理财通', '招商银行', '平安银行', '兴业银行', '交通银行']

const filterPills = [
  { key: 'all', label: '全部' },
  { key: 'confirmed', label: '已确认' },
  { key: 'pending', label: '待回填' },
  { key: 'init', label: '初始化' },
  { key: 'cleared', label: '已清仓' },
]

// ---- component ----

export default function TransactionsPage() {
  const storeTransactions = useFundStore((s) => s.transactions)
  const storeNavCache = useFundStore((s) => s.navCache)
  const addTransaction = useFundStore((s) => s.addTransaction)
  const updateTransaction = useFundStore((s) => s.updateTransaction)
  const deleteTransaction = useFundStore((s) => s.deleteTransaction)
  const batchFillNav = useFundStore((s) => s.batchFillNav)

  // Fallback to raw localStorage if Zustand rehydration hasn't fired
  const { transactions, navCache } = useMemo(() => {
    let txs = storeTransactions
    let cache = storeNavCache
    if (txs.length === 0) {
      try {
        const raw = localStorage.getItem('fund-ledger-v1')
        if (raw) {
          const parsed = JSON.parse(raw)
          const state = parsed?.state ?? parsed
          if (state?.transactions?.length > 0) {
            txs = state.transactions as Transaction[]
            cache = (state.navCache ?? {}) as Record<string, NavEntry>
          }
        }
      } catch { /* ignore */ }
    }
    return { transactions: txs, navCache: cache }
  }, [storeTransactions, storeNavCache])

  // Compute positions locally — always in sync with transactions
  const positions = useMemo(
    () => aggregatePositions(transactions, navCache),
    [transactions, navCache],
  )

  const [form, setForm] = useState<FormState>(emptyForm)
  const [txType, setTxType] = useState<TransactionType>('buy')
  const [filter, setFilter] = useState('all')
  const [editId, setEditId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [backfillId, setBackfillId] = useState<string | null>(null)
  const [backfillNav, setBackfillNav] = useState('')
  const [lookingUp, setLookingUp] = useState(false)

  // ---- fund lookup (PRD §5.1: fetchLatestNav on blur) ----

  async function handleFundBlur() {
    const code = form.fundCode.trim()
    if (code.length !== 6 || !/^\d{6}$/.test(code)) return
    setLookingUp(true)
    try {
      const data = await fetchLatestNav(code)
      setForm((f) => ({ ...f, fundName: data.name }))
    } catch {
      // JSONP failed — try the full fund list as fallback
      try {
        const { searchFundName } = await import('../services/fundData')
        const results = await searchFundName(code)
        const match = results.find((r) => r.code === code)
        if (match) {
          setForm((f) => ({ ...f, fundName: match.name }))
        } else {
          setForm((f) => ({ ...f, fundName: '未找到，请手动输入' }))
        }
      } catch {
        setForm((f) => ({ ...f, fundName: '查询失败，请手动输入名称' }))
      }
    } finally {
      setLookingUp(false)
    }
  }

  // ---- auto-calc fee from rate ----

  const autoFee = useMemo(() => {
    const rate = parseFloat(form.feeRate) / 100 || 0
    if (rate <= 0) return ''
    if (txType === 'buy') {
      const amt = parseFloat(form.buyAmount)
      if (isNaN(amt) || amt <= 0) return ''
      return (amt * rate).toFixed(2)
    }
    if (txType === 'sell') {
      const nav = parseFloat(form.nav)
      const qty = parseFloat(form.sellShares)
      if (isNaN(nav) || isNaN(qty) || nav <= 0 || qty <= 0) return ''
      return (qty * nav * rate).toFixed(2)
    }
    return ''
  }, [form.buyAmount, form.sellShares, form.nav, form.feeRate, txType])

  // ---- preview ----

  const preview = useMemo(() => {
    const nav = parseFloat(form.nav)
    if (isNaN(nav) || nav <= 0) return null

    const rate = parseFloat(form.feeRate) / 100 || 0

    if (txType === 'buy') {
      const amt = parseFloat(form.buyAmount)
      if (isNaN(amt) || amt <= 0) return null
      const fee = amt * rate
      const net = amt - fee
      return { shares: shares(net / nav), amount: money(net), fee: money(fee) }
    }
    if (txType === 'sell') {
      const qty = parseFloat(form.sellShares)
      if (isNaN(qty) || qty <= 0) return null
      const gross = qty * nav
      const fee = gross * rate
      const rev = gross - fee
      return { shares: shares(qty), amount: money(rev), fee: money(fee) }
    }
    if (txType === 'dividend_cash') {
      const amt = parseFloat(form.dividendAmount)
      if (isNaN(amt) || amt <= 0) return null
      return { shares: '—', amount: money(amt), fee: '0.00' }
    }
    if (txType === 'dividend_reinvest') {
      const amt = parseFloat(form.reinvestAmount)
      if (isNaN(amt) || amt <= 0) return null
      return { shares: shares(amt / nav), amount: money(amt), fee: '0.00' }
    }
    return null
  }, [form, txType])

  // ---- save ----

  function handleSave(e: React.FormEvent) {
    e.preventDefault()

    const code = form.fundCode.trim()
    const name = form.fundName.trim()
    if (!code || !name) { showToast('请填写基金代码和名称', 'error'); return }

    const navRaw = form.nav ? parseFloat(form.nav) : undefined
    const feeRate = parseFloat(form.feeRate) / 100 || 0
    const hasNav = navRaw != null && !isNaN(navRaw) && navRaw > 0

    // Fee: use manual input if provided, else auto-calc from rate
    const manualFee = form.fee ? parseFloat(form.fee) : undefined
    const calcBuyFee = (gross: number) => Math.round(gross * feeRate * 100) / 100
    const calcSellFee = (shares: number, nav: number) => Math.round(shares * nav * feeRate * 100) / 100

    const base = {
      fundCode: code, fundName: name,
      tradeDate: form.tradeDate,
      channel: form.channel, feeRate,
      navSource: hasNav ? 'manual' as const : 'pending' as const,
    }

    if (txType === 'buy') {
      const amount = parseFloat(form.buyAmount)  // gross purchase amount
      if (!amount || amount <= 0) { showToast('请填写购买金额', 'error'); return }
      const fee = manualFee ?? (feeRate > 0 ? calcBuyFee(amount) : undefined)
      const netAmount = Math.round(amount * (1 - feeRate) * 100) / 100
      if (editId) {
        updateTransaction(editId, { ...base, type: 'buy', amount, nav: navRaw, fee,
          confirmedShares: hasNav ? Math.round(netAmount / navRaw! * 100) / 100 : undefined,
        })
      } else {
        addTransaction({ ...base, type: 'buy', amount, nav: navRaw, fee,
          shares: undefined,
          confirmedShares: hasNav ? Math.round(netAmount / navRaw! * 100) / 100 : undefined,
        })
      }
    } else if (txType === 'sell') {
      const shares = parseFloat(form.sellShares)
      if (!shares || shares <= 0) { showToast('请填写卖出份额', 'error'); return }
      // Validate against available shares
      const pos = positions.find((p) => p.fundCode === code && !p.isCleared)
      if (pos && shares > pos.totalShares) { showToast('卖出份额超出可用持仓', 'error'); return }
      const fee = manualFee ?? (hasNav && feeRate > 0 ? calcSellFee(shares, navRaw!) : undefined)
      const netRevenue = hasNav ? Math.round(shares * navRaw! * (1 - feeRate) * 100) / 100 : undefined
      if (editId) {
        updateTransaction(editId, { ...base, type: 'sell', shares, nav: navRaw, fee, amount: netRevenue })
      } else {
        addTransaction({ ...base, type: 'sell', shares, nav: navRaw, fee, amount: netRevenue })
      }
    } else if (txType === 'dividend_cash') {
      const amount = parseFloat(form.dividendAmount)
      if (!amount || amount <= 0) { showToast('请填写分红金额', 'error'); return }
      if (editId) {
        updateTransaction(editId, { ...base, type: 'dividend_cash', amount, navSource: 'manual' })
      } else {
        addTransaction({ ...base, type: 'dividend_cash', amount, navSource: 'manual' })
      }
    } else if (txType === 'dividend_reinvest') {
      const amount = parseFloat(form.reinvestAmount)
      if (!amount || amount <= 0) { showToast('请填写再投资金额', 'error'); return }
      if (editId) {
        updateTransaction(editId, { ...base, type: 'dividend_reinvest', amount, nav: navRaw,
          confirmedShares: hasNav ? Math.round(amount / navRaw! * 100) / 100 : undefined,
        })
      } else {
        addTransaction({ ...base, type: 'dividend_reinvest', amount, nav: navRaw,
          shares: undefined,
          confirmedShares: hasNav ? Math.round(amount / navRaw! * 100) / 100 : undefined,
        })
      }
    }

    showToast(editId ? '交易已更新' : '交易录入成功' + (!hasNav ? '，净值待回填' : ''), !hasNav ? 'info' : 'success')
    resetForm()
  }

  function resetForm() {
    setForm({ ...emptyForm, tradeDate: new Date().toISOString().slice(0, 10) })
    setEditId(null)
  }

  function handleEdit(tx: Transaction) {
    setEditId(tx.id)
    setTxType(tx.type)
    setForm({
      fundCode: tx.fundCode, fundName: tx.fundName,
      tradeDate: tx.tradeDate,
      nav: tx.nav != null ? String(tx.nav) : '',
      buyAmount: tx.type === 'buy' && tx.amount ? String(tx.amount) : '',
      sellShares: tx.type === 'sell' && tx.shares ? String(tx.shares) : '',
      dividendAmount: tx.type === 'dividend_cash' && tx.amount ? String(tx.amount) : '',
      reinvestAmount: tx.type === 'dividend_reinvest' && tx.amount ? String(tx.amount) : '',
      channel: tx.channel, feeRate: String(tx.feeRate * 100),
      fee: tx.fee != null ? String(tx.fee) : '',
    })
  }

  function handleBackfill(tx: Transaction) {
    setBackfillId(tx.id)
    setBackfillNav(tx.nav != null ? String(tx.nav) : '')
  }

  function confirmBackfill() {
    const nav = parseFloat(backfillNav)
    if (isNaN(nav) || nav <= 0) { showToast('请输入有效净值', 'error'); return }
    if (backfillId) {
      updateTransaction(backfillId, { nav: Math.round(nav * 10000) / 10000 })
      showToast('净值回填成功', 'success')
    }
    setBackfillId(null)
  }

  async function handleBatchBackfill() {
    const { success, fail } = await batchFillNav()
    showToast(`一键回填完成：成功 ${success} 条${fail > 0 ? `，失败 ${fail} 条` : ''}`, fail > 0 ? 'info' : 'success')
  }

  // ---- filtered & sorted transactions ----

  const filteredTxs = useMemo(() => {
    let list = [...transactions]
    if (filter === 'pending') list = list.filter((t) => t.navSource === 'pending')
    else if (filter === 'init') list = list.filter((t) => t.navSource === 'init')
    else if (filter === 'confirmed') list = list.filter((t) => t.navSource !== 'pending' && t.navSource !== 'init')
    // cleared filter: show only funds that are fully cleared (positions-based)
    else if (filter === 'cleared') {
      const clearedCodes = new Set(positions.filter((p) => p.isCleared).map((p) => p.fundCode))
      list = list.filter((t) => clearedCodes.has(t.fundCode))
    }
    list.sort((a, b) => b.tradeDate.localeCompare(a.tradeDate) || b.createdAt - a.createdAt)
    return list
  }, [transactions, filter, positions])

  // ---- table columns ----

  const columns: Column<Transaction>[] = [
    { key: 'date', title: '日期', render: (t) => t.tradeDate },
    { key: 'code', title: '基金代码', mono: true, render: (t) => t.fundCode },
    { key: 'name', title: '基金', render: (t) => (
      <span className="max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap block" title={t.fundName}>{t.fundName}</span>
    )},
    { key: 'type', title: '类型', render: (t) => {
      const colors: Record<string, string> = { buy: 'text-accent', sell: 'text-loss', dividend_cash: 'text-warn', dividend_reinvest: 'text-[#7e22ce]' }
      const labels: Record<string, string> = { buy: '买入', sell: '卖出', dividend_cash: '现金分红', dividend_reinvest: '红利再投资' }
      return <span className={`font-medium text-xs ${colors[t.type] ?? ''}`}>{labels[t.type] ?? t.type}</span>
    }},
    { key: 'amount', title: '金额/份额', mono: true, render: (t) => {
      if (t.type === 'sell') return t.shares != null ? `${shares(t.shares)} 份` : '—'
      return t.amount != null ? `${money(t.amount)} 元` : '—'
    }},
    { key: 'fee', title: '手续费', mono: true, render: (t) =>
      t.fee != null && t.fee > 0 ? <span className="text-muted">{money(t.fee)} 元</span> : <span className="text-flat">—</span>
    },
    { key: 'nav', title: '净值', mono: true, render: (t) =>
      t.nav != null ? fmtNav(t.nav) : <span className="text-warn">—</span>
    },
    { key: 'confirm', title: '确认份额/到账', mono: true, render: (t) => {
      if (t.type === 'sell') return t.amount != null ? <span className="text-loss font-medium">{money(t.amount)} 元</span> : '—'
      if (t.type === 'dividend_cash') return t.amount != null ? `${money(t.amount)} 元` : '—'
      return t.confirmedShares != null ? `${shares(t.confirmedShares)} 份` : '—'
    }},
    { key: 'status', title: '状态', render: (t) => <Badge status={
      t.navSource === 'pending' ? 'pending' :
      t.navSource === 'init' ? 'init' :
      positions.some((p) => p.fundCode === t.fundCode && p.isCleared) ? 'cleared' : 'confirmed'
    } />},
    { key: 'actions', title: '操作', render: (t) => (
      <div className="flex gap-1">
        {t.navSource === 'pending'
          ? <Button variant="ghost" size="xs" onClick={() => handleBackfill(t)}>回填</Button>
          : <Button variant="ghost" size="xs" onClick={() => handleEdit(t)}>编辑</Button>
        }
        <Button variant="danger" size="xs" onClick={() => setDeleteId(t.id)}>删除</Button>
      </div>
    )},
  ]

  // ---- position hint for sell validation ----

  const sellPositionHint = useMemo(() => {
    if (txType !== 'sell' || !form.fundCode) return null
    const pos = positions.find((p) => p.fundCode === form.fundCode.trim() && !p.isCleared)
    if (pos) return `当前可用份额：${shares(pos.totalShares)} 份`
    return '⚠ 该基金当前无可用持仓'
  }, [txType, form.fundCode, positions])

  // ---- render ----

  return (
    <div className="flex flex-col pc:grid pc:grid-cols-[38fr_62fr] gap-4 pc:gap-6 items-start">
      {/* === Left: Entry Form === */}
      <div className="bg-surface border border-border rounded-md p-4 pc:p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold tracking-wider text-fg">
            {editId ? '编辑交易' : '录入交易'}
          </h2>
          {editId && (
            <Button variant="secondary" size="xs" onClick={resetForm}>取消编辑</Button>
          )}
        </div>

        <TypeTabs active={txType} onChange={(t) => { setTxType(t); if (editId) setEditId(null) }} />

        <form onSubmit={handleSave}>
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="基金代码" id="fund-code" mono value={form.fundCode}
              onChange={(e) => setForm((f) => ({ ...f, fundCode: e.target.value }))}
              onBlur={handleFundBlur} placeholder="输入代码，失焦自动联想" required />
            <FormInput label="基金名称" id="fund-name" value={form.fundName}
              onChange={(e) => setForm((f) => ({ ...f, fundName: e.target.value }))}
              placeholder={lookingUp ? '查询中…' : '自动联想'} readOnly={lookingUp} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="交易日期" id="tx-date" type="date" value={form.tradeDate}
              onChange={(e) => setForm((f) => ({ ...f, tradeDate: e.target.value }))} required />
            <FormInput label="单位净值" id="tx-nav" mono optional type="number" step="0.0001" min="0"
              value={form.nav} onChange={(e) => setForm((f) => ({ ...f, nav: e.target.value }))}
              placeholder="未知可留空，后续自动回填" />
          </div>

          {/* Dynamic fields by type */}
          {txType === 'buy' && (
            <FormInput label="购买金额（元）" id="buy-amount" mono type="number" step="0.01" min="0"
              value={form.buyAmount} onChange={(e) => setForm((f) => ({ ...f, buyAmount: e.target.value }))}
              placeholder="请输入购买金额" required />
          )}
          {txType === 'sell' && (
            <>
              <FormInput label="卖出份额" id="sell-shares" mono type="number" step="0.01" min="0"
                value={form.sellShares} onChange={(e) => setForm((f) => ({ ...f, sellShares: e.target.value }))}
                placeholder="请输入卖出份额" hint={sellPositionHint ?? undefined} required />
            </>
          )}
          {txType === 'dividend_cash' && (
            <FormInput label="分红金额（元）" id="dividend-amount" mono type="number" step="0.01" min="0"
              value={form.dividendAmount} onChange={(e) => setForm((f) => ({ ...f, dividendAmount: e.target.value }))}
              placeholder="请输入分红金额" required />
          )}
          {txType === 'dividend_reinvest' && (
            <FormInput label="红利再投资金额（元）" id="reinvest-amount" mono type="number" step="0.01" min="0"
              value={form.reinvestAmount} onChange={(e) => setForm((f) => ({ ...f, reinvestAmount: e.target.value }))}
              placeholder="请输入再投资金额" required />
          )}

          <div className="grid grid-cols-2 gap-3">
            <FormSelect label="代销渠道" id="tx-channel" value={form.channel}
              onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}>
              {channels.map((c) => <option key={c} value={c}>{c}</option>)}
            </FormSelect>
            <FormInput label="交易费率（%）" id="tx-fee" mono type="number" step="0.01" min="0" max="100"
              value={form.feeRate} onChange={(e) => setForm((f) => ({ ...f, feeRate: e.target.value }))} />
          </div>

          {/* Fee amount — auto-calc from rate, manually editable */}
          {(txType === 'buy' || txType === 'sell') && (
            <FormInput
              label={`手续费（元）${autoFee ? ' — 自动计算' : ''}`}
              id="tx-fee-amount"
              mono
              type="number"
              step="0.01"
              min="0"
              placeholder={autoFee || '输入手续费'}
              value={form.fee || autoFee}
              hint={autoFee && form.fee && form.fee !== autoFee ? `已手动修改（费率推算：${autoFee} 元）` : undefined}
              onChange={(e) => setForm((f) => ({ ...f, fee: e.target.value }))}
            />
          )}

          {/* Preview */}
          {preview && (
            <div className="bg-accent-light px-3 py-3 rounded-sm mb-3.5 text-[13px] space-y-1">
              {(txType === 'buy' || txType === 'dividend_reinvest') && (
                <div><strong>预计确认份额：</strong><span className="font-mono tabular-nums">{preview.shares}</span> 份</div>
              )}
              {txType === 'sell' && (
                <div><strong>预计到账金额：</strong><span className="font-mono tabular-nums">{preview.amount}</span> 元</div>
              )}
              {(txType === 'buy' || txType === 'sell') && (
                <div><strong>预计手续费：</strong><span className="font-mono tabular-nums">{preview.fee}</span> 元</div>
              )}
              {txType === 'buy' && (
                <div><strong>净投入：</strong><span className="font-mono tabular-nums">{preview.amount}</span> 元</div>
              )}
            </div>
          )}

          <div className="flex gap-2 flex-wrap">
            <Button type="submit">{editId ? '更新交易' : '保存录入'}</Button>
            <Button type="button" variant="secondary" onClick={resetForm}>重置</Button>
          </div>
        </form>
      </div>

      {/* === Right: Transaction List === */}
      <div className="bg-surface border border-border rounded-md p-4 pc:p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="text-base font-semibold tracking-wider text-fg">交易流水</h2>
          <div className="flex gap-2 flex-wrap">
            <Button variant="secondary" size="sm" onClick={() => { setTxType('dividend_cash'); setEditId(null); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>补录分红</Button>
            <Button variant="warn" size="sm" onClick={handleBatchBackfill}>一键回填净值</Button>
          </div>
        </div>

        <div className="mb-3">
          <FilterPills pills={filterPills} active={filter} onChange={setFilter} />
        </div>

        <DataTable columns={columns} data={filteredTxs} rowKey={(t) => t.id} />
      </div>

      {/* Delete confirm */}
      <ConfirmDialog open={deleteId !== null} title="确认删除" message="确定要删除这条交易记录吗？此操作不可撤销。"
        onConfirm={() => { if (deleteId) { deleteTransaction(deleteId); showToast('已删除', 'info') } setDeleteId(null) }}
        onCancel={() => setDeleteId(null)} />

      {/* Backfill modal */}
      {backfillId && (() => {
        const tx = transactions.find((t) => t.id === backfillId)
        return (
          <div className="fixed inset-0 bg-black/40 z-[1500] flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) setBackfillId(null) }}>
            <div className="bg-surface rounded-lg p-6 max-w-[400px] w-full shadow-[0_20px_60px_rgba(0,0,0,0.2)]">
              <h3 className="text-base font-semibold mb-3">手动回填净值</h3>
              <div className="text-sm text-muted mb-2">基金：{tx?.fundName ?? '—'}</div>
              <div className="text-sm text-muted mb-4">交易日期：{tx?.tradeDate ?? '—'}</div>
              <label className="block text-[13px] font-medium text-fg mb-1">单位净值</label>
              <input className="w-full h-10 px-3 text-sm font-mono border border-accent rounded-sm outline-none focus:shadow-[0_0_0_2px_rgba(30,58,138,0.15)]"
                type="number" step="0.0001" min="0" value={backfillNav}
                onChange={(e) => setBackfillNav(e.target.value)} placeholder="输入净值" />
              <div className="flex gap-2 justify-end mt-5">
                <Button variant="secondary" size="sm" onClick={() => setBackfillId(null)}>取消</Button>
                <Button size="sm" onClick={confirmBackfill}>确认回填</Button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
