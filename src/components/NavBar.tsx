import { useLocation, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'

const tabs = [
  { path: '/txlog', label: '记录' },
  { path: '/summary', label: '汇总' },
  { path: '/details', label: '明细' },
  { path: '/signals', label: '信号' },
]

export default function NavBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const [time, setTime] = useState('')

  useEffect(() => {
    const update = () => {
      const now = new Date()
      setTime(now.toLocaleDateString('zh-CN') + ' ' + now.toLocaleTimeString('zh-CN', { hour12: false }))
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <nav className="hidden pc:flex items-center sticky top-0 z-[100] bg-accent text-white px-[clamp(12px,2vw,24px)] h-[clamp(44px,5vw,56px)]" role="navigation" aria-label="主导航">
      <div className="font-semibold tracking-wider text-[clamp(14px,1.5vw,18px)] mr-[clamp(12px,3vw,40px)] whitespace-nowrap shrink-0">
        基金交易账簿
      </div>
      <div className="flex gap-0.5 h-full shrink-0">
        {tabs.map((t) => {
          const active = location.pathname === t.path
          return (
            <button
              key={t.path}
              className={`flex items-center px-[clamp(10px,1.6vw,20px)] text-[clamp(12px,1.1vw,14px)] font-medium tracking-wider bg-transparent border-0 border-b-2 cursor-pointer transition-colors duration-150 h-full whitespace-nowrap
                ${active ? 'text-white border-white' : 'text-white/70 border-transparent hover:text-white/90'}`}
              onClick={() => navigate(t.path)}
            >
              {t.label}
            </button>
          )
        })}
      </div>
      <div className="flex-1 min-w-2" />
      <span className="text-[clamp(10px,0.9vw,12px)] opacity-65 shrink-0 whitespace-nowrap hidden lg:block">{time}</span>
    </nav>
  )
}
