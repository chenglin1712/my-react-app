import { defineConfig } from 'vitest/config';

// firestore.rules.test.js 需要真的連線 Firestore emulator（node 環境、真實
// socket），跟 vite.config.js 裡給前端元件用的 jsdom 設定是兩回事，也不該被
// `npm test`（前端一般單元測試）意外挑到——那個指令沒有啟動 emulator，硬跑
// 這個檔案只會整批掛掉。獨立成自己的設定檔，用 npm run test:rules 單獨執行
// （見 package.json，搭配 firebase emulators:exec 啟動好模擬器再跑）。
export default defineConfig({
  test: {
    environment: 'node',
    include: ['firestore.rules.test.js'],
    hookTimeout: 30000,
    testTimeout: 15000,
  },
});
