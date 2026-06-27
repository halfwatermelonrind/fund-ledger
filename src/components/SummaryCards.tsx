/** Single slot: label + value, with optional P&L color class */
export interface SummarySlot {
  label: string
  value: string
  /** Tailwind text color class for value, e.g. 'text-gain' 'text-loss' */
  valueClass?: string
}

interface Props {
  items: SummarySlot[]
}

export default function SummaryCards({ items }: Props) {
  return (
    <div className="grid grid-cols-2 pc:grid-cols-4 lg:grid-cols-7 gap-3">
      {items.map((s, i) => (
        <div key={i} className="bg-surface border border-border rounded-md p-3.5 text-center">
          <div className="text-[11px] font-medium tracking-widest uppercase text-muted mb-1.5">{s.label}</div>
          <div className={`font-mono tabular-nums text-lg font-semibold ${s.valueClass ?? 'text-fg'}`}>{s.value}</div>
        </div>
      ))}
    </div>
  )
}
