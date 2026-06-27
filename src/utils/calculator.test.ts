/**
 * ============================================================
 *  calculator.test.ts — 手动单元测试
 *
 *  运行方式：npx tsx src/utils/calculator.test.ts
 * ============================================================
 */

import { aggregatePositions, applyBuy } from './calculator'
import type { Transaction } from '../types'
import type { NavEntry } from './calculator'

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

function assertClose(actual: number, expected: number, delta: number, label: string): void {
  const ok = Math.abs(actual - expected) <= delta
  if (ok) {
    passed++
    console.log(`  ✓ ${label}  (actual=${actual}, expected=${expected})`)
  } else {
    failed++
    console.error(`  ✗ FAIL: ${label}  (actual=${actual}, expected=${expected}, delta=${Math.abs(actual - expected)})`)
  }
}

function makeTx(overrides: Partial<Transaction> & { id: string; fundCode: string; fundName: string; type: Transaction['type']; tradeDate: string }): Transaction {
  return {
    channel: '支付宝',
    feeRate: 0,
    navSource: 'manual',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  }
}

// --------------- Test 1: Single buy ---------------

function testSingleBuy(): void {
  console.log('\n📋 Test 1: Single buy — basic shares & cost')

  const acc = applyBuy({
    fundCode: '005827', fundName: '易方达蓝筹', totalShares: 0, totalCost: 0,
    totalInvested: 0, totalSoldCash: 0, totalCashDividend: 0, realizedProfit: 0,
    transactions: [] as Transaction[],
  }, makeTx({
    id: '1', fundCode: '005827', fundName: '易方达蓝筹',
    type: 'buy', tradeDate: '2026-06-01',
    amount: 10000, nav: 2.3456, feeRate: 0.0015,
  }))

  // netAmount = 10000 * (1 - 0.0015) = 9985.00
  // shares = 9985 / 2.3456 = 4256.89... → rShares → 4256.91
  const expectedNet = 10000 * (1 - 0.0015) // 9985
  const expectedShares = Math.round(expectedNet / 2.3456 * 100) / 100

  assert(acc.totalShares === expectedShares, `totalShares = ${acc.totalShares} (expected ${expectedShares})`)
  assert(acc.totalCost === expectedNet, `totalCost = ${acc.totalCost} (expected ${expectedNet})`)
  assert(acc.totalInvested === expectedNet, `totalInvested = ${acc.totalInvested} (expected ${expectedNet})`)
}

// --------------- Test 2: Multiple buys (weighted avg) ---------------

function testMultipleBuys(): void {
  console.log('\n📋 Test 2: Two buys at different prices → weighted average cost')

  const acc0 = {
    fundCode: '005827', fundName: '易方达蓝筹', totalShares: 0, totalCost: 0,
    totalInvested: 0, totalSoldCash: 0, totalCashDividend: 0, realizedProfit: 0,
    transactions: [] as Transaction[],
  }

  // Buy 1: 8000 yuan @ 2.2800, fee 0.15%
  const tx1 = makeTx({
    id: '1', fundCode: '005827', fundName: '易方达蓝筹',
    type: 'buy', tradeDate: '2026-05-01',
    amount: 8000, nav: 2.2800, feeRate: 0.0015,
  })

  // Buy 2: 10000 yuan @ 2.3456, fee 0.15%
  const tx2 = makeTx({
    id: '2', fundCode: '005827', fundName: '易方达蓝筹',
    type: 'buy', tradeDate: '2026-06-01',
    amount: 10000, nav: 2.3456, feeRate: 0.0015,
  })

  const acc1 = applyBuy(acc0, tx1)
  const acc = applyBuy(acc1, tx2)

  const net1 = Math.round(8000 * (1 - 0.0015) * 100) / 100   // 7988.00
  const net2 = Math.round(10000 * (1 - 0.0015) * 100) / 100  // 9985.00
  const shares1 = Math.round(net1 / 2.2800 * 100) / 100       // 3503.51
  const shares2 = Math.round(net2 / 2.3456 * 100) / 100       // 4256.91

  const expectedShares = Math.round((shares1 + shares2) * 100) / 100
  const expectedCost = Math.round((net1 + net2) * 100) / 100
  const expectedAvg = expectedShares > 0 ? Math.round(expectedCost / expectedShares * 10000) / 10000 : 0

  assert(acc.totalShares === expectedShares, `totalShares = ${acc.totalShares} (expected ${expectedShares})`)
  assert(acc.totalCost === expectedCost, `totalCost = ${acc.totalCost} (expected ${expectedCost})`)

  const avg = acc.totalShares > 0 ? Math.round(acc.totalCost / acc.totalShares * 10000) / 10000 : 0
  assert(avg === expectedAvg, `avgCostNav = ${avg} (expected ${expectedAvg})`)
}

// --------------- Test 3: Buy then partial sell ---------------

function testBuyThenSell(): void {
  console.log('\n📋 Test 3: Buy ×2, then partial sell → realized profit + remaining cost')

  const txs: Transaction[] = [
    makeTx({ id: '1', fundCode: '005827', fundName: '易方达蓝筹', type: 'buy', tradeDate: '2026-05-01', amount: 8000, nav: 2.2800, feeRate: 0.0015 }),
    makeTx({ id: '2', fundCode: '005827', fundName: '易方达蓝筹', type: 'buy', tradeDate: '2026-06-01', amount: 10000, nav: 2.3456, feeRate: 0.0015 }),
    // Sell 2000 shares @ 2.4012, fee 0.5%
    makeTx({ id: '3', fundCode: '005827', fundName: '易方达蓝筹', type: 'sell', tradeDate: '2026-06-15', shares: 2000, nav: 2.4012, feeRate: 0.005 }),
  ]

  const navMap: Record<string, NavEntry> = {
    '005827': { nav: 2.4012, date: '2026-06-15' },
  }

  const positions = aggregatePositions(txs, navMap)
  const pos = positions[0]

  assert(pos !== undefined, 'position exists')
  if (!pos) return

  // Manual calculation:
  // Buy 1: net=7988, shares=3503.51
  // Buy 2: net=9985, shares=4256.91
  // Total before sell: shares=7760.42, cost=17973
  const net1 = Math.round(8000 * 0.9985 * 100) / 100
  const net2 = Math.round(10000 * 0.9985 * 100) / 100
  const s1 = Math.round(net1 / 2.28 * 100) / 100
  const s2 = Math.round(net2 / 2.3456 * 100) / 100
  const preSellShares = Math.round((s1 + s2) * 100) / 100
  const preSellCost = Math.round((net1 + net2) * 100) / 100

  // Sell 2000 of preSellShares
  const sellRatio = 2000 / preSellShares
  const sellCost = Math.round(preSellCost * sellRatio * 100) / 100
  const sellRevenue = Math.round(2000 * 2.4012 * (1 - 0.005) * 100) / 100
  const realized = Math.round((sellRevenue - sellCost) * 100) / 100
  const remainShares = Math.round((preSellShares - 2000) * 100) / 100
  const remainCost = Math.round((preSellCost - sellCost) * 100) / 100

  assertClose(pos.totalShares, remainShares, 0.01, 'remaining shares')
  assertClose(pos.totalCost, remainCost, 0.01, 'remaining cost')
  assertClose(pos.realizedProfit, realized, 0.01, 'realized profit from sell')

  // Market value = remainShares * 2.4012
  const mv = Math.round(remainShares * 2.4012 * 100) / 100
  assertClose(pos.marketValue, mv, 0.01, 'market value = shares × latestNav')

  // unrealized = mv - remainCost
  const unrealized = Math.round((mv - remainCost) * 100) / 100
  assertClose(pos.unrealizedProfit, unrealized, 0.01, 'unrealized profit')

  console.log(`  → remaining shares=${pos.totalShares}, cost=${pos.totalCost}, realizedPnL=${pos.realizedProfit}, unrealizedPnL=${pos.unrealizedProfit}`)
}

// --------------- Test 4: Full lifecycle ---------------

function testFullLifecycle(): void {
  console.log('\n📋 Test 4: Full lifecycle — buy ×2, dividend, dividend reinvest, partial sell, then full sell')

  const txs: Transaction[] = [
    // Buy 1
    makeTx({ id: '1', fundCode: '000961', fundName: '天弘沪深300', type: 'buy', tradeDate: '2026-01-10', amount: 5000, nav: 1.4500, feeRate: 0.0015 }),
    // Buy 2
    makeTx({ id: '2', fundCode: '000961', fundName: '天弘沪深300', type: 'buy', tradeDate: '2026-02-15', amount: 3000, nav: 1.5200, feeRate: 0.0015 }),
    // Cash dividend: 持有份额 × 0.15 元/份
    makeTx({ id: '3', fundCode: '000961', fundName: '天弘沪深300', type: 'dividend_cash', tradeDate: '2026-03-01', amount: 820, feeRate: 0 }),
    // Dividend reinvest: 持有份额 × 0.12 元/份 @ 1.5300
    makeTx({ id: '4', fundCode: '000961', fundName: '天弘沪深300', type: 'dividend_reinvest', tradeDate: '2026-04-01', amount: 660, nav: 1.5300, feeRate: 0 }),
    // Partial sell
    makeTx({ id: '5', fundCode: '000961', fundName: '天弘沪深300', type: 'sell', tradeDate: '2026-05-01', shares: 2000, nav: 1.5800, feeRate: 0.005 }),
    // Sell remaining (full clear)
    makeTx({ id: '6', fundCode: '000961', fundName: '天弘沪深300', type: 'sell', tradeDate: '2026-06-01', shares: 99999, nav: 1.6000, feeRate: 0.005 }),
  ]

  const navMap: Record<string, NavEntry> = {
    '000961': { nav: 1.6000, date: '2026-06-01' },
  }

  const positions = aggregatePositions(txs, navMap)
  const pos = positions[0]

  assert(pos !== undefined, 'position exists')
  if (!pos) return

  // After full sell, position should be cleared
  assert(pos.isCleared === true, 'isCleared = true after full sell')
  assert(pos.totalShares === 0, 'totalShares = 0')
  assert(pos.totalCost === 0, 'totalCost = 0')

  // totalInvested should include buys + dividend reinvest
  const buy1Net = Math.round(5000 * 0.9985 * 100) / 100
  const buy2Net = Math.round(3000 * 0.9985 * 100) / 100
  const reinvestDiv = 660
  const expectedInvested = Math.round((buy1Net + buy2Net + reinvestDiv) * 100) / 100
  assertClose(pos.totalInvested, expectedInvested, 0.01, 'totalInvested = buys + reinvest dividends')

  // totalCashDividend should be the cash dividend only (not reinvest)
  assertClose(pos.totalCashDividend, 820, 0.01, 'totalCashDividend = cash dividend (820)')
  assertClose(pos.dividendProfit, 820, 0.01, 'dividendProfit = totalCashDividend')

  // realizedProfit should be non-zero (sales happened)
  console.log(`  → realizedProfit=${pos.realizedProfit}, dividendProfit=${pos.dividendProfit}, totalProfit=${pos.totalProfit}`)
  assert(pos.realizedProfit !== 0, 'realized profit is non-zero after sales')

  // totalProfit = realized + dividend (unrealized should be 0 since cleared)
  assertClose(pos.unrealizedProfit, 0, 0.01, 'unrealized = 0 for cleared position')
  const expectedTotal = Math.round((pos.realizedProfit + pos.dividendProfit) * 100) / 100
  assertClose(pos.totalProfit, expectedTotal, 0.01, 'totalProfit = realized + dividend + unrealized')
}

// --------------- Test 5: Pending transactions are skipped ---------------

function testPendingSkipped(): void {
  console.log('\n📋 Test 5: Pending transactions are excluded from aggregation')

  const txs: Transaction[] = [
    makeTx({ id: '1', fundCode: '003095', fundName: '中欧医疗', type: 'buy', tradeDate: '2026-06-01', amount: 5000, feeRate: 0.0015, navSource: 'pending' }),
    makeTx({ id: '2', fundCode: '003095', fundName: '中欧医疗', type: 'buy', tradeDate: '2026-06-10', amount: 3000, nav: 1.8520, feeRate: 0.0015 }),
  ]

  const positions = aggregatePositions(txs)
  const pos = positions[0]

  assert(pos !== undefined, 'position exists (from confirmed tx only)')
  if (!pos) return

  // Only tx 2 should be counted
  const net = Math.round(3000 * 0.9985 * 100) / 100
  const shares = Math.round(net / 1.8520 * 100) / 100
  assertClose(pos.totalShares, shares, 0.01, 'only confirmed buy counted')
  assertClose(pos.totalCost, net, 0.01, 'only confirmed cost counted')
}

// --------------- runner ---------------

function main(): void {
  console.log('🧮 calculator.test.ts — 基金交易账簿核心计算逻辑测试\n')
  console.log('=' .repeat(56))

  testSingleBuy()
  testMultipleBuys()
  testBuyThenSell()
  testFullLifecycle()
  testPendingSkipped()

  console.log('\n' + '='.repeat(56))
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} assertions`)

  if (failed > 0) {
    throw new Error(`${failed} test(s) failed`)
  }
}

main()
