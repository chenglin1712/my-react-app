import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useQuizPanelData } from './useQuizPanelData';
import { apiGet } from '../../utils/apiClient';

/** 抓資料的 effect 用 isMounted 擋住 setTimeout(...) 的排程時機，但排程進去
 * 的 1000ms callback 本身既不會重新檢查 isMounted，清除函式也沒有把它
 * clear 掉。使用者快速切換 level／tribe，讓舊的 effect 在 1000ms 內被清除，
 * 舊的 callback 原本仍會照常觸發，用上一輪的資料把作答進度蓋掉。 */
vi.mock('../../utils/apiClient', () => ({ apiGet: vi.fn() }));

function makeResponse(questionCount, marker = 'q', quizId = `quiz-${marker}`) {
  return {
    ...(quizId ? { quizId } : {}),
    parts: [{
      type: 'true_false',
      questions: Array.from({ length: questionCount }, (_, i) => ({
        id: i,
        question_ab: `${marker}-${i}`,
        answer: 1,
      })),
    }],
  };
}

describe('useQuizPanelData 的延遲 setTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiGet.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('切換 level 後，舊的 setTimeout 不會用舊資料蓋掉新一輪的作答進度', async () => {
    let resolveFirst;
    apiGet.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));

    const { result, rerender, unmount } = renderHook(
      ({ level }) => useQuizPanelData(level, 'tayal'),
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

    const { result } = renderHook(() => useQuizPanelData(1, 'tayal'));

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

/** 測驗題目由伺服器存進資料庫並隨出題回應回傳 quizId（S-06）。前端只負責採用它：
 * quizInfo.ans 是批改用的正確答案、quizInfo.id 是要寫進 situations 的測驗文件 ID，
 * 切換等級時不能讓上一份測驗的 quizId／答案殘留。 */
describe('useQuizPanelData 的 quizId（伺服器建立測驗）', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    apiGet.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('採用回應裡的 quizId，批改用答案取自題目，且不會有上傳失敗旗標', async () => {
    apiGet.mockResolvedValueOnce(makeResponse(2, 'level1'));
    const { result } = renderHook(() => useQuizPanelData(1, 'tayal'));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.quizInfo).toEqual({ id: 'quiz-level1', ans: [1, 1] });
    expect(result.current.uploadFailed).toBe(false);
    expect(result.current.savedQuestions).toHaveLength(2);
  });

  test('回應沒有 quizId 時 uploadFailed 為 true，quizInfo 維持 null', async () => {
    apiGet.mockResolvedValueOnce(makeResponse(2, 'level1', null));
    const { result } = renderHook(() => useQuizPanelData(1, 'tayal'));
    await act(async () => { await Promise.resolve(); });

    expect(result.current.uploadFailed).toBe(true);
    expect(result.current.quizInfo).toBeNull();
  });

  test('切換等級時立刻作廢舊的 quizInfo 與失敗旗標，避免用上一份測驗的答案批改', async () => {
    apiGet.mockResolvedValueOnce(makeResponse(2, 'level1'));
    const { result, rerender } = renderHook(
      ({ level }) => useQuizPanelData(level, 'tayal'),
      { initialProps: { level: 1 } },
    );
    await act(async () => { await Promise.resolve(); });
    expect(result.current.quizInfo.id).toBe('quiz-level1');

    apiGet.mockImplementationOnce(() => new Promise(() => {}));
    await act(async () => {
      rerender({ level: 2 });
      await Promise.resolve();
    });

    expect(result.current.quizInfo).toBeNull();
    expect(result.current.savedQuestions).toEqual([]);
    expect(result.current.uploadFailed).toBe(false);
  });

  test('新測驗載入完成後，採用新測驗自己的 quizId', async () => {
    apiGet.mockResolvedValueOnce(makeResponse(2, 'level1'));
    const { result, rerender } = renderHook(
      ({ level }) => useQuizPanelData(level, 'tayal'),
      { initialProps: { level: 1 } },
    );
    await act(async () => { await Promise.resolve(); });

    let resolveSecond;
    apiGet.mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    await act(async () => {
      rerender({ level: 2 });
      await Promise.resolve();
    });
    await act(async () => {
      resolveSecond(makeResponse(3, 'level2'));
      await Promise.resolve();
    });

    expect(result.current.quizInfo).toEqual({ id: 'quiz-level2', ans: [1, 1, 1] });
  });
});
