import { useState, useRef, useCallback, useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Download, Upload, Trash2, FolderOpen } from 'lucide-react'
import NavBar from './components/NavBar'
import TabBar from './components/TabBar'
import { ToastContainer, showToast } from './components/Toast'
import ConfirmDialog from './components/ConfirmDialog'
import BatchImportModal from './components/BatchImportModal'
import Button from './components/Button'
import RecordPage from './pages/RecordPage'
import SummaryPage from './pages/SummaryPage'
import DetailsPage from './pages/DetailsPage'
import SignalPage from './pages/SignalPage'
import { useFundStore } from './stores/useFundStore'
import { aggregatePositions } from './utils/calculator'

function App() {
  return (
    <HashRouter>
      <AppShell />
    </HashRouter>
  )
}

function AppShell() {
  const { exportData, importData, clearAllData, transactions } = useFundStore()
  const location = useLocation()
  const isRecordPage = location.pathname === '/txlog'

  const [clearOpen, setClearOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Safety net: on first mount, if transactions exist but positions are empty, force recompute.
  useEffect(() => {
    const { transactions: txs, navCache, positions } = useFundStore.getState()
    if (txs.length > 0 && positions.length === 0) {
      useFundStore.setState({
        positions: aggregatePositions(txs, navCache),
      })
    }
  }, [])

  // ---- export ----

  const handleExport = useCallback(() => {
    if (transactions.length === 0) {
      showToast('暂无数据可导出', 'info')
      return
    }
    try {
      const json = exportData()
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `fund-ledger-backup-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      showToast('数据已导出', 'success')
    } catch {
      showToast('导出失败', 'error')
    }
  }, [exportData, transactions.length])

  // ---- import ----

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleImportFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      try {
        importData(reader.result as string)
        showToast('数据已导入', 'success')
      } catch (err) {
        showToast(err instanceof Error ? err.message : '导入失败，请检查文件格式', 'error')
      }
    }
    reader.onerror = () => showToast('文件读取失败', 'error')
    reader.readAsText(file)
    // Reset input so the same file can be re-imported
    e.target.value = ''
  }, [importData])

  // ---- clear ----

  const handleClear = useCallback(() => {
    clearAllData()
    setClearOpen(false)
    showToast('所有本地数据已清除', 'info')
  }, [clearAllData])

  return (
    <div className="flex flex-col min-h-screen">
      {/* PC top nav */}
      <NavBar />

      {/* Action bar — only on entry page */}
      {isRecordPage && (
        <div className="flex items-center justify-end gap-2 px-4 pt-3 pc:px-6 pc:pt-4">
          <Button variant="secondary" size="xs" onClick={() => setImportOpen(true)} title="批量导入已有持仓">
            <FolderOpen className="w-3.5 h-3.5" /> 初始化
          </Button>
          <Button variant="secondary" size="xs" onClick={handleExport}>
            <Download className="w-3.5 h-3.5" /> 导出
          </Button>
          <Button variant="secondary" size="xs" onClick={handleImportClick}>
            <Upload className="w-3.5 h-3.5" /> 导入
          </Button>
          <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
          <Button variant="danger" size="xs" onClick={() => setClearOpen(true)} title="清除所有本地数据">
            <Trash2 className="w-3.5 h-3.5" /> 清空
          </Button>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 p-4 pc:p-6 pc:pb-6 pb-20">
        <Routes>
          <Route path="/" element={<Navigate to="/txlog" replace />} />
          <Route path="/txlog" element={<RecordPage />} />
          <Route path="/summary" element={<SummaryPage />} />
          <Route path="/details" element={<DetailsPage />} />
          <Route path="/signals" element={<SignalPage />} />
        </Routes>
      </main>

      {/* Mobile bottom tab bar */}
      <TabBar />

      {/* Overlays */}
      <ToastContainer />

      <BatchImportModal open={importOpen} onClose={() => setImportOpen(false)} />

      <ConfirmDialog
        open={clearOpen}
        title="清除所有数据"
        message="确定要删除所有本地交易记录和缓存数据吗？此操作不可撤销。建议先导出备份。"
        confirmLabel="确认清除"
        onConfirm={handleClear}
        onCancel={() => setClearOpen(false)}
      />
    </div>
  )
}

export default App
