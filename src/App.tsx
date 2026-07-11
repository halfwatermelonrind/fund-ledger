import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import NavBar from './components/NavBar'
import TabBar from './components/TabBar'
import { ToastContainer } from './components/Toast'
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
  const { transactions, navCache } = useFundStore()

  // Safety net: on first mount, if transactions exist but positions are empty, force recompute.
  useEffect(() => {
    if (transactions.length > 0) {
      const { positions } = useFundStore.getState()
      if (positions.length === 0) {
        useFundStore.setState({ positions: aggregatePositions(transactions, navCache) })
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col min-h-screen">
      <NavBar />
      <main className="flex-1 p-4 pc:p-6 pc:pb-6 pb-20">
        <Routes>
          <Route path="/" element={<Navigate to="/txlog" replace />} />
          <Route path="/txlog" element={<RecordPage />} />
          <Route path="/summary" element={<SummaryPage />} />
          <Route path="/details" element={<DetailsPage />} />
          <Route path="/signals" element={<SignalPage />} />
        </Routes>
      </main>
      <TabBar />
      <ToastContainer />
    </div>
  )
}

export default App
