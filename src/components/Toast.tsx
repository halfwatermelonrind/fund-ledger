import { useState, useEffect } from 'react'
import { CheckCircle, XCircle, Info } from 'lucide-react'

type ToastType = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

// ---- Module-level state (external to React tree) ----

let nextId = 0
let listeners: Array<(items: ToastItem[]) => void> = []
let current: ToastItem[] = []

function notify() {
  listeners.forEach((fn) => fn([...current]))
}

const iconMap: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: XCircle,
  info: Info,
}

const borderMap: Record<ToastType, string> = {
  success: 'border-l-loss',
  error: 'border-l-gain',
  info: 'border-l-accent',
}

// ---- Public API ----

export function showToast(message: string, type: ToastType = 'info') {
  const id = ++nextId
  current = [...current, { id, message, type }]
  notify()
  setTimeout(() => {
    current = current.filter((t) => t.id !== id)
    notify()
  }, 2500)
}

// ---- React component ----

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>(current)

  useEffect(() => {
    const fn = (items: ToastItem[]) => setToasts(items)
    listeners.push(fn)
    return () => { listeners = listeners.filter((l) => l !== fn) }
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[2000] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => {
        const Icon = iconMap[t.type]
        return (
          <div
            key={t.id}
            className={`flex items-center gap-2 px-4 py-3 bg-fg text-white rounded-md text-[13px] font-medium shadow-lg pointer-events-auto max-w-[360px] border-l-[3px] ${borderMap[t.type]}`}
            style={{ animation: 'toastIn 0.3s ease' }}
          >
            <Icon className="w-4 h-4 shrink-0" />
            <span>{t.message}</span>
          </div>
        )
      })}
    </div>
  )
}
