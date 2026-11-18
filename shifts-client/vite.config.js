import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// בפיתוח: כל בקשת /api עוברת לשרת Express שרץ על פורט 3001 (npm run dev בתיקייה הראשית)
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:3001'
    }
  }
})
