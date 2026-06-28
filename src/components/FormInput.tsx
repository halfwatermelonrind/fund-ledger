import type { InputHTMLAttributes } from 'react'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  optional?: boolean
  hint?: string
  mono?: boolean
}

export default function FormInput({ label, optional, hint, mono, className = '', id, ...rest }: Props) {
  return (
    <div className="mb-3.5 min-w-0">
      <label htmlFor={id} className="block text-[13px] font-medium text-fg mb-1 tracking-wider">
        {label}
        {optional && <span className="text-muted font-normal text-xs ml-1">（可选）</span>}
      </label>
      <input
        id={id}
        className={`w-full h-10 px-3 text-sm font-body text-fg bg-surface border border-border rounded-sm transition-colors duration-150
          placeholder:text-flat focus:outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(30,58,138,0.1)]
          ${mono ? 'font-mono tabular-nums' : ''} ${className}`}
        {...rest}
      />
      {hint && <div className="text-xs text-muted mt-1">{hint}</div>}
    </div>
  )
}
