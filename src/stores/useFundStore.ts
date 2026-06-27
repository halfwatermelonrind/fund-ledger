/**
 * ============================================================
 *  useFundStore.ts — Zustand 全局状态管理
 *
 *  Persisted (localStorage key: fund-ledger-v1):
 *    - transactions
 *    - navCache
 *
 *  Derived (recomputed after every mutation):
 *    - positions
 *
 *  Transient (not persisted):
 *    - isLoading
 * ============================================================
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Transaction, Position } from '../types'
import { aggregatePositions } from '../utils/calculator'
import type { NavEntry } from '../utils/calculator'
import { fetchLatestNav, fetchHistoryNav } from '../services/fundData'

// ============================================================
// Type helpers
// ============================================================

/** Fields the store auto-generates when adding a transaction */
type NewTransaction = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>

// ============================================================
// Store shape
// ============================================================

interface FundState {
  /** All transaction records (persisted) */
  transactions: Transaction[]
  /** Cached latest NAV + estimate per fundCode (persisted) */
  navCache: Record<string, NavEntry>
  /** Derived positions — aggregated from transactions + navCache */
  positions: Position[]
  /** True while a network operation is in flight */
  isLoading: boolean
}

interface FundActions {
  addTransaction: (tx: NewTransaction) => void
  updateTransaction: (id: string, patch: Partial<Transaction>) => void
  deleteTransaction: (id: string) => void

  /** Scan pending records, fetch historical NAV, fill back confirmed shares */
  batchFillNav: () => Promise<{ success: number; fail: number }>

  /** Refresh latest NAV + estimate for all (or specified) funds */
  refreshLatestNav: (fundCodes?: string[]) => Promise<void>

  /** Remove all local data (caller should confirm first) */
  clearAllData: () => void

  /** Export all persisted data as a JSON string */
  exportData: () => string

  /** Import JSON and overwrite current state */
  importData: (json: string) => void
}

export type FundStore = FundState & FundActions

// ============================================================
// Internal helpers
// ============================================================

/** Recompute positions from transactions + navCache */
function derivePositions(
  transactions: Transaction[],
  navCache: Record<string, NavEntry>,
): Position[] {
  return aggregatePositions(transactions, navCache)
}

/** Generate a simple sortable ID */
function uid(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** Concurrency-limited batch promise runner */
async function batchRun<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency = 5,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = []
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    const batchResults = await Promise.allSettled(batch.map(fn))
    results.push(...batchResults)
  }
  return results
}

// ============================================================
// Store
// ============================================================

export const useFundStore = create<FundStore>()(
  persist(
    (set, get) => ({
      // --- initial state ---
      transactions: [],
      navCache: {},
      positions: [],
      isLoading: false,

      // ============================================================
      // CRUD
      // ============================================================

      addTransaction: (tx: NewTransaction) => {
        const now = Date.now()
        const record: Transaction = {
          ...tx,
          id: uid(),
          createdAt: now,
          updatedAt: now,
        }
        set((state) => {
          const next = [record, ...state.transactions]
          return {
            transactions: next,
            positions: derivePositions(next, state.navCache),
          }
        })
      },

      updateTransaction: (id: string, patch: Partial<Transaction>) => {
        set((state) => {
          const idx = state.transactions.findIndex((t) => t.id === id)
          if (idx === -1) return state

          const old = state.transactions[idx]
          const updated: Transaction = {
            ...old,
            ...patch,
            updatedAt: Date.now(),
          }

          // If nav is filled for the first time, auto-set navSource
          if (!old.nav && updated.nav != null && old.navSource === 'pending') {
            updated.navSource = 'manual'

            // Recompute confirmedShares + fee for applicable types
            if (updated.type === 'buy' && updated.amount != null) {
              updated.confirmedShares = Math.round(
                updated.amount * (1 - updated.feeRate) / updated.nav * 100,
              ) / 100
              if (updated.fee == null && updated.feeRate > 0) {
                updated.fee = Math.round(updated.amount * updated.feeRate * 100) / 100
              }
            } else if (updated.type === 'dividend_reinvest' && updated.amount != null) {
              updated.confirmedShares = Math.round(
                updated.amount / updated.nav * 100,
              ) / 100
            } else if (updated.type === 'sell' && updated.shares != null) {
              updated.amount = Math.round(
                updated.shares * updated.nav * (1 - updated.feeRate) * 100,
              ) / 100
              if (updated.fee == null && updated.feeRate > 0) {
                updated.fee = Math.round(updated.shares * updated.nav * updated.feeRate * 100) / 100
              }
            }
          }

          const next = [...state.transactions]
          next[idx] = updated

          return {
            transactions: next,
            positions: derivePositions(next, state.navCache),
          }
        })
      },

      deleteTransaction: (id: string) => {
        set((state) => {
          const next = state.transactions.filter((t) => t.id !== id)
          return {
            transactions: next,
            positions: derivePositions(next, state.navCache),
          }
        })
      },

      // ============================================================
      // Batch backfill NAV
      // ============================================================

      batchFillNav: async () => {
        const { transactions: txs } = get()
        const pending = txs.filter((t) => t.navSource === 'pending')
        if (pending.length === 0) return { success: 0, fail: 0 }

        const codes = [...new Set(pending.map((t) => t.fundCode))]
        console.log('[store] batchFillNav: pending codes =', codes)

        // Step 1: fetch history NAV (preferred — exact trade date match)
        const historyResults = await batchRun(codes, (code) => fetchHistoryNav(code), 3)
        console.log('[store] batchFillNav: historyResults =',
          historyResults.map((r, i) => ({
            code: codes[i],
            status: r.status,
            count: r.status === 'fulfilled' ? r.value.length : 0,
          })))
        const navByDate = new Map<string, Map<string, number>>()
        const codesWithoutHistory: string[] = []

        historyResults.forEach((result, i) => {
          if (result.status === 'fulfilled' && result.value.length > 0) {
            const dateNav = new Map<string, number>()
            for (const pt of result.value) {
              dateNav.set(pt.date, pt.nav)
            }
            navByDate.set(codes[i], dateNav)
          } else {
            codesWithoutHistory.push(codes[i])
          }
        })

        // Step 2: for funds with NO history at all, fetch latest NAV as fallback
        if (codesWithoutHistory.length > 0) {
          const latestResults = await batchRun(codesWithoutHistory, (code) => fetchLatestNav(code), 3)
          latestResults.forEach((result, i) => {
            if (result.status === 'fulfilled') {
              const m = new Map<string, number>()
              m.set('__fallback__', result.value.nav)
              navByDate.set(codesWithoutHistory[i], m)
            }
          })
        }

        // Step 3: for funds WITH history but missing the specific trade date,
        // also try latest NAV as per-date fallback
        const codesNeedingDateFallback = new Set<string>()
        for (const tx of pending) {
          const dateNav = navByDate.get(tx.fundCode)
          if (dateNav && !dateNav.has(tx.tradeDate) && !dateNav.has('__fallback__')) {
            codesNeedingDateFallback.add(tx.fundCode)
          }
        }
        if (codesNeedingDateFallback.size > 0) {
          const fallbackCodes = [...codesNeedingDateFallback]
          const latestResults = await batchRun(fallbackCodes, (code) => fetchLatestNav(code), 3)
          latestResults.forEach((result, i) => {
            if (result.status === 'fulfilled') {
              const dateNav = navByDate.get(fallbackCodes[i])
              if (dateNav) {
                dateNav.set('__fallback__', result.value.nav)
              }
            }
          })
        }

        // Apply backfill
        let success = 0
        let fail = 0

        set((state) => {
          const next = state.transactions.map((tx) => {
            if (tx.navSource !== 'pending') return tx

            const dateNav = navByDate.get(tx.fundCode)
            if (!dateNav) {
              console.warn(`[store] batchFillNav: no NAV data for fund ${tx.fundCode}`)
              return tx
            }

            // Try exact date match first, then fallback to latest NAV
            let nav = dateNav.get(tx.tradeDate)
            if (nav == null) {
              nav = dateNav.get('__fallback__')
              console.log(`[store] batchFillNav: ${tx.fundCode} date ${tx.tradeDate} → fallback NAV=${nav}`)
            } else {
              console.log(`[store] batchFillNav: ${tx.fundCode} date ${tx.tradeDate} → exact match NAV=${nav}`)
            }
            if (nav == null) {
              console.warn(`[store] batchFillNav: no NAV for ${tx.fundCode} on ${tx.tradeDate}`)
              return tx
            }

            const updated: Transaction = {
              ...tx,
              nav: Math.round(nav * 10000) / 10000,
              navSource: 'auto' as const,
              updatedAt: Date.now(),
            }

            // Recompute shares + fee for buy / dividend_reinvest / sell
            if (updated.type === 'buy' && updated.amount != null) {
              updated.confirmedShares = Math.round(
                updated.amount * (1 - updated.feeRate) / nav * 100,
              ) / 100
              if (updated.fee == null && updated.feeRate > 0) {
                updated.fee = Math.round(updated.amount * updated.feeRate * 100) / 100
              }
            } else if (updated.type === 'dividend_reinvest' && updated.amount != null) {
              updated.confirmedShares = Math.round(
                updated.amount / nav * 100,
              ) / 100
            } else if (updated.type === 'sell' && updated.shares != null) {
              updated.amount = Math.round(
                updated.shares * nav * (1 - updated.feeRate) * 100,
              ) / 100
              if (updated.fee == null && updated.feeRate > 0) {
                updated.fee = Math.round(updated.shares * nav * updated.feeRate * 100) / 100
              }
            }

            return updated
          })

          // Count successes (pending → confirmed)
          const origPending = state.transactions.filter((t) => t.navSource === 'pending')
          const stillPending = next.filter((t) => t.navSource === 'pending')
          success = origPending.length - stillPending.length
          fail = stillPending.length

          return {
            transactions: next,
            positions: derivePositions(next, state.navCache),
          }
        })

        return { success, fail }
      },

      // ============================================================
      // Refresh latest NAV + estimate
      // ============================================================

      refreshLatestNav: async (fundCodes?: string[]) => {
        const codes =
          fundCodes ??
          [...new Set(get().transactions.map((t) => t.fundCode))]

        if (codes.length === 0) return

        set({ isLoading: true })

        try {
          const results = await batchRun(codes, fetchLatestNav, 5)

          set((state) => {
            const newCache = { ...state.navCache }
            results.forEach((result, i) => {
              if (result.status === 'fulfilled') {
                const { name: _, ...navEntry } = result.value
                newCache[codes[i]] = navEntry
              }
            })

            return {
              navCache: newCache,
              positions: derivePositions(state.transactions, newCache),
              isLoading: false,
            }
          })
        } catch {
          set({ isLoading: false })
        }
      },

      // ============================================================
      // Data lifecycle
      // ============================================================

      clearAllData: () => {
        set({
          transactions: [],
          navCache: {},
          positions: [],
        })
      },

      exportData: (): string => {
        const { transactions, navCache } = get()
        return JSON.stringify(
          { transactions, navCache, exportedAt: new Date().toISOString() },
          null,
          2,
        )
      },

      importData: (json: string) => {
        let parsed: unknown
        try {
          parsed = JSON.parse(json)
        } catch {
          throw new Error('JSON 解析失败，请检查文件格式')
        }

        const obj = parsed as Record<string, unknown>
        if (!obj || !Array.isArray(obj.transactions)) {
          throw new Error('数据格式不正确：缺少 transactions 数组')
        }

        const transactions = obj.transactions as Transaction[]
        const navCache = (obj.navCache as Record<string, NavEntry>) ?? {}

        set({
          transactions,
          navCache,
          positions: derivePositions(transactions, navCache),
        })
      },
    }),
    {
      name: 'fund-ledger-v1',

      /** Only persist transactions + navCache; positions is derived, isLoading is transient */
      partialize: (state) => ({
        transactions: state.transactions,
        navCache: state.navCache,
      }),

      /** After localStorage rehydration, recompute derived positions */
      onRehydrateStorage: () => {
        return (rehydratedState, error) => {
          if (!error && rehydratedState) {
            const s = rehydratedState as { transactions: Transaction[]; navCache: Record<string, NavEntry> }
            useFundStore.setState({
              positions: derivePositions(s.transactions, s.navCache),
            })
          }
        }
      },
    },
  ),
)

// ============================================================
// Reactive subscription — keep positions in sync with transactions + navCache
// This is the ground truth: any change to transactions or navCache
// triggers a position recompute.  It also covers the initial rehydration
// case where the persist callback fires at an unpredictable time.
// ============================================================

let prevTx = useFundStore.getState().transactions
let prevCache = useFundStore.getState().navCache

useFundStore.subscribe((state) => {
  if (state.transactions !== prevTx || state.navCache !== prevCache) {
    prevTx = state.transactions
    prevCache = state.navCache
    useFundStore.setState({
      positions: derivePositions(state.transactions, state.navCache),
    })
  }
})
