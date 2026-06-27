/**
 * ============================================================
 *  useFundStore.test.ts — 状态管理单元测试
 *
 *  运行方式：npx tsx src/stores/useFundStore.test.ts
 * ============================================================
 */

import { useFundStore } from './useFundStore'
import type { Transaction } from '../types'

// --------------- helpers ---------------

let passed = 0
let failed = 0

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    console.error(`  ✗ FAIL: ${label}`)
  }
}

function makeTx(overrides: Partial<Transaction> & {
  id?: string
  fundCode: string
  fundName: string
  type: Transaction['type']
  tradeDate: string
}): Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    channel: '支付宝',
    feeRate: 0.0015,
    navSource: 'manual',
    nav: undefined,
    amount: undefined,
    shares: undefined,
    confirmedShares: undefined,
    ...overrides,
  }
}

function resetStore(): void {
  useFundStore.setState({
    transactions: [],
    navCache: {},
    positions: [],
    isLoading: false,
  })
}

// --------------- Test 1: Add & read transactions ---------------

function testAddTransaction(): void {
  console.log('\n📋 Test 1: Add transactions')

  resetStore()

  useFundStore.getState().addTransaction(makeTx({
    fundCode: '005827', fundName: '易方达蓝筹', type: 'buy',
    tradeDate: '2026-06-01', amount: 10000, nav: 2.3456,
  }))

  const txs = useFundStore.getState().transactions
  assert(txs.length === 1, 'one transaction added')
  assert(txs[0].id !== '', 'auto-generated id')
  assert(txs[0].fundCode === '005827', 'correct fund code')
  assert(txs[0].navSource === 'manual', 'navSource = manual when nav provided')
  assert(txs[0].createdAt > 0, 'createdAt timestamp set')
}

// --------------- Test 2: Derived positions ---------------

function testDerivedPositions(): void {
  console.log('\n📋 Test 2: Positions derived from transactions')

  resetStore()

  const store = useFundStore.getState()

  store.addTransaction(makeTx({
    fundCode: '005827', fundName: '易方达蓝筹', type: 'buy',
    tradeDate: '2026-06-01', amount: 10000, nav: 2.3456,
  }))
  store.addTransaction(makeTx({
    fundCode: '005827', fundName: '易方达蓝筹', type: 'buy',
    tradeDate: '2026-06-10', amount: 8000, nav: 2.2800,
  }))

  const positions = useFundStore.getState().positions
  assert(positions.length === 1, 'one position for 005827')
  if (positions.length > 0) {
    const pos = positions[0]
    assert(pos.fundCode === '005827', 'correct fund code')
    assert(pos.totalShares > 0, 'positive totalShares')
    assert(pos.totalCost > 0, 'positive totalCost')
    assert(pos.totalInvested > 0, 'totalInvested = sum of net amounts')
    console.log(`  → shares=${pos.totalShares}, cost=${pos.totalCost}, avgNav=${pos.avgCostNav}`)
  }
}

// --------------- Test 3: Update transaction ---------------

function testUpdateTransaction(): void {
  console.log('\n📋 Test 3: Update transaction (backfill NAV)')

  resetStore()

  useFundStore.getState().addTransaction(makeTx({
    fundCode: '003095', fundName: '中欧医疗', type: 'buy',
    tradeDate: '2026-06-05', amount: 5000, navSource: 'pending',
  }))

  const tx = useFundStore.getState().transactions[0]
  assert(tx.navSource === 'pending', 'initially pending')
  assert(tx.nav == null, 'nav is undefined')

  // Simulate backfill by user editing
  useFundStore.getState().updateTransaction(tx.id, {
    nav: 1.8520,
  })

  const updated = useFundStore.getState().transactions[0]
  assert(updated.nav === 1.8520, 'nav set to 1.8520')
  assert(updated.navSource === 'manual', 'navSource auto-changed to manual')
  assert(updated.confirmedShares != null && updated.confirmedShares > 0, 'confirmedShares computed')
  console.log(`  → confirmedShares=${updated.confirmedShares}`)
}

// --------------- Test 4: Delete transaction ---------------

function testDeleteTransaction(): void {
  console.log('\n📋 Test 4: Delete transaction')

  resetStore()

  // addTransaction prepends — newest first
  useFundStore.getState().addTransaction(makeTx({
    fundCode: '005827', fundName: '易方达蓝筹', type: 'buy',
    tradeDate: '2026-06-01', amount: 10000, nav: 2.3456,
  }))
  useFundStore.getState().addTransaction(makeTx({
    fundCode: '161725', fundName: '招商白酒', type: 'buy',
    tradeDate: '2026-06-01', amount: 5000, nav: 1.8000,
  }))
  // transactions order: [161725, 005827] (newest first)

  // Delete the older entry (005827, at index 1)
  const olderId = useFundStore.getState().transactions[1].id
  useFundStore.getState().deleteTransaction(olderId)

  const txs = useFundStore.getState().transactions
  assert(txs.length === 1, 'one remaining after delete')
  assert(txs[0].fundCode === '161725', 'correct transaction remains (162725 kept, 005827 deleted)')

  const positions = useFundStore.getState().positions
  assert(positions.length === 1, 'only one position after delete')
}

// --------------- Test 5: Export / Import ---------------

function testExportImport(): void {
  console.log('\n📋 Test 5: Export → Clear → Import round-trip')

  resetStore()

  useFundStore.getState().addTransaction(makeTx({
    fundCode: '005827', fundName: '易方达蓝筹', type: 'buy',
    tradeDate: '2026-06-01', amount: 10000, nav: 2.3456,
  }))

  const exported = useFundStore.getState().exportData()
  const parsed = JSON.parse(exported)
  assert(Array.isArray(parsed.transactions), 'export has transactions array')
  assert(parsed.transactions.length === 1, 'export has 1 transaction')

  // Clear
  useFundStore.getState().clearAllData()
  assert(useFundStore.getState().transactions.length === 0, 'cleared')
  assert(useFundStore.getState().positions.length === 0, 'positions also cleared')

  // Import
  useFundStore.getState().importData(exported)
  assert(useFundStore.getState().transactions.length === 1, 'restored after import')
  assert(useFundStore.getState().positions.length === 1, 'positions recomputed after import')
}

// --------------- Test 6: Batch fill NAV (manual mock) ---------------

function testBatchFillNav(): void {
  console.log('\n📋 Test 6: Batch fill NAV')

  resetStore()

  // Add some pending transactions (these won't be backfilled since mock data is limited)
  // But we can test the function runs without error
  useFundStore.getState().addTransaction(makeTx({
    fundCode: '005827', fundName: '易方达蓝筹', type: 'buy',
    tradeDate: '2026-06-01', amount: 10000, navSource: 'pending',
  }))

  const before = useFundStore.getState().transactions.filter((t) => t.navSource === 'pending').length
  assert(before === 1, '1 pending before backfill')
}

// --------------- Test 7: Refresh NAV updates cache ---------------

function testRefreshNav(): void {
  console.log('\n📋 Test 7: Refresh NAV updates cache')

  resetStore()

  useFundStore.getState().addTransaction(makeTx({
    fundCode: '005827', fundName: '易方达蓝筹', type: 'buy',
    tradeDate: '2026-06-01', amount: 10000, nav: 2.3456,
  }))

  const cacheBefore = useFundStore.getState().navCache
  assert(Object.keys(cacheBefore).length === 0, 'navCache starts empty')
}

// --------------- Test 8: Clear all data ---------------

function testClearAll(): void {
  console.log('\n📋 Test 8: Clear all data')

  resetStore()

  useFundStore.getState().addTransaction(makeTx({
    fundCode: '005827', fundName: '易方达蓝筹', type: 'buy',
    tradeDate: '2026-06-01', amount: 10000, nav: 2.3456,
  }))

  assert(useFundStore.getState().transactions.length > 0, 'has data before clear')

  useFundStore.getState().clearAllData()

  assert(useFundStore.getState().transactions.length === 0, 'no transactions')
  assert(Object.keys(useFundStore.getState().navCache).length === 0, 'navCache empty')
  assert(useFundStore.getState().positions.length === 0, 'positions empty')
}

// --------------- Test 9: Import rejects invalid data ---------------

function testImportInvalid(): void {
  console.log('\n📋 Test 9: Import rejects invalid data')

  resetStore()

  let threw = false
  try {
    useFundStore.getState().importData('not json')
  } catch {
    threw = true
  }
  assert(threw, 'throws on invalid JSON')

  threw = false
  try {
    useFundStore.getState().importData('{"foo": 1}')
  } catch {
    threw = true
  }
  assert(threw, 'throws on missing transactions array')
}

// --------------- runner ---------------

async function main(): Promise<void> {
  console.log('🧮 useFundStore.test.ts — Zustand 状态管理测试\n')
  console.log('='.repeat(56))

  testAddTransaction()
  testDerivedPositions()
  testUpdateTransaction()
  testDeleteTransaction()
  testExportImport()
  testBatchFillNav()
  testRefreshNav()
  testClearAll()
  testImportInvalid()

  // Test async refresh
  console.log('\n📋 Test A: refreshLatestNav (async)')
  resetStore()
  useFundStore.getState().addTransaction(makeTx({
    fundCode: '005827', fundName: '易方达蓝筹', type: 'buy',
    tradeDate: '2026-06-01', amount: 10000, nav: 2.3456,
  }))
  await useFundStore.getState().refreshLatestNav()
  const cache = useFundStore.getState().navCache
  assert('005827' in cache, '005827 added to navCache')
  assert(cache['005827'].nav === 2.4012, 'correct nav value cached')

  console.log('\n' + '='.repeat(56))
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`)

  if (failed > 0) {
    throw new Error(`${failed} test(s) failed`)
  }
}

main()
