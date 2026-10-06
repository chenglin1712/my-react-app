import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // frontend/ 底下有 src/、components/、hooks/、utils/ 四個平行的頂層目錄
  // （FE-1），彼此之間只能用 `../../components/ui/...` 這種相對路徑互相
  // 引用——路徑深度隨檔案位置變動，看不出被引用的東西到底屬於哪一層，也
  // 讓「把檔案搬到別的資料夾」這件事必須連帶改掉一整批引用。
  //
  // 先把別名接起來（不搬任何檔案、不動任何既有 import），之後要逐步收斂
  // 目錄結構時，搬動的檔案只需要改自己的 import，不會波及引用它的人。
  // 既有的 486 條相對 import 刻意不一次全部機械式改寫——那會製造一次
  // 巨大、無法審閱、且跟真正的重構混在一起的變更；改成「新寫的程式碼一律
  // 用別名，既有檔案在因為別的原因被動到時順手換掉」。
  //
  // vitest 的設定就寫在這個檔案的 `test` 區塊（同一份 resolve 設定），
  // 所以測試環境會自動沿用這裡的別名，不需要另外再設一份。
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./frontend/src', import.meta.url)),
      '@components': fileURLToPath(new URL('./frontend/components', import.meta.url)),
      '@hooks': fileURLToPath(new URL('./frontend/hooks', import.meta.url)),
      '@utils': fileURLToPath(new URL('./frontend/utils', import.meta.url)),
    },
  },
  optimizeDeps: {
    entries: ['index.html'],
  },
  // 這裡原本有一段 manualChunks，把 recharts（圖表）與 tiptap（筆記編輯器）強制拆成 vendor
  // chunk。它們各約 440 KB，只有 /situation 與 /note 兩個路由會用到，本來就已經用 lazy()
  // 切成路由 chunk。但手動指定 chunk 之後，Rollup 把兩個套件裡「被其他程式碼共用的小模組」
  // 也放進 vendor chunk，入口 chunk 於是靜態 import 它們，dist/index.html 因此對
  // vendor-recharts（467 KB）與 vendor-tiptap（433 KB）下 modulepreload：使用者打開首頁
  // 就先下載約 900 KB 與首頁完全無關的程式碼。移除後交給 Rollup 依 dynamic import 自動切分，
  // 這兩個套件只在進入對應路由時才會下載。若之後需要重新手動切分，請先確認
  // dist/index.html 的 modulepreload 清單沒有跟著變長（bundlePreload.test.js 會檢查）。
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
      '/api/v1/translation': {
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
