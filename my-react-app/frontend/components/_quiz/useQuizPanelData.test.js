import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useQuizPanelData } from './useQuizPanelData';
import { apiGet } from '../../utils/apiClient';
import { uploadQuizDB } from '../../src/userServives/uploadDb';

/** 抓資料的 effect 用 isMounted 擋住 setTimeout(...) 的排程時機，但排程進去
 * 的 1000ms callback 本身既不會重新檢查 isMounted，清除函式也沒有把它
 * clear 掉。使用者快速切換 level／tribe，讓舊的 effect 在 1000ms 內被清除，
 * 舊的 callback 原本仍會照常觸發，用上一輪的資料把作答進度蓋掉。 */
vi.mock('../../utils/apiClient', () => ({ apiGet: vi.fn() }));
vi.mock('../../src/userServives/uploadDb', () => ({ uploadQuizDB: vi.fn().mockResolvedValue({ id: 'quiz-1' }) }));

function makeResponse(questionCount, marker = 'q') {
  return {
    parts: [{
      type: 'true_false',
      questions: Array.from({ length: questionCount }, (_, i) => ({
        id: i,
        question_ab: `${marker}-${i}`,
      })),
    }],
  };
}

describe('useQuizPanelData 的延遲 setTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiGet.mockReset();
    uploadQuizDB.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('切換 level 後，舊的 setTimeout 不會用舊資料蓋掉新一輪的作答進度', async () => {
    let resolveFirst;
    apiGet.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));

    const { result, rerender, unmount } = renderHook(
      ({ level }) => useQuizPanelData(level, 'tayal', '初級'),
      { initialProps: { level: 1 } }
    );

    // 第一輪請求先回來，isMounted 還是 true，1000ms 的 setTimeout 被排進去
    await act(async () => {
      resolveFirst(makeResponse(3));
      await Promise.resolve();
    });

    // 使用者在 1000ms 內就切換了 level，effect 清除函式應該要 clearTimeout
    // 掉舊的那個排程；第二輪請求先不 resolve，維持在 loading 狀態。
    apiGet.mockImplementationOnce(() => new Promise(() => {}));
    rerender({ level: 2 });

    // 把時間推進超過原本第一輪的 1000ms：如果舊的 callback 沒有被清除，
    // 這裡就會用第一輪的 3 題資料把 userAnswers 蓋成 [null, null, null]。
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });

    // 第二輪還沒回應，不該有任何一輪的 setTimeout callback 執行過。
    expect(result.current.isLoading).toBe(true);
    expect(result.current.userAnswers).toEqual([]);
    expect(result.current.dataLen).toBe(0);

    unmount();
  });

  test('正常情況下（沒有中途切換）setTimeout 仍會如期把資料展開', async () => {
    apiGet.mockResolvedValueOnce(makeResponse(2));

    const { result } = renderHook(() => useQuizPanelData(1, 'tayal', '初級'));

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.dataLen).toBe(2);
    expect(result.current.userAnswers).toEqual([null, null]);
  });
});

/** FE-10：上傳用的 effect 依賴 [data, level_ch, tribe]，但切換等級時 data
 * 還是上一份測驗的內容，於是會用「舊題目」搭配「新的等級／族語標籤」呼叫
 * uploadQuizDB()。uploadDb.jsx 用的是 addDoc() 而不是 upsert，所以 Firestore
 * 會真的多留下一份內容錯誤的文件——不是畫面顯示錯而已。
 *
 * 而且 quizInfo.ans 是批改用的正確答案、quizInfo.id 是要寫進 situations 的
 * 測驗文件 ID，所以殘留的舊 quizInfo 還會讓使用者被用「上一份測驗的答案」
 * 批改。下面四支測試分別鎖住這幾條路徑。 */
describe('useQuizPanelData 的上傳競態（FE-10）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiGet.mockReset();
    uploadQuizDB.mockReset();
    uploadQuizDB.mockResolvedValue({ id: 'quiz-1', ans: [1] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('切換等級時，不會用舊題目搭配新的等級標籤上傳', async () => {
    apiGet.mockResolvedValueOnce(makeResponse(2, 'level1'));

    const { rerender } = renderHook(
      ({ level, levelCh }) => useQuizPanelData(level, 'tayal', levelCh),
      { initialProps: { level: 1, levelCh: '初級' } },
    );

    await act(async () => { await Promise.resolve(); });

    // 第一輪正常上傳：初級 + 第一輪題目
    expect(uploadQuizDB).toHaveBeenCalledTimes(1);
    expect(uploadQuizDB.mock.calls[0][0]).toBe('初級');
    expect(uploadQuizDB.mock.calls[0][1][0].question_ab).toBe('level1-0');

    uploadQuizDB.mockClear();

    // 切到中級，第二輪請求還沒回來——此時 data 仍是第一輪的內容。
    apiGet.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => {
      rerender({ level: 2, levelCh: '中級' });
      await Promise.resolve();
    });

    // 修正前：這裡會用 level1 的題目、掛上「中級」標籤寫進 Firestore。
    expect(uploadQuizDB).not.toHaveBeenCalled();
  });

  test('新測驗載入完成後，才用新題目與新標籤上傳一次', async () => {
    apiGet.mockResolvedValueOnce(makeResponse(2, 'level1'));

    const { rerender } = renderHook(
      ({ level, levelCh }) => useQuizPanelData(level, 'tayal', levelCh),
      { initialProps: { level: 1, levelCh: '初級' } },
    );
    await act(async () => { await Promise.resolve(); });
    uploadQuizDB.mockClear();

    let resolveSecond;
    apiGet.mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    await act(async () => {
      rerender({ level: 2, levelCh: '中級' });
      await Promise.resolve();
    });

    await act(async () => {
      resolveSecond(makeResponse(3, 'level2'));
      await Promise.resolve();
    });

    expect(uploadQuizDB).toHaveBeenCalledTimes(1);
    expect(uploadQuizDB.mock.calls[0][0]).toBe('中級');
    expect(uploadQuizDB.mock.calls[0][1][0].question_ab).toBe('level2-0');
  });

  test('切換等級時立刻作廢舊的 quizInfo，避免用上一份測驗的答案批改', async () => {
    apiGet.mockResolvedValueOnce(makeResponse(2, 'level1'));
    uploadQuizDB.mockResolvedValueOnce({ id: 'quiz-level-1', ans: [1, 2] });

    const { result, rerender } = renderHook(
      ({ level, levelCh }) => useQuizPanelData(level, 'tayal', levelCh),
      { initialProps: { level: 1, levelCh: '初級' } },
    );

    await act(async () => { await Promise.resolve(); });
    expect(result.current.quizInfo).toEqual({ id: 'quiz-level-1', ans: [1, 2] });

    apiGet.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => {
      rerender({ level: 2, levelCh: '中級' });
      await Promise.resolve();
    });

    // 新測驗還在載入 → quizInfo 必須是 null，呼叫端的
    // `if (!quizInfo) return;` 才會讓繳交在這段期間安全地不動作。
    expect(result.current.quizInfo).toBeNull();
    expect(result.current.savedQuestions).toEqual([]);
  });

  test('較早發出的上傳晚回來時，不會蓋掉較新測驗的 quizInfo', async () => {
    apiGet.mockResolvedValueOnce(makeResponse(2, 'level1'));

    let resolveFirstUpload;
    uploadQuizDB.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirstUpload = resolve; }),
    );

    const { result, rerender } = renderHook(
      ({ level, levelCh }) => useQuizPanelData(level, 'tayal', levelCh),
      { initialProps: { level: 1, levelCh: '初級' } },
    );

    await act(async () => { await Promise.resolve(); });

    // 第一輪上傳還卡著，使用者已經切到中級並且新資料也回來了
    apiGet.mockResolvedValueOnce(makeResponse(3, 'level2'));
    uploadQuizDB.mockResolvedValueOnce({ id: 'quiz-level-2', ans: [3] });

    await act(async () => {
      rerender({ level: 2, levelCh: '中級' });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.quizInfo).toEqual({ id: 'quiz-level-2', ans: [3] });

    // 現在第一輪的上傳才回來——不能把新測驗的 quizInfo 蓋掉。
    await act(async () => {
      resolveFirstUpload({ id: 'quiz-level-1', ans: [1, 2] });
      await Promise.resolve();
    });

    expect(result.current.quizInfo).toEqual({ id: 'quiz-level-2', ans: [3] });
  });
});

/** uploadQuizDB 失敗時是回傳 null（它自己 catch 掉例外），不會拋出來。
 * 少了顯性的失敗旗標，quizInfo 停在 null，使用者按繳交時呼叫端的
 * `if (!quizInfo) return;` 只是靜默不動作——畫面零提示，看起來像按鈕壞了。 */
describe('useQuizPanelData 的上傳失敗狀態', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiGet.mockReset();
    uploadQuizDB.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('上傳失敗（回傳 null）時 uploadFailed 為 true', async () => {
    apiGet.mockResolvedValueOnce(makeResponse(2));
    uploadQuizDB.mockResolvedValueOnce(null);

    const { result } = renderHook(() => useQuizPanelData(1, 'tayal', '初級'));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.uploadFailed).toBe(true);
    expect(result.current.quizInfo).toBeNull();
  });

  test('上傳成功時 uploadFailed 維持 false', async () => {
    apiGet.mockResolvedValueOnce(makeResponse(2));
    uploadQuizDB.mockResolvedValueOnce({ id: 'quiz-1', ans: [1, 2] });

    const { result } = renderHook(() => useQuizPanelData(1, 'tayal', '初級'));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.uploadFailed).toBe(false);
    expect(result.current.quizInfo).toEqual({ id: 'quiz-1', ans: [1, 2] });
  });

  test('切換測驗時失敗狀態會被清掉，不會沿用到下一份測驗', async () => {
    apiGet.mockResolvedValueOnce(makeResponse(2));
    uploadQuizDB.mockResolvedValueOnce(null);

    const { result, rerender } = renderHook(
      ({ level, levelCh }) => useQuizPanelData(level, 'tayal', levelCh),
      { initialProps: { level: 1, levelCh: '初級' } },
    );
    await act(async () => { await Promise.resolve(); });
    expect(result.current.uploadFailed).toBe(true);

    apiGet.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => {
      rerender({ level: 2, levelCh: '中級' });
      await Promise.resolve();
    });

    expect(result.current.uploadFailed).toBe(false);
  });
});
