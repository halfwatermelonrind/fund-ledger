import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ base: '/fund-ledger/v2/', plugins: [react()] })
