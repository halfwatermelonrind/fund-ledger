import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useFundStore } from '../stores/useFundStore'
import { fetchLatestNav } from '../services/fundData'
import { showToast } from './Toast'
import Button from './Button'

// ---- types ----

interface ImportRow {
  key: number          // local unique key for React
  fundCode: string
  fundName: string
  costNav: string       // 成本净值
  shares: string        // 持仓份额
  channel: string
  lookingUp: boolean
}

let nextKey = 1

function emptyRow(): ImportRow {
  return {
    key: nextKey++,
    fundCode: '',
    fundName: '',
    costNav: '',
    shares: '',
    channel: '支付宝',
    lookingUp: false,
  }
}

const CHANNELS = ['支付宝', '天天基金', '理财通', '招商银行', '平安银行', '兴业银行', '交通银行', '汇丰银行', '建设银行']

// ---- component ----

interface Props {
  open: boolean
  onClose: () => void
}

export default function BatchImportModal({ open, onClose }: Props) {
  const { addTransaction } = useFundStore()
  const [tradeDate, setTradeDate] = useState(new Date().toISOString().slice(0, 10))
  const [rows, setRows] = useState<ImportRow[]>([emptyRow()])
  const [importing, setImporting] = useState(false)

  function updateRow(key: number, patch: Partial<ImportRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function removeRow(key: number) {
    setRows((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((r) => r.key !== key)
    })
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()])
  }

  // ---- fund name lookup ----

  async function lookupFund(key: number, code: string) {
    if (code.length !== 6 || !/^\d{6}$/.test(code)) return
    updateRow(key, { lookingUp: true })
    try {
      const data = await fetchLatestNav(code)
      updateRow(key, { fundName: data.name, lookingUp: false })
    } catch {
      updateRow(key, { fundName: '查询失败，请手动输入', lookingUp: false })
    }
  }

  // ---- import ----

  async function handleImport() {
    const valid: ImportRow[] = []
    const errors: string[] = []

    for (const r of rows) {
      const code = r.fundCode.trim()
      const name = r.fundName.trim()
      const nav = parseFloat(r.costNav)
      const sh = parseFloat(r.shares)

      if (!code || code.length !== 6) { errors.push(`基金代码无效：${code || '空'}`); continue }
      if (!name) { errors.push(`基金名称缺失：${code}`); continue }
      if (isNaN(nav) || nav <= 0) { errors.push(`${code} 成本净值无效`); continue }
      if (isNaN(sh) || sh <= 0) { errors.push(`${code} 持仓份额无效`); continue }

      valid.push(r)
    }

    if (valid.length === 0) {
      showToast(errors[0] ?? '没有有效数据', 'error')
      return
    }

    setImporting(true)
    try {
      for (const r of valid) {
        const nav = parseFloat(r.costNav)
        const sh = parseFloat(r.shares)
        const amount = Math.round(sh * nav * 100) / 100

        addTransaction({
          fundCode: r.fundCode.trim(),
          fundName: r.fundName.trim(),
          type: 'buy',
          tradeDate,
          nav: Math.round(nav * 10000) / 10000,
          amount,
          confirmedShares: sh,
          channel: r.channel,
          feeRate: 0,
          fee: 0,
          navSource: 'init',
        })
      }

      showToast(`成功导入 ${valid.length} 条持仓`, 'success')
      if (errors.length > 0) {
        showToast(`跳过 ${errors.length} 条：${errors[0]}`, 'info')
      }
      setRows([emptyRow()])
      onClose()
    } catch {
      showToast('导入失败', 'error')
    } finally {
      setImporting(false)
    }
  }

  function handleClear() {
    setRows([emptyRow()])
  }

  // ----

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/40 z-[1500] flex items-start justify-center pt-[10vh] p-4 overflow-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-surface rounded-lg p-6 max-w-[720px] w-full shadow-[0_20px_60px_rgba(0,0,0,0.2)] max-h-[85vh] overflow-auto">
        <h2 className="text-base font-semibold mb-1">批量导入持仓</h2>
        <p className="text-xs text-muted mb-4">
          输入已有的基金持仓数据，系统将自动创建对应的买入记录。成本净值应为平均持仓成本。
        </p>

        {/* Trade date */}
        <div className="mb-4">
          <label className="block text-[13px] font-medium text-fg mb-1">导入日期</label>
          <input
            type="date"
            className="w-40 h-9 px-3 text-sm border border-border rounded-sm outline-none focus:border-accent"
            value={tradeDate}
            onChange={(e) => setTradeDate(e.target.value)}
          />
        </div>

        {/* Table header */}
        <div className="hidden pc:grid pc:grid-cols-[1fr_1.2fr_0.8fr_0.8fr_0.8fr_40px] gap-2 mb-2 text-xs font-semibold text-muted tracking-wider uppercase">
          <span>基金代码</span>
          <span>基金名称</span>
          <span>成本净值</span>
          <span>持仓份额</span>
          <span>渠道</span>
          <span />
        </div>

        {/* Rows */}
        <div className="flex flex-col gap-2 mb-4">
          {rows.map((r) => (
            <div key={r.key} className="flex flex-col pc:grid pc:grid-cols-[1fr_1.2fr_0.8fr_0.8fr_0.8fr_40px] gap-2 items-start pc:items-center p-2 border border-border rounded-sm">
              {/* Fund code */}
              <input
                className="w-full h-9 px-2 text-sm font-mono border border-border rounded-sm outline-none focus:border-accent"
                placeholder="6位代码"
                maxLength={6}
                value={r.fundCode}
                onChange={(e) => updateRow(r.key, { fundCode: e.target.value })}
                onBlur={(e) => lookupFund(r.key, e.target.value)}
              />
              {/* Fund name */}
              <input
                className="w-full h-9 px-2 text-sm border border-border rounded-sm outline-none focus:border-accent"
                placeholder={r.lookingUp ? '查询中…' : '自动联想'}
                value={r.fundName}
                onChange={(e) => updateRow(r.key, { fundName: e.target.value })}
                readOnly={r.lookingUp}
              />
              {/* Cost NAV */}
              <input
                className="w-full h-9 px-2 text-sm font-mono border border-border rounded-sm outline-none focus:border-accent"
                placeholder="成本净值"
                type="number"
                step="0.0001"
                min="0"
                value={r.costNav}
                onChange={(e) => updateRow(r.key, { costNav: e.target.value })}
              />
              {/* Shares */}
              <input
                className="w-full h-9 px-2 text-sm font-mono border border-border rounded-sm outline-none focus:border-accent"
                placeholder="份额"
                type="number"
                step="0.01"
                min="0"
                value={r.shares}
                onChange={(e) => updateRow(r.key, { shares: e.target.value })}
              />
              {/* Channel */}
              <select
                className="w-full h-9 px-2 text-sm border border-border rounded-sm outline-none focus:border-accent"
                value={r.channel}
                onChange={(e) => updateRow(r.key, { channel: e.target.value })}
              >
                {CHANNELS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {/* Remove */}
              <button
                className="w-9 h-9 flex items-center justify-center border border-border rounded-sm text-muted hover:text-gain hover:border-gain transition-colors shrink-0"
                title="移除"
                onClick={() => removeRow(r.key)}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={addRow}>
            <Plus className="w-4 h-4" /> 添加基金
          </Button>
          <Button size="sm" onClick={handleImport} disabled={importing}>
            {importing ? '导入中…' : `导入 ${rows.length} 条`}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleClear}>清空</Button>
        </div>

        <div className="text-xs text-muted mt-4">
          提示：导入后可在「交易流水」中看到对应的买入记录，持仓盈亏正常计算。如需调整数据，可编辑或删除对应交易。
        </div>
      </div>
    </div>
  )
}
