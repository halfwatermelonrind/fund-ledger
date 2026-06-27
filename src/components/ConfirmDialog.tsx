import { useEffect, useRef } from 'react'
import Button from './Button'

interface Props {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'danger' | 'primary'
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open, title, message, confirmLabel = '确认', cancelLabel = '取消',
  variant = 'danger', onConfirm, onCancel,
}: Props) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 bg-black/40 z-[1500] flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === overlayRef.current) onCancel() }}
    >
      <div className="bg-surface rounded-lg p-6 max-w-[400px] w-full shadow-[0_20px_60px_rgba(0,0,0,0.2)]">
        <h3 className="text-base font-semibold mb-3">{title}</h3>
        <p className="text-sm text-muted mb-5 leading-relaxed">{message}</p>
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" size="sm" onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={variant} size="sm" onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </div>
  )
}
