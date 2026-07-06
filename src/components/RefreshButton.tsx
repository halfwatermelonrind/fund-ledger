interface Props {
  spinning?: boolean
  disabled?: boolean
  title?: string
  onClick: () => void
}

export default function RefreshButton({ spinning, disabled, title = '刷新估值', onClick }: Props) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center w-9 h-9 border border-border rounded-full bg-surface cursor-pointer transition-all duration-150 text-muted text-sm
        hover:border-accent hover:text-accent disabled:opacity-40 disabled:cursor-not-allowed
        ${spinning ? 'animate-[spin_0.8s_linear]' : ''}`}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      ⟳
    </button>
  )
}
