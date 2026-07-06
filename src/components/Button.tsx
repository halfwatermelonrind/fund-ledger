import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warn'
type Size = 'xs' | 'sm' | 'md'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  children: ReactNode
}

const variantClass: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover border-transparent',
  secondary: 'bg-surface text-fg border-border hover:bg-bg',
  ghost: 'bg-transparent text-accent border-transparent hover:bg-accent-light',
  danger: 'bg-transparent text-gain border-gain hover:bg-gain-bg',
  warn: 'bg-warn text-white border-warn hover:brightness-90',
}

const sizeClass: Record<Size, string> = {
  xs: 'h-9 px-2.5 text-[11px] rounded-sm',   // 36px — inline rows
  sm: 'h-10 px-3.5 text-xs',                  // 40px — secondary
  md: 'h-11 px-5 text-sm',                    // 44px — primary
}

export default function Button({ variant = 'primary', size = 'md', className = '', children, disabled, ...rest }: Props) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-1.5 font-medium tracking-wider border rounded-sm cursor-pointer transition-all duration-150 whitespace-nowrap
        ${variantClass[variant]} ${sizeClass[size]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      disabled={disabled}
      {...rest}
    >
      {children}
    </button>
  )
}
