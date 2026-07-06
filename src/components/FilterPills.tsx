interface Pill {
  key: string
  label: string
}

interface Props {
  pills: Pill[]
  active: string
  onChange: (key: string) => void
}

export default function FilterPills({ pills, active, onChange }: Props) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {pills.map((p) => (
        <button
          key={p.key}
          type="button"
          className={`px-3 py-1.5 min-h-10 text-xs font-medium tracking-wider border rounded-full cursor-pointer transition-all duration-150
            ${active === p.key
              ? 'bg-accent text-white border-accent'
              : 'bg-surface text-muted border-border hover:border-accent hover:text-accent'}`}
          onClick={() => onChange(p.key)}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}
