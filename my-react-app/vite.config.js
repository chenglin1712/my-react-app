import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    entries: ['index.html'],
  },
  build: {
    rollupOptions: {
      output: {
        // situation-*.js（recharts 圖表）與 _note-*.js（tiptap 編輯器）兩個路由
        // chunk 各約 440KB，絕大部分是這兩個第三方套件本身的體積，不是頁面程式碼。
        // 拆成獨立、清楚命名的 vendor chunk：一方面讓建置輸出能直接看出是哪個套件
        // 造成體積，另一方面套件版本沒變時瀏覽器能單獨快取，不會因為頁面邏輯小改動
        // 就整包重新下載。這兩個套件只有各自的路由在用，其餘地方沒有直接 import。
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (
            id.includes('recharts') ||
            id.includes('victory-vendor') ||
            /[\\/]d3-/.test(id) ||
            id.includes('@reduxjs') ||
            id.includes('react-redux') ||
            id.includes('immer') ||
            id.includes('reselect') ||
            id.includes('decimal.js-light')
          ) {
            return 'vendor-recharts';
          }
          if (id.includes('@tiptap') || /[\\/]prosemirror-/.test(id)) {
            return 'vendor-tiptap';
          }
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    globals: true,
    css: true,
    // 限定在 frontend/ 底下：firestore.rules.test.js 放在專案根目錄，需要真的連線
    // Firestore emulator（見 @vitest-environment node 註解），不屬於這裡（jsdom）
    // 的一般前端單元測試，要透過 npm run test:rules 另外對著模擬器單獨執行。
    include: ['frontend/**/*.{test,spec}.?(c|m)[jt]s?(x)'],
  },
  server: {
    watch: {
      usePolling: true,
      interval: 1000,
    },
    proxy: {
      '/api/v1/vision': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        secure: false,
      },
      '/api/v1/dictionary': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        secure: false,
      },
      '/api/v1/quiz/compare_audio': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        secure: false,
      },
      '/api/v1/quiz/generate_quiz_frontend': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        secure: false,
      },
      '/api/v1/quiz/submit_answer_frontend': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        secure: false,
      },
      '/crawler': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
      '/AIModel': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
      '/CrosswordPuzzle': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
      '/adminapi': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
      },
      '/api/v1/listening': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        secure: false,
      },
      '/api/v1/sentence': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        secure: false,
      },
    },
  }
})
