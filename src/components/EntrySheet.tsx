import { useState, useMemo, useEffect } from 'react'
import type { TransactionType } from '../types'
import { useFundStore } from '../stores/useFundStore'
import { fetchLatestNav } from '../services/fundData'
import { aggregatePositions } from '../utils/calculator'
import { showToast } from './Toast'
import Button from './Button'
import TypeTabs from './TypeTabs'
import { money, shares } from '../utils/format'

const CHANNELS = ['支付宝', '天天基金', '理财通', '招商银行', '平安银行', '兴业银行', '交通银行', '汇丰银行', '建设银行']

interface FormState { fundCode: string; fundName: string; tradeDate: string; nav: string; buyAmount: string; sellShares: string; dividendAmount: string; reinvestAmount: string; channel: string; feeRate: string; fee: string }
const emptyForm: FormState = { fundCode: '', fundName: '', tradeDate: new Date().toISOString().slice(0, 10), nav: '', buyAmount: '', sellShares: '', dividendAmount: '', reinvestAmount: '', channel: '支付宝', feeRate: '0.15', fee: '' }

interface Props {
  editId: string | null
  prefilledCode?: string
  onClose: () => void
}

export default function EntrySheet({ editId: initialEditId, prefilledCode, onClose }: Props) {
  const { transactions, addTransaction, updateTransaction } = useFundStore()
  const positions = useMemo(() => aggregatePositions(transactions, {}), [transactions])

  const [form, setForm] = useState<FormState>(emptyForm)
  const [txType, setTxType] = useState<TransactionType>('buy')
  const [editId, setEditId] = useState<string | null>(initialEditId)
  const [lookingUp, setLookingUp] = useState(false)

  // Load edit target
  useEffect(() => {
    const id = sessionStorage.getItem('edit-tx-id')
    if (!id) return
    sessionStorage.removeItem('edit-tx-id')
    const tx = transactions.find((t) => t.id === id)
    if (!tx) return
    setEditId(tx.id); setTxType(tx.type)
    setForm({ fundCode: tx.fundCode, fundName: tx.fundName, tradeDate: tx.tradeDate, nav: tx.nav != null ? String(tx.nav) : '', buyAmount: tx.type === 'buy' && tx.amount ? String(tx.amount) : '', sellShares: tx.type === 'sell' && tx.shares ? String(tx.shares) : '', dividendAmount: tx.type === 'dividend_cash' && tx.amount ? String(tx.amount) : '', reinvestAmount: tx.type === 'dividend_reinvest' && tx.amount ? String(tx.amount) : '', channel: tx.channel, feeRate: String(tx.feeRate * 100), fee: tx.fee != null ? String(tx.fee) : '' })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Prefill code
  useEffect(() => {
    if (prefilledCode && prefilledCode.length === 6) {
      setForm((f) => ({ ...f, fundCode: prefilledCode }))
      lookupFund(prefilledCode)
    } else if (prefilledCode) {
      setForm((f) => ({ ...f, fundCode: prefilledCode }))
    }
  }, [prefilledCode]) // eslint-disable-line react-hooks/exhaustive-deps

  async function lookupFund(code: string) {
    if (code.length !== 6 || !/^\d{6}$/.test(code)) return
    setLookingUp(true)
    try { const data = await fetchLatestNav(code); setForm((f) => ({ ...f, fundName: data.name })) }
    catch { try { const m = await import('../services/fundData'); const r = await m.searchFundName(code); const m2 = r.find((x) => x.code === code); setForm((f) => ({ ...f, fundName: m2 ? m2.name : '未找到' })) } catch { setForm((f) => ({ ...f, fundName: '查询失败' })) } }
    finally { setLookingUp(false) }
  }

  const preview = useMemo(() => {
    const n = parseFloat(form.nav); if (isNaN(n) || n <= 0) return null
    const rate = parseFloat(form.feeRate) / 100 || 0
    if (txType === 'buy') { const amt = parseFloat(form.buyAmount); if (isNaN(amt) || amt <= 0) return null; const fee = amt * rate; return { shares: shares((amt - fee) / n), amount: money(amt - fee), fee: money(fee) } }
    if (txType === 'sell') { const q = parseFloat(form.sellShares); if (isNaN(q) || q <= 0) return null; const g = q * n; const fee = g * rate; return { shares: shares(q), amount: money(g - fee), fee: money(fee) } }
    return null
  }, [form, txType])

  const autoFee = useMemo(() => {
    const rate = parseFloat(form.feeRate) / 100 || 0; if (rate <= 0) return ''
    if (txType === 'buy') { const amt = parseFloat(form.buyAmount); if (isNaN(amt) || amt <= 0) return ''; return money(amt * rate) }
    if (txType === 'sell') { const n = parseFloat(form.nav); const q = parseFloat(form.sellShares); if (isNaN(n) || isNaN(q) || n <= 0 || q <= 0) return ''; return money(q * n * rate) }
    return ''
  }, [form.buyAmount, form.sellShares, form.nav, form.feeRate, txType])

  const sellHint = useMemo(() => {
    if (txType !== 'sell' || !form.fundCode) return null
    const pos = positions.find((p) => p.fundCode === form.fundCode.trim() && !p.isCleared)
    return pos ? `可用份额：${shares(pos.totalShares)} 份` : '⚠ 无可用持仓'
  }, [txType, form.fundCode, positions])

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    const code = form.fundCode.trim(); const name = form.fundName.trim()
    if (!code || !name) { showToast('请填写基金代码和名称', 'error'); return }
    const navRaw = form.nav ? parseFloat(form.nav) : undefined; const feeRate = parseFloat(form.feeRate) / 100 || 0
    const hasNav = navRaw != null && !isNaN(navRaw) && navRaw > 0
    const manualFee = form.fee ? parseFloat(form.fee) : undefined
    const calcBuyFee = (g: number) => Math.round(g * feeRate * 100) / 100
    const calcSellFee = (s: number, n: number) => Math.round(s * n * feeRate * 100) / 100
    const base = { fundCode: code, fundName: name, tradeDate: form.tradeDate, channel: form.channel, feeRate, navSource: hasNav ? 'manual' as const : 'pending' as const }

    if (txType === 'buy') { const amt = parseFloat(form.buyAmount); if (!amt || amt <= 0) { showToast('请填写购买金额', 'error'); return }; const fee = manualFee ?? (feeRate > 0 ? calcBuyFee(amt) : undefined); const net = Math.round(amt * (1 - feeRate) * 100) / 100
      if (editId) updateTransaction(editId, { ...base, type: 'buy', amount: amt, nav: navRaw, fee, confirmedShares: hasNav ? Math.round(net / navRaw! * 100) / 100 : undefined })
      else addTransaction({ ...base, type: 'buy', amount: amt, nav: navRaw, fee, shares: undefined, confirmedShares: hasNav ? Math.round(net / navRaw! * 100) / 100 : undefined }) }
    else if (txType === 'sell') { const sh = parseFloat(form.sellShares); if (!sh || sh <= 0) { showToast('请填写卖出份额', 'error'); return }; const pos = positions.find((p) => p.fundCode === code && !p.isCleared); if (pos && sh > pos.totalShares) { showToast('卖出份额超出持仓', 'error'); return }; const fee = manualFee ?? (hasNav && feeRate > 0 ? calcSellFee(sh, navRaw!) : undefined); const net = hasNav ? Math.round(sh * navRaw! * (1 - feeRate) * 100) / 100 : undefined
      if (editId) updateTransaction(editId, { ...base, type: 'sell', shares: sh, nav: navRaw, fee, amount: net })
      else addTransaction({ ...base, type: 'sell', shares: sh, nav: navRaw, fee, amount: net }) }
    else if (txType === 'dividend_cash') { const amt = parseFloat(form.dividendAmount); if (!amt || amt <= 0) { showToast('请填写分红金额', 'error'); return }
      if (editId) updateTransaction(editId, { ...base, type: 'dividend_cash', amount: amt, navSource: 'manual' })
      else addTransaction({ ...base, type: 'dividend_cash', amount: amt, navSource: 'manual' }) }
    else { const amt = parseFloat(form.reinvestAmount); if (!amt || amt <= 0) { showToast('请填写再投资金额', 'error'); return }
      if (editId) updateTransaction(editId, { ...base, type: 'dividend_reinvest', amount: amt, nav: navRaw, confirmedShares: hasNav ? Math.round(amt / navRaw! * 100) / 100 : undefined })
      else addTransaction({ ...base, type: 'dividend_reinvest', amount: amt, nav: navRaw, shares: undefined, confirmedShares: hasNav ? Math.round(amt / navRaw! * 100) / 100 : undefined }) }
    showToast(editId ? '已更新' : '录入成功' + (!hasNav ? '，净值待回填' : ''), !hasNav ? 'info' : 'success')
    resetForm(); onClose()
  }

  function resetForm() { setForm({ ...emptyForm, tradeDate: new Date().toISOString().slice(0, 10) }); setEditId(null); setTxType('buy') }

  const iCls = (mono?: boolean) => `w-full h-11 px-3 text-base ${mono ? 'font-mono tabular-nums' : 'font-body'} text-fg bg-surface border border-border rounded-sm outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(30,58,138,0.1)] placeholder:text-flat`

  return (
    <form onSubmit={handleSave}>
      <TypeTabs active={txType} onChange={(t) => { setTxType(t); setEditId(null) }} />
      <div className="grid grid-cols-2 gap-3">
        <div className="mb-3.5 min-w-0"><label className="block text-[13px] font-medium text-fg mb-1">基金代码</label><input className={iCls(true)} value={form.fundCode} onChange={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setForm((f) => ({ ...f, fundCode: v })); if (v.length === 6) lookupFund(v) }} placeholder="输入6位代码" maxLength={6} required /></div>
        <div className="mb-3.5 min-w-0"><label className="block text-[13px] font-medium text-fg mb-1">基金名称</label><input className={iCls()} value={form.fundName} onChange={(e) => setForm((f) => ({ ...f, fundName: e.target.value }))} placeholder={lookingUp ? '查询中…' : '自动联想'} readOnly={lookingUp} /></div>
      </div>
      <div className="mb-3.5 min-w-0"><label className="block text-[13px] font-medium text-fg mb-1">交易日期</label><input className={iCls()} type="date" value={form.tradeDate} onChange={(e) => setForm((f) => ({ ...f, tradeDate: e.target.value }))} required /></div>
      <div className="grid grid-cols-2 gap-3">
        <div className="mb-3.5 min-w-0"><label className="block text-[13px] font-medium text-fg mb-1">单位净值<span className="text-muted font-normal text-xs ml-1">（可选）</span></label><input className={iCls(true)} type="number" step="0.0001" min="0" value={form.nav} onChange={(e) => setForm((f) => ({ ...f, nav: e.target.value }))} placeholder="可留空，后续回填" /></div>
      </div>
      {txType === 'buy' && <div className="mb-3.5 min-w-0"><label className="block text-[13px] font-medium text-fg mb-1">购买金额（元）</label><input className={iCls(true)} type="number" step="0.01" min="0" value={form.buyAmount} onChange={(e) => setForm((f) => ({ ...f, buyAmount: e.target.value }))} placeholder="输入金额" required /></div>}
      {txType === 'sell' && <div className="mb-3.5 min-w-0"><label className="block text-[13px] font-medium text-fg mb-1">卖出份额</label><input className={iCls(true)} type="number" step="0.01" min="0" value={form.sellShares} onChange={(e) => setForm((f) => ({ ...f, sellShares: e.target.value }))} placeholder="输入份额" required />{sellHint && <div className="text-xs text-muted mt-1">{sellHint}</div>}</div>}
      {txType === 'dividend_cash' && <div className="mb-3.5 min-w-0"><label className="block text-[13px] font-medium text-fg mb-1">分红金额（元）</label><input className={iCls(true)} type="number" step="0.01" min="0" value={form.dividendAmount} onChange={(e) => setForm((f) => ({ ...f, dividendAmount: e.target.value }))} placeholder="输入金额" required /></div>}
      {txType === 'dividend_reinvest' && <div className="mb-3.5 min-w-0"><label className="block text-[13px] font-medium text-fg mb-1">再投资金额（元）</label><input className={iCls(true)} type="number" step="0.01" min="0" value={form.reinvestAmount} onChange={(e) => setForm((f) => ({ ...f, reinvestAmount: e.target.value }))} placeholder="输入金额" required /></div>}
      <div className="grid grid-cols-2 gap-3">
        <div className="mb-3.5 min-w-0"><label className="block text-[13px] font-medium text-fg mb-1">代销渠道</label><select className={iCls()} value={form.channel} onChange={(e) => setForm((f) => ({ ...f, channel: e.target.value }))}>{CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
        <div className="mb-3.5 min-w-0"><label className="block text-[13px] font-medium text-fg mb-1">交易费率（%）</label><input className={iCls(true)} type="number" step="0.01" min="0" max="100" value={form.feeRate} onChange={(e) => setForm((f) => ({ ...f, feeRate: e.target.value }))} /></div>
      </div>
      {(txType === 'buy' || txType === 'sell') && <div className="mb-3.5 min-w-0"><label className="block text-[13px] font-medium text-fg mb-1">手续费（元）{autoFee ? ' — 自动计算' : ''}</label><input className={iCls(true)} type="number" step="0.01" min="0" placeholder={autoFee || '输入手续费'} value={form.fee || autoFee} onChange={(e) => setForm((f) => ({ ...f, fee: e.target.value }))} /></div>}
      {preview && <div className="bg-accent-light px-3 py-3 rounded-sm mb-3.5 text-[13px] space-y-1">{(txType === 'buy' || txType === 'dividend_reinvest') && <div><strong>预计确认份额：</strong><span className="font-mono tabular-nums">{preview.shares}</span> 份</div>}{txType === 'sell' && <div><strong>预计到账金额：</strong><span className="font-mono tabular-nums">{preview.amount}</span> 元</div>}{(txType === 'buy' || txType === 'sell') && <div><strong>预计手续费：</strong><span className="font-mono tabular-nums">{preview.fee}</span> 元</div>}</div>}
      <div className="flex gap-2 flex-wrap">{editId && <Button variant="secondary" size="sm" onClick={resetForm}>取消编辑</Button>}<Button type="submit">{editId ? '更新' : '保存录入'}</Button><Button type="button" variant="secondary" onClick={resetForm}>重置</Button></div>
    </form>
  )
}
