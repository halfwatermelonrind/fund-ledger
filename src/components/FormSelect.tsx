import type { SelectHTMLAttributes, ReactNode } from 'react'

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  children: ReactNode
}

export default function FormSelect({ label, children, className = '', id, ...rest }: Props) {
  return (
    <div className="mb-3.5">
      <label htmlFor={id} className="block text-[13px] font-medium text-fg mb-1 tracking-wider">{label}</label>
      <select
        id={id}
        className={`w-full h-10 px-3 pr-9 text-sm font-body text-fg bg-surface border border-border rounded-sm transition-colors duration-150
          appearance-none focus:outline-none focus:border-accent focus:shadow-[0_0_0_3px_rgba(30,58,138,0.1)]
          bg-[url('data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%236b7280%27 stroke-width=%272%27%3E%3Cpath d=%27m6 9 6 6 6-6%27/%3E%3C/svg%3E')] bg-no-repeat bg-[right_12px_center]
          ${className}`}
        {...rest}
      >
        {children}
      </select>
    </div>
  )
}
