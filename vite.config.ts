import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({
  base: '/fund-ledger/v3/',
  plugins: [react()],
  server: {
    proxy: {
      '/api/fundgz': {
        target: 'https://api.fund.eastmoney.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/fundgz/, ''),
        headers: { Referer: 'https://fund.eastmoney.com/' },
      },
    },
  },
})
