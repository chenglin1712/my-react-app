import '@testing-library/jest-dom/vitest';

// .env.example 現在帶有 AI 助手的串流網址，測試預設會因此走串流路徑；
// 沒有特別測串流的測試維持原本的 apiPost 路徑，要測串流的測試自己在 beforeEach 再 stubEnv 成網址。
import { beforeEach, vi } from 'vitest';
beforeEach(() => {
  vi.stubEnv('VITE_API_AI_BOT_STREAM_URL', '');
});
