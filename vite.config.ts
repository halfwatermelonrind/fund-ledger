import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// V2 preview — no PWA to avoid SW conflict with main version at /fund-ledger/
export default defineConfig({
  base: '/fund-ledger/v2/',
  plugins: [react()],
})
