type Status = 'confirmed' | 'pending' | 'cleared' | 'init'

interface Props {
  status: Status
  className?: string
}

const map: Record<Status, { label: string; cls: string }> = {
  confirmed: { label: '已确认', cls: 'bg-accent-light text-accent' },
  pending:   { label: '待回填', cls: 'bg-warn-bg text-[#92400e]' },
  cleared:   { label: '已清仓', cls: 'bg-flat-bg text-flat' },
  init:      { label: '初始化', cls: 'bg-purple-100 text-purple-700' },
}

export default function Badge({ status, className = '' }: Props) {
  const { label, cls } = map[status]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[11px] font-medium tracking-wider rounded-full whitespace-nowrap leading-relaxed ${cls} ${className}`}>
      {label}
    </span>
  )
}
