import { useState, useMemo, useEffect } from 'react'
import type { Transaction } from '../types'
import { useFundStore } from '../stores/useFundStore'
import { useIsPC } from '../hooks/useMediaQuery'
import { computeSignals } from '../utils/signalEngine'
import type { Signal } from '../utils/signalEngine'

const BAR_CLS: Record<string, string> = {
  reduce: 'bg-loss',
  add: 'bg-accent',
  watch: 'bg-warn',
}
const TAG_CLS: Record<string, string> = {
  reduce: 'bg-loss text-white',
  add: 'bg-accent text-white',
  watch: 'bg-warn text-white',
}

type SubTab = 'action' | 'watch'

export default function SignalPage() {
  const storeTransactions = useFundStore((s) => s.transactions)
  const storeNavCache = useFundStore((s) => s.navCache)
  const refreshLatestNav = useFundStore((s) => s.refreshLatestNav)
  const isPC = useIsPC()

  const [subTab, setSubTab] = useState<SubTab>('action')
  const [expandedSig, setExpandedSig] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Local cache fallback
  const { transactions, navCache } = useMemo(() => {
    let t = storeTransactions; let c = storeNavCache
    if (t.length === 0) {
      try { const raw = localStorage.getItem('fund-ledger-v1'); if (raw) { const p = JSON.parse(raw); const s = p?.state ?? p; if (s?.transactions?.length > 0) { t = s.transactions as Transaction[]; c = s.navCache ?? {} } } } catch { /* */ }
    }
    return { transactions: t, navCache: c }
  }, [storeTransactions, storeNavCache])

  // Show cached signals immediately, refresh silently in background
  const [refreshing, setRefreshing] = useState(false)
  useEffect(() => {
    const codes = [...new Set(transactions.map((t) => t.fundCode))]
    if (codes.length === 0) { setLoading(false); return }

    // Check if cache is fresh enough (today)
    const today = new Date().toISOString().slice(0, 10)
    const needRefresh = codes.some((c) => {
      const entry = navCache[c]
      return !entry || !entry.date || entry.date < today
    })

    if (!needRefresh) {
      setLoading(false)
      return
    }

    // Refresh in background — don't block rendering
    setLoading(false)
    setRefreshing(true)
    refreshLatestNav(codes).finally(() => setRefreshing(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const signals = useMemo(() => {
    if (transactions.length === 0) return []
    return computeSignals(transactions, navCache)
  }, [transactions, navCache])

  const actionSignals = useMemo(() => signals.filter((s) => s.type === 'action'), [signals])
  const watchSignals = useMemo(() => signals.filter((s) => s.type === 'watch'), [signals])
  const displayed = subTab === 'action' ? actionSignals : watchSignals

  function sigKey(s: Signal) { return `${s.rule}-${s.fundCode}` }

  if (loading) {
    return <div className="text-center py-16 text-muted">正在分析交易信号…</div>
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-base font-semibold tracking-wider text-fg">交易信号</h2>
        {refreshing && <span className="text-[11px] text-muted animate-pulse">刷新中…</span>}
      </div>

      {/* Sub tabs */}
      <div className="flex gap-2">
        <button
          className={`px-4 py-1.5 min-h-10 text-xs font-medium border rounded-full transition-colors ${subTab === 'action' ? 'bg-accent text-white border-accent' : 'bg-surface text-muted border-border'}`}
          onClick={() => setSubTab('action')}
        >
          ⚡ 操作信号（{actionSignals.length}）
        </button>
        <button
          className={`px-4 py-1.5 min-h-10 text-xs font-medium border rounded-full transition-colors ${subTab === 'watch' ? 'bg-accent text-white border-accent' : 'bg-surface text-muted border-border'}`}
          onClick={() => setSubTab('watch')}
        >
          👁 观察提醒（{watchSignals.length}）
        </button>
      </div>

      {displayed.length === 0 && (
        <div className="text-center py-16 text-muted">
          {subTab === 'action' ? '暂无操作信号 🎉' : '暂无观察提醒'}
        </div>
      )}

      {/* ---- Mobile Cards ---- */}
      {!isPC && (
        <div className="flex flex-col gap-2">
          {displayed.map((s) => {
            const key = sigKey(s)
            const expanded = expandedSig === key
            return (
              <div key={key} className={`bg-surface rounded-lg shadow-sm overflow-hidden cursor-pointer ${expanded ? '' : ''}`} onClick={() => setExpandedSig(expanded ? null : key)}>
                <div className="p-3.5 flex items-start gap-2.5">
                  <div className={`w-1 self-stretch rounded-sm shrink-0 ${BAR_CLS[s.dir]}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${TAG_CLS[s.dir]}`}>
                        {s.type === 'action' ? s.rule : s.prio}
                      </span>
                      <span className="text-[11px] text-muted truncate">{s.fundName} · {s.fundCode}</span>
                    </div>
                    <div className="text-sm font-semibold leading-snug">{s.title}</div>
                  </div>
                  <span className={`text-muted text-xs shrink-0 mt-1 transition-transform ${expanded ? 'rotate-180' : ''}`}>▾</span>
                </div>
                {expanded && (
                  <div className="px-3.5 pb-3.5 border-t border-border pt-2.5 ml-8">
                    {s.detail.map((d, i) => (
                      <div key={i} className="flex justify-between items-center py-0.5 text-xs">
                        <span className="text-muted">{d.label}</span>
                        <span className={`font-mono font-medium ${d.cls ?? ''}`}>{d.value}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ---- PC Table ---- */}
      {isPC && (
        <div className="overflow-x-auto border border-border rounded-md bg-surface">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className="bg-bg text-xs font-semibold tracking-wider text-muted text-left px-3 py-2.5 border-b-2 border-border w-12">优先级</th>
                <th className="bg-bg text-xs font-semibold tracking-wider text-muted text-left px-3 py-2.5 border-b-2 border-border w-16">规则</th>
                <th className="bg-bg text-xs font-semibold tracking-wider text-muted text-left px-3 py-2.5 border-b-2 border-border">基金</th>
                <th className="bg-bg text-xs font-semibold tracking-wider text-muted text-left px-3 py-2.5 border-b-2 border-border">信号内容</th>
                <th className="bg-bg text-xs font-semibold tracking-wider text-muted text-left px-3 py-2.5 border-b-2 border-border">操作</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map((s) => (
                <tr key={sigKey(s)} className="border-b border-border hover:bg-row-hover/50 last:border-b-0">
                  <td className="px-3 py-2.5 text-center">
                    {s.prio === '最高' ? '🔴' : s.prio === '高' ? '🟠' : s.prio === '缓冲期' ? '🔵' : '🟡'}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${TAG_CLS[s.dir]}`}>{s.rule}</span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{s.fundName}<br/><span className="text-xs text-muted">{s.fundCode}</span></td>
                  <td className="px-3 py-2.5 text-sm">{s.title}</td>
                  <td className="px-3 py-2.5 text-xs text-muted">{s.detail.find((d) => d.label === '建议操作')?.value ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
