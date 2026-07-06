/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: '#f3f4f6',
        surface: '#ffffff',
        fg: '#111827',
        muted: '#6b7280',
        border: '#e5e7eb',
        accent: {
          DEFAULT: '#1e3a8a',
          hover: '#1e40af',
          light: '#dbeafe',
        },
        gain: {
          DEFAULT: '#dc2626',
          bg: '#fef2f2',
        },
        loss: {
          DEFAULT: '#16a34a',
          bg: '#f0fdf4',
        },
        warn: {
          DEFAULT: '#f59e0b',
          bg: '#fffbeb',
          text: '#92400e',
        },
        flat: {
          DEFAULT: '#9ca3af',
          bg: '#f9fafb',
        },
        reinvest: {
          DEFAULT: '#7e22ce',
          bg: '#f3e8ff',
        },
      },
      fontFamily: {
        display: [
          '-apple-system', 'BlinkMacSystemFont',
          '"PingFang SC"', '"Hiragino Sans GB"',
          '"Microsoft YaHei"', 'system-ui', 'sans-serif',
        ],
        body: [
          '-apple-system', 'BlinkMacSystemFont',
          '"PingFang SC"', '"Hiragino Sans GB"',
          '"Microsoft YaHei"', 'system-ui', 'sans-serif',
        ],
        mono: [
          '"SF Mono"', '"JetBrains Mono"',
          '"IBM Plex Mono"', 'ui-monospace',
          '"Menlo"', '"Consolas"', 'monospace',
        ],
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '12px',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0,0,0,0.05)',
        md: '0 4px 12px rgba(0,0,0,0.08)',
      },
      screens: {
        pc: '768px',
      },
    },
  },
  plugins: [],
}
