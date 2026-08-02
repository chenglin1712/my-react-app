import { describe, test, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { apiPost, apiPatch, apiPut, apiDelete, ApiError } from './apiClient';

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
