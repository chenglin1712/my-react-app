import { describe, test, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { apiGet, apiPost, apiPatch, apiPut, apiDelete, trackEvent, ApiError, DEFAULT_TIMEOUT_MS } from './apiClient';
import { forgetGuestToken, resetGuestTokenForTests } from './guestToken';

vi.mock('axios');

let mockCurrentUser = null;
vi.mock('../../firebase', () => ({
  auth: { get currentUser() { return mockCurrentUser; } },
}));

describe('normalizeError（透過 apiPost 間接測試，函式本身沒有 export）', () => {
  beforeEach(() => {
    mockCurrentUser = null;
    axios.post.mockReset();
    axios.isCancel.mockReturnValue(false);
  });

  test('detail 是 FastAPI Pydantic 驗證錯誤陣列時，抓出可讀的 msg 而不是 [object Object]', async () => {
    // 稽核報告的重現案例：quiz.py 這輪新增的 Pydantic 驗證失敗時，FastAPI
    // 預設回傳 detail: [{type, loc, msg, input}, ...]，不是字串。
    axios.post.mockRejectedValueOnce({
      response: {
        status: 422,
        data: {
          detail: [
            { type: 'float_parsing', loc: ['body', 'ability'], msg: 'Input should be a valid number', input: 'not_a_number' },
          ],
        },
      },
    });

    try {
      await apiPost('/x', {});
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err.message).not.toContain('[object Object]');
      expect(err.message).toContain('Input should be a valid number');
    }
  });

  test('detail 是多筆驗證錯誤時，每一筆的 msg 都會出現在訊息裡', async () => {
    axios.post.mockRejectedValueOnce({
      response: {
        status: 422,
        data: {
          detail: [
            { msg: '第一個錯誤' },
            { msg: '第二個錯誤' },
          ],
        },
      },
    });

    try {
      await apiPost('/x', {});
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.message).toContain('第一個錯誤');
      expect(err.message).toContain('第二個錯誤');
    }
  });

  test('detail 是一般字串時維持原本行為', async () => {
    axios.post.mockRejectedValueOnce({
      response: { status: 400, data: { detail: '查詢字詞不可為空' } },
    });

    try {
      await apiPost('/x', {});
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.message).toBe('查詢字詞不可為空');
    }
  });

  test('沒有 response（網路錯誤）時退回 err.message', async () => {
    axios.post.mockRejectedValueOnce(new Error('Network Error'));

    try {
      await apiPost('/x', {});
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.message).toBe('Network Error');
    }
  });
});

describe('apiPatch／apiPut／apiDelete（後台管理系統用，跟 apiGet/apiPost 共用同一套 token 附加與錯誤處理）', () => {
  beforeEach(() => {
    mockCurrentUser = { getIdToken: vi.fn().mockResolvedValue('fake-token') };
    axios.patch.mockReset();
    axios.put.mockReset();
    axios.delete.mockReset();
  });

  test('apiPatch 會附上 Authorization header 並回傳 response.data', async () => {
    axios.patch.mockResolvedValueOnce({ data: { ok: true } });
    const result = await apiPatch('/adminapi/announcements/1/', { title: '新標題' });
    expect(result).toEqual({ ok: true });
    expect(axios.patch).toHaveBeenCalledWith(
      '/adminapi/announcements/1/',
      { title: '新標題' },
      expect.objectContaining({ headers: { Authorization: 'Bearer fake-token' } }),
    );
  });

  test('apiPut 會附上 Authorization header 並回傳 response.data', async () => {
    axios.put.mockResolvedValueOnce({ data: { phase: '報名' } });
    const result = await apiPut('/adminapi/exam-schedule/overrides/報名/', { start_date: '2026-02-01' });
    expect(result).toEqual({ phase: '報名' });
    expect(axios.put).toHaveBeenCalledWith(
      '/adminapi/exam-schedule/overrides/報名/',
      { start_date: '2026-02-01' },
      expect.objectContaining({ headers: { Authorization: 'Bearer fake-token' } }),
    );
  });

  test('apiPut 失敗時一樣包成 ApiError', async () => {
    axios.put.mockRejectedValueOnce({ response: { status: 400, data: { detail: '結束日期不能早於開始日期' } } });
    await expect(apiPut('/x', {})).rejects.toMatchObject({ message: '結束日期不能早於開始日期', status: 400 });
  });

  test('apiDelete 會附上 Authorization header 並回傳 response.data', async () => {
    axios.delete.mockResolvedValueOnce({ data: { detail: '已刪除' } });
    const result = await apiDelete('/adminapi/announcements/1/');
    expect(result).toEqual({ detail: '已刪除' });
    expect(axios.delete).toHaveBeenCalledWith(
      '/adminapi/announcements/1/',
      expect.objectContaining({ headers: { Authorization: 'Bearer fake-token' } }),
    );
  });

  test('apiPatch 失敗時一樣包成 ApiError', async () => {
    axios.patch.mockRejectedValueOnce({ response: { status: 409, data: { detail: '目前狀態無法編輯' } } });
    await expect(apiPatch('/x', {})).rejects.toMatchObject({ message: '目前狀態無法編輯', status: 409 });
  });
});

describe('trackEvent（P5 資料分析：輕量事件回報，任何失敗都不該讓呼叫端需要處理例外）', () => {
  beforeEach(() => {
    mockCurrentUser = null;
    axios.post.mockReset();
    axios.isCancel.mockReturnValue(false);
  });

  test('送出正確的 event_type／tribe／payload', async () => {
    axios.post.mockResolvedValueOnce({ data: { detail: '已記錄' } });
    await trackEvent('page_view', { tribe: 'tayal', payload: { path: '/dictionary' } });
    expect(axios.post).toHaveBeenCalledWith(
      '/adminapi/public/events/',
      { event_type: 'page_view', tribe: 'tayal', payload: { path: '/dictionary' } },
      expect.anything(),
    );
  });

  test('不帶 tribe/payload 也能呼叫', async () => {
    axios.post.mockResolvedValueOnce({ data: { detail: '已記錄' } });
    await trackEvent('quiz_session');
    expect(axios.post).toHaveBeenCalledWith(
      '/adminapi/public/events/',
      { event_type: 'quiz_session', tribe: undefined, payload: undefined },
      expect.anything(),
    );
  });

  test('後端回應失敗時不會 reject，呼叫端不需要 catch', async () => {
    axios.post.mockRejectedValueOnce({ response: { status: 429, data: { detail: '請求過於頻繁，請稍後再試' } } });
    await expect(trackEvent('page_view')).resolves.toBeUndefined();
  });

  test('網路完全失敗時也不會 reject', async () => {
    axios.post.mockRejectedValueOnce(new Error('Network Error'));
    await expect(trackEvent('page_view')).resolves.toBeUndefined();
  });
});

describe('後台重新驗證通知', () => {
  beforeEach(() => {
    mockCurrentUser = null;
    axios.get.mockReset();
    axios.isCancel.mockReturnValue(false);
  });

  test('後端回 401 reauth_required 時送出事件，錯誤照常往外丟', async () => {
    const handler = vi.fn();
    window.addEventListener('admin:reauth-required', handler);
    axios.get.mockRejectedValueOnce({ response: { status: 401, data: { detail: '請重新驗證', code: 'reauth_required' } }, message: 'x' });
    await expect(apiGet('/adminapi/x/')).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener('admin:reauth-required', handler);
  });

  test('一般 401（例如 token 過期）不送這個事件', async () => {
    const handler = vi.fn();
    window.addEventListener('admin:reauth-required', handler);
    axios.get.mockRejectedValueOnce({ response: { status: 401, data: { detail: '身份驗證失敗，請重新登入' } }, message: 'x' });
    await expect(apiGet('/adminapi/x/')).rejects.toMatchObject({ status: 401 });
    expect(handler).not.toHaveBeenCalled();
    window.removeEventListener('admin:reauth-required', handler);
  });
});

describe('逾時與自動重試', () => {
  beforeEach(() => {
    mockCurrentUser = null;
    axios.get.mockReset();
    axios.post.mockReset();
    axios.isCancel.mockReturnValue(false);
  });

  test('每個請求都帶預設逾時，個別呼叫可以覆寫', async () => {
    axios.get.mockResolvedValue({ data: {} });
    await apiGet('/x');
    expect(axios.get.mock.calls[0][1].timeout).toBe(DEFAULT_TIMEOUT_MS);
    await apiGet('/x', { timeout: 5000 });
    expect(axios.get.mock.calls[1][1].timeout).toBe(5000);
  });

  test('逾時顯示中文訊息並標記 timedOut', async () => {
    axios.post.mockRejectedValueOnce(Object.assign(new Error('timeout of 60000ms exceeded'), { code: 'ECONNABORTED' }));
    await expect(apiPost('/x', {})).rejects.toMatchObject({ message: '伺服器回應逾時，請稍後再試', timedOut: true });
  });

  test('GET 遇到暫時性失敗（502）會重試一次，之後成功就回傳資料', async () => {
    vi.useFakeTimers();
    try {
      axios.get.mockRejectedValueOnce({ response: { status: 502, data: {} }, message: 'Bad Gateway' });
      axios.get.mockResolvedValueOnce({ data: { ok: 1 } });
      const pending = apiGet('/x');
      await vi.advanceTimersByTimeAsync(1000);
      await expect(pending).resolves.toEqual({ ok: 1 });
      expect(axios.get).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  test('GET 遇到 4xx 不重試；POST 失敗也不重試（避免重複寫入）', async () => {
    axios.get.mockRejectedValueOnce({ response: { status: 404, data: { detail: '找不到' } } });
    await expect(apiGet('/x')).rejects.toMatchObject({ status: 404 });
    expect(axios.get).toHaveBeenCalledTimes(1);

    axios.post.mockRejectedValueOnce({ response: { status: 502, data: {} } });
    await expect(apiPost('/x', {})).rejects.toMatchObject({ status: 502 });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });
});

describe('訪客憑證標頭（S-01：只有標示 guest 的未登入請求才帶，憑證由後端核發）', () => {
  const futureToken = (id, days = 30) =>
    `g1.${id.padEnd(22, 'x')}.${Math.floor(Date.now() / 1000) + days * 86400}.${'a'.repeat(32)}`;
  const ISSUE_URL = '/api/v1/translation/guest-token';

  // 領取憑證與真正的請求都是 axios.post，用網址分開處理
  const mockServer = ({ onWork } = {}) => {
    const issued = [];
    axios.post.mockImplementation(async (url, data, config) => {
      if (url === ISSUE_URL) {
        const token = futureToken(`issued${issued.length}`);
        issued.push({ token, sent: config.headers['X-Guest-Token'] });
        return { data: { token, expiresAt: 'x' } };
      }
      return onWork ? onWork(url, data, config) : { data: {} };
    });
    return issued;
  };
  const work = () => axios.post.mock.calls.filter((call) => call[0] !== ISSUE_URL);

  beforeEach(() => {
    window.localStorage.clear();
    resetGuestTokenForTests();
    axios.post.mockReset();
    axios.isCancel.mockReturnValue(false);
    mockCurrentUser = null;
  });

  test('未登入且 guest: true：先向後端領憑證，再帶 X-Guest-Token，不帶 Authorization', async () => {
    const issued = mockServer();
    await apiPost('/x', {}, { guest: true });
    const headers = work()[0][2].headers;
    expect(headers['X-Guest-Token']).toBe(issued[0].token);
    expect(headers.Authorization).toBeUndefined();
    expect(window.localStorage.getItem('yy_guest_token')).toBe(issued[0].token);
  });

  test('已經有效的憑證直接使用，不會再向後端領', async () => {
    const issued = mockServer();
    const token = futureToken('existing');
    window.localStorage.setItem('yy_guest_token', token);
    await apiPost('/x', {}, { guest: true });
    await apiPost('/x', {}, { guest: true });
    expect(issued).toHaveLength(0);
    expect(work().every((call) => call[2].headers['X-Guest-Token'] === token)).toBe(true);
  });

  test('同時多個請求只領一張憑證（single-flight）', async () => {
    const issued = mockServer();
    await Promise.all([apiPost('/a', {}, { guest: true }), apiPost('/b', {}, { guest: true }), apiPost('/c', {}, { guest: true })]);
    expect(issued).toHaveLength(1);
    expect(new Set(work().map((call) => call[2].headers['X-Guest-Token'])).size).toBe(1);
  });

  test('剩不到 3 天：帶著舊憑證請後端續期，並改用新的', async () => {
    const issued = mockServer();
    const old = futureToken('nearexpiry', 2);
    window.localStorage.setItem('yy_guest_token', old);
    await apiPost('/x', {}, { guest: true });
    expect(issued[0].sent).toBe(old);
    expect(work()[0][2].headers['X-Guest-Token']).toBe(issued[0].token);
  });

  test('續期失敗但舊憑證還沒過期：繼續用舊的，翻譯不被擋', async () => {
    const old = futureToken('nearexpiry', 1);
    window.localStorage.setItem('yy_guest_token', old);
    axios.post.mockImplementation(async (url) => {
      if (url === ISSUE_URL) throw { response: { status: 503, data: { detail: 'x' } } };
      return { data: {} };
    });
    await apiPost('/x', {}, { guest: true });
    expect(work()[0][2].headers['X-Guest-Token']).toBe(old);
  });

  test('格式不對或已過期的儲存值會被丟掉並重領', async () => {
    const issued = mockServer();
    window.localStorage.setItem('yy_guest_token', 'bad token!');
    await apiPost('/x', {}, { guest: true });
    expect(issued).toHaveLength(1);
    resetGuestTokenForTests();
    window.localStorage.setItem('yy_guest_token', futureToken('expired', -1));
    await apiPost('/x', {}, { guest: true });
    expect(issued).toHaveLength(2);
  });

  test('後端回 401 guest_token_invalid：換領新憑證並只重送一次', async () => {
    let calls = 0;
    const issued = mockServer({
      onWork: async () => {
        calls += 1;
        if (calls === 1) throw { response: { status: 401, data: { code: 'guest_token_invalid', detail: '無效' } } };
        return { data: { ok: true } };
      },
    });
    const stale = futureToken('stale');
    window.localStorage.setItem('yy_guest_token', stale);
    await expect(apiPost('/x', {}, { guest: true })).resolves.toEqual({ ok: true });
    expect(work()).toHaveLength(2);
    expect(work()[0][2].headers['X-Guest-Token']).toBe(stale);
    expect(work()[1][2].headers['X-Guest-Token']).toBe(issued[0].token);
  });

  test('重送後仍然被拒絕：不再重試，丟出錯誤', async () => {
    mockServer({
      onWork: async () => { throw { response: { status: 401, data: { code: 'guest_token_invalid', detail: '無效' } } }; },
    });
    await expect(apiPost('/x', {}, { guest: true })).rejects.toMatchObject({ status: 401 });
    expect(work()).toHaveLength(2);
  });

  test('其他 401（沒有 guest_token_invalid）不重試也不刪憑證', async () => {
    mockServer({ onWork: async () => { throw { response: { status: 401, data: { detail: '身份驗證失敗' } } }; } });
    const token = futureToken('keepme');
    window.localStorage.setItem('yy_guest_token', token);
    await expect(apiPost('/x', {}, { guest: true })).rejects.toMatchObject({ status: 401 });
    expect(work()).toHaveLength(1);
    expect(window.localStorage.getItem('yy_guest_token')).toBe(token);
  });

  test('被拒絕的憑證只有在儲存的仍是同一張時才刪（不誤刪別的請求剛領到的新憑證）', async () => {
    const stale = futureToken('stale');
    const fresh = futureToken('fresh');
    window.localStorage.setItem('yy_guest_token', stale);
    forgetGuestToken(fresh);                       // 儲存的不是 fresh：不動
    expect(window.localStorage.getItem('yy_guest_token')).toBe(stale);
    forgetGuestToken(stale);
    expect(window.localStorage.getItem('yy_guest_token')).toBeNull();
  });

  test('等待核發期間別的分頁已存了憑證：採用它，不覆蓋成自己的（compare-and-set）', async () => {
    const other = futureToken('othertab');
    axios.post.mockImplementation(async (url) => {
      if (url === ISSUE_URL) {
        window.localStorage.setItem('yy_guest_token', other);   // 另一個分頁剛好先領到
        return { data: { token: futureToken('mine'), expiresAt: 'x' } };
      }
      return { data: {} };
    });
    await apiPost('/x', {}, { guest: true });
    expect(work()[0][2].headers['X-Guest-Token']).toBe(other);
    expect(window.localStorage.getItem('yy_guest_token')).toBe(other);
  });

  test('請求被丟出 null 或字串時：包成 ApiError，不因讀屬性而丟出 TypeError', async () => {
    mockServer({ onWork: async () => { throw null; } });
    await expect(apiPost('/x', {}, { guest: true })).rejects.toBeInstanceOf(ApiError);
    mockServer({ onWork: async () => { throw 'boom'; } });
    await expect(apiPost('/x', {}, { guest: true })).rejects.toMatchObject({ message: 'boom' });
  });

  test('領憑證被擋（這個網路今天領太多）：把後端的訊息交給呼叫端，不送出真正的請求', async () => {
    axios.post.mockImplementation(async (url) => {
      if (url === ISSUE_URL) throw { response: { status: 429, data: { detail: '這個網路今天領取的試用名額已達上限，請登入後使用。', code: 'guest_issue_capped' } } };
      return { data: {} };
    });
    await expect(apiPost('/x', {}, { guest: true })).rejects.toMatchObject({
      status: 429, data: { code: 'guest_issue_capped' },
    });
    expect(work()).toHaveLength(0);
  });

  test('localStorage 不可用時退回記憶體，同一頁面期間共用同一張', async () => {
    const issued = mockServer();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    await apiPost('/x', {}, { guest: true });
    await apiPost('/x', {}, { guest: true });
    expect(issued).toHaveLength(1);
    vi.restoreAllMocks();
  });

  test('未登入但沒標示 guest：不領也不送出憑證', async () => {
    const issued = mockServer();
    await apiPost('/x', {});
    expect(issued).toHaveLength(0);
    expect(work()[0][2].headers['X-Guest-Token']).toBeUndefined();
  });

  test('已登入即使標示 guest：只帶 Authorization，不領也不帶憑證', async () => {
    const issued = mockServer();
    mockCurrentUser = { getIdToken: vi.fn().mockResolvedValue('tok') };
    await apiPost('/x', {}, { guest: true });
    const headers = work()[0][2].headers;
    expect(headers.Authorization).toBe('Bearer tok');
    expect(headers['X-Guest-Token']).toBeUndefined();
    expect(issued).toHaveLength(0);
  });
});
