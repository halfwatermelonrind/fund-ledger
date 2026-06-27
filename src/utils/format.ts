/**
 * ============================================================
 *  format.ts — 格式化工具
 *
 *  金额 / 百分比 / 份额 / 净值 / 日期
 *  金额和份额均使用千位分隔符（1,234,567.89）。
 * ============================================================
 */

/** 千位分隔符 */
function sep(n: number, decimals: number): string {
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** 金额（元），千位符 + 2 位小数 */
export function money(n: number, decimals = 2): string {
  return sep(n, decimals)
}

/** 带正负号的金额，千位符，用于盈亏展示 */
export function moneySigned(n: number): string {
  const s = sep(Math.abs(n), 2)
  return n > 0 ? `+${s}` : `-${s}`
}

/** 份额，千位符 + 2 位小数 */
export function shares(n: number): string {
  return sep(n, 2)
}

/** 单位净值，4 位小数（不加千位符） */
export function nav(n: number): string {
  return n.toFixed(4)
}

/** 百分比（数值 0-100），2 位小数 */
export function percent(n: number, decimals = 2): string {
  const s = sep(Math.abs(n), decimals)
  return n > 0 ? `+${s}` : n < 0 ? `-${s}` : s
}

/** A 股盈亏颜色类名 */
export function pnlColor(val: number): string {
  if (val > 0) return 'text-gain'
  if (val < 0) return 'text-loss'
  return 'text-flat'
}

/** 盈亏金额（带符号 + 颜色类） */
export function pnlMoney(val: number): { text: string; cls: string } {
  return { text: moneySigned(val), cls: pnlColor(val) }
}

/** 盈亏百分比（带符号 + 颜色类） */
export function pnlPercent(val: number): { text: string; cls: string } {
  return { text: percent(val), cls: pnlColor(val) }
}

/** 日期 YYYY-MM-DD → 本地化显示 */
export function dateDisplay(ymd: string): string {
  if (!ymd) return ''
  const [y, m, d] = ymd.split('-')
  return `${y}年${parseInt(m)}月${parseInt(d)}日`
}

/** 估值时间格式化 */
export function estimateTimeDisplay(time?: string): string {
  if (!time) return ''
  // "2026-06-20 14:46" → "估算于 14:46"
  const parts = time.split(' ')
  return parts.length > 1 ? `估算于 ${parts[1]}` : time
}
