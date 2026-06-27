type TabType = 'buy' | 'sell' | 'dividend_cash' | 'dividend_reinvest'

interface Props {
  active: TabType
  onChange: (t: TabType) => void
}

const tabs: { key: TabType; label: string }[] = [
  { key: 'buy', label: '买入' },
  { key: 'sell', label: '卖出' },
  { key: 'dividend_cash', label: '现金分红' },
  { key: 'dividend_reinvest', label: '红利再投资' },
]

export default function TypeTabs({ active, onChange }: Props) {
  return (
    <div className="flex gap-1 bg-bg rounded-md p-1 mb-4">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          className={`flex-1 py-2 px-1.5 text-[13px] pc:text-sm font-medium tracking-wider text-center border-none rounded-md transition-all duration-150 whitespace-nowrap cursor-pointer
            ${active === t.key ? 'bg-surface text-accent shadow-sm' : 'bg-transparent text-muted'}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}
