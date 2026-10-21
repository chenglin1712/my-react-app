import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiStream, ApiError } from './apiClient';

vi.mock('axios');
vi.mock('../../firebase', () => ({
  auth: { currentUser: { getIdToken: vi.fn().mockResolvedValue('tok') } },
}));

const encoder = new TextEncoder();

// 一個會依序吐出 chunks 的假 reader；chunk 是字串，最後一個之後回報結束。hang 為 true 時最後會一直卡住（模擬伺服器不再回應）。
function fakeResponse(chunks, { status = 200, hang = false, signal } = {}) {
  let i = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => JSON.parse(chunks.join('')),
    body: {
      getReader: () => ({
        read: () => {
          if (i < chunks.length) return Promise.resolve({ done: false, value: encoder.encode(chunks[i++]) });
          if (!hang) return Promise.resolve({ done: true, value: undefined });
          return new Promise((_, reject) => {
            const abort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
            if (signal?.aborted) abort();                  // 真正的 fetch 在 signal 已中止時讀取會立刻失敗
            else signal?.addEventListener('abort', abort);
          });
        },
      }),
    },
  };
}

const sse = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

describe('apiStream', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('逐段回呼文字，done 事件的內容是回傳值；帶 token 並要求 event-stream', async () => {
    fetch.mockResolvedValue(fakeResponse([sse('delta', { t: '你' }), sse('delta', { t: '好' }), sse('done', { message: '你好', sig: 's' })]));
    const pieces = [];

    const result = await apiStream('/stream/', { message: 'hi' }, { onDelta: (t) => pieces.push(t) });

    expect(pieces).toEqual(['你', '好']);
    expect(result).toEqual({ message: '你好', sig: 's' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/stream/');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok', Accept: 'text/event-stream' });
    expect(JSON.parse(init.body)).toEqual({ message: 'hi' });
  });

  test('一個事件被切在兩個網路封包中間、或 CRLF 換行，也能正確拼回來', async () => {
    const block = sse('delta', { t: '哈囉' });
    fetch.mockResolvedValue(fakeResponse([block.slice(0, 12), block.slice(12).replace(/\n/g, '\r\n'), sse('done', { message: '哈囉' })]));
    const pieces = [];

    await apiStream('/s/', {}, { onDelta: (t) => pieces.push(t) });

    expect(pieces).toEqual(['哈囉']);
  });

  // 把 reader 的輸出換成指定的 byte 區塊，才能精準控制封包切在哪裡
  const byteResponse = (parts, onCancel) => {
    let i = 0;
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => (i < parts.length ? { done: false, value: parts[i++] } : { done: true }),
          cancel: async () => { onCancel?.(); },
        }),
      },
    };
  };

  test('CRLF 的 \\r 和 \\n 被切在兩個封包中間，仍然正確分出事件（不會卡住，也不會多出假事件）', async () => {
    const bytes = encoder.encode(sse('delta', { t: '甲' }).replace(/\n/g, '\r\n') + sse('done', { message: '甲' }).replace(/\n/g, '\r\n'));
    const parts = [];
    // 每個 byte 一個封包：所有可能的切點都會經過，包含 \r 與 \n 之間
    for (let i = 0; i < bytes.length; i += 1) parts.push(bytes.slice(i, i + 1));
    fetch.mockResolvedValue(byteResponse(parts));
    const pieces = [];

    const result = await apiStream('/s/', {}, { onDelta: (t) => pieces.push(t) });

    expect(pieces).toEqual(['甲']);
    expect(result).toEqual({ message: '甲' });
  });

  test('單獨的 \\r 也是合法的 SSE 換行', async () => {
    const text = sse('delta', { t: '乙' }).replace(/\n/g, '\r') + sse('done', { message: '乙' }).replace(/\n/g, '\r');
    fetch.mockResolvedValue(byteResponse([encoder.encode(text)]));
    const pieces = [];

    await apiStream('/s/', {}, { onDelta: (t) => pieces.push(t) });

    expect(pieces).toEqual(['乙']);
  });

  test('最後一個事件後面沒有空行就結束連線，done 仍然被接受', async () => {
    fetch.mockResolvedValue(byteResponse([encoder.encode(`event: done\ndata: ${JSON.stringify({ message: '尾' })}\n`)]));

    await expect(apiStream('/s/', {})).resolves.toEqual({ message: '尾' });
  });

  test('收到 done 之後取消 reader，把連線還給瀏覽器', async () => {
    const cancel = vi.fn();
    fetch.mockResolvedValue(byteResponse([encoder.encode(sse('done', { message: 'x' }))], cancel));

    await apiStream('/s/', {});

    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test('多位元組的中文字被切在兩個封包中間不會變成亂碼', async () => {
    const bytes = encoder.encode(sse('delta', { t: '族語' }) + sse('done', { message: '族語' }));
    // 切點不寫死：找到「族」的第一個 byte，從它的第二個 byte 切開（UTF-8 中文字佔三個 byte）
    const cut = bytes.indexOf(encoder.encode('族')[0]) + 1;
    expect(bytes[cut] & 0b11000000).toBe(0b10000000);      // 確認切點真的落在字元中間
    const parts = [bytes.slice(0, cut), bytes.slice(cut)];
    let i = 0;
    fetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: { getReader: () => ({ read: async () => (i < parts.length ? { done: false, value: parts[i++] } : { done: true }) }) },
    });
    const pieces = [];

    await apiStream('/s/', {}, { onDelta: (t) => pieces.push(t) });

    expect(pieces.join('')).toBe('族語');
  });

  test('開始串流之前的錯誤（429 額度用完）是帶 status 與 data 的 ApiError，和 apiPost 一致', async () => {
    fetch.mockResolvedValue(fakeResponse([JSON.stringify({ detail: '今天的提問次數已經用完了', code: 'ai_daily_quota_exceeded' })], { status: 429 }));

    await expect(apiStream('/s/', {})).rejects.toMatchObject({
      name: 'ApiError', status: 429, message: '今天的提問次數已經用完了', data: { code: 'ai_daily_quota_exceeded' },
    });
  });

  test('串流中途的 error 事件：丟 ApiError，partial 表示之前已經收到過文字', async () => {
    fetch.mockResolvedValue(fakeResponse([sse('delta', { t: '半截' }), sse('error', { detail: '回覆花的時間太久，請重試。', status: 504 })]));

    const err = await apiStream('/s/', {}, { onDelta() {} }).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 504, partial: true });
  });

  test('連線結束卻沒有 done：不能把半截文字當成完整回覆', async () => {
    fetch.mockResolvedValue(fakeResponse([sse('delta', { t: '半截' })]));

    const err = await apiStream('/s/', {}, { onDelta() {} }).catch((e) => e);

    expect(err).toMatchObject({ partial: true, data: { interrupted: true } });
  });

  test('網路直接斷線（fetch 本身丟錯）包成 ApiError，還沒收到文字所以 partial 是 false', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const err = await apiStream('/s/', {}).catch((e) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect(err.partial).toBe(false);
  });

  test('呼叫端中止時原樣丟出中止錯誤，不包成 ApiError', async () => {
    const controller = new AbortController();
    fetch.mockImplementation((_url, init) => Promise.resolve(fakeResponse([sse('delta', { t: '一' })], { hang: true, signal: init.signal })));
    const pending = apiStream('/s/', {}, { signal: controller.signal, onDelta: () => controller.abort() }).catch((e) => e);

    const err = await pending;

    expect(err).not.toBeInstanceOf(ApiError);
    expect(err.name).toBe('AbortError');
  });

  test('伺服器太久沒有任何資料就當作斷線，並標示逾時', async () => {
    vi.useFakeTimers();
    fetch.mockImplementation((_url, init) => Promise.resolve(fakeResponse([sse('delta', { t: '一' })], { hang: true, signal: init.signal })));
    const pending = apiStream('/s/', {}, { onDelta() {}, idleTimeoutMs: 5000 }).catch((e) => e);

    await vi.advanceTimersByTimeAsync(5001);
    const err = await pending;

    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ timedOut: true, partial: true });
  });
});
