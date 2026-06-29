import { useLocation, useNavigate } from 'react-router-dom'
import { Plus, Grid3X3, ChartLine, Info } from 'lucide-react'

const tabs = [
  { path: '/entry', label: '录入', Icon: Plus },
  { path: '/txlog', label: '流水', Icon: Grid3X3 },
  { path: '/summary', label: '汇总', Icon: ChartLine },
  { path: '/details', label: '明细', Icon: Info },
]

export default function TabBar() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <nav className="flex pc:hidden fixed bottom-0 left-0 right-0 bg-surface border-t border-border z-[100] pb-[env(safe-area-inset-bottom,0)]" role="navigation" aria-label="移动导航">
      {tabs.map((t) => {
        const active = location.pathname === t.path
        return (
          <button
            key={t.path}
            className={`flex-1 flex flex-col items-center justify-center py-2 px-1 gap-0.5 border-0 bg-transparent text-[10px] font-medium tracking-wider cursor-pointer transition-colors duration-150
              ${active ? 'text-accent' : 'text-muted'}`}
            onClick={() => navigate(t.path)}
          >
            <t.Icon className="w-6 h-6" />
            <span>{t.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
