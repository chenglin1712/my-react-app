import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Review from './review';
import { getCurrentSituation, getQuizById } from '../../src/userServives/uploadDb';
import { apiGet } from '../../utils/apiClient';

vi.mock('../../src/userServives/uploadDb', () => ({
  getCurrentSituation: vi.fn(),
  getQuizById: vi.fn(),
  countScore: () => 100,
}));
vi.mock('./review_discussion', () => ({ default: () => <div>討論假資料</div> }));
vi.mock('./review_AI', () => ({ default: () => <div>AI助手</div> }));
vi.mock('../../utils/apiClient', () => ({ apiGet: vi.fn() }));
vi.mock('./QuestionExplanation', () => ({
  default: ({ attemptId, index, tribe }) => <div>單題講解 {attemptId} #{index} {tribe}</div>,
}));

function makeTimestamp(dateStr) {
  return { toDate: () => new Date(dateStr) };
}

const SITUATION = {
  id: 'situation-1',
  quizId: 'quiz-A',
  quizType: '中級',
  answeredAt: makeTimestamp('2026-03-05'),
  results: [{ isCorrect: true }],
  answers: [1],
  correctAnswers: [1],
};

// 稽核 FE1-11／FE4-10：getCurrentSituation 改成回傳一頁（{ situations, cursor, hasMore }）
function page(situations, { cursor = null, hasMore = false } = {}) {
  return { situations, cursor, hasMore };
}

const QUIZ_DATA = {
  title: '中級',
  createdAt: makeTimestamp('2020-01-01'),
  data: [{ question_ab: 'balay?', question_ch: '真的嗎？' }],
};

describe('Review（回歸測試：查看測驗詳情時用 answeredAt 而不是 createdAt，返回時清掉題目詳情）', () => {
  beforeEach(() => {
    getCurrentSituation.mockReset();
    getQuizById.mockReset();
    apiGet.mockReset();
    apiGet.mockResolvedValue({ features: { questionReview: false } });
  });

  test('查看測驗詳情後點返回，會回到列表，且題目詳情也一併清空', async () => {
    getCurrentSituation.mockResolvedValue(page([SITUATION]));
    getQuizById.mockResolvedValue(QUIZ_DATA);
    const user = userEvent.setup();
    render(<Review />);

    await user.click(await screen.findByRole('button', { name: '查看測驗' }));
    expect(await screen.findByText(/2026/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '查看題目' }));
    await screen.findByText('取消');
    expect(document.querySelector('.review-question-card .question-ab')).toHaveTextContent('balay?');

    await user.click(screen.getByRole('button', { name: /返回/ }));

    // 回到列表後，右側題目詳情不應該還留著剛剛看的那一題
    expect(screen.getByText('尚未選擇題目')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看測驗' })).toBeInTheDocument();
  });

  test('討論/AI助手分頁一開始就是 disabled', async () => {
    getCurrentSituation.mockResolvedValue(page([]));
    render(<Review />);

    expect(await screen.findByRole('button', { name: /討論/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /AI助手/ })).toBeDisabled();
  });

  test('旗標開啟後：選了題目才能開 AI助手分頁，並用這次作答的編號與題號請求單題講解', async () => {
    apiGet.mockResolvedValue({ features: { questionReview: true } });
    getCurrentSituation.mockResolvedValue(page([SITUATION]));
    getQuizById.mockResolvedValue({ ...QUIZ_DATA, tribe: 'amis' });
    const user = userEvent.setup();
    render(<Review />);

    await user.click(await screen.findByRole('button', { name: '查看測驗' }));
    await screen.findByText(/2026/);
    expect(screen.getByRole('button', { name: /AI助手/ })).toBeDisabled();     // 還沒選題目

    await user.click(screen.getByRole('button', { name: '查看題目' }));
    await screen.findByText('取消');
    await user.click(screen.getByRole('button', { name: /AI助手/ }));

    expect(await screen.findByText('單題講解 situation-1 #0 amis')).toBeInTheDocument();
    expect(screen.getByText('AI助手', { selector: 'div' })).toBeInTheDocument();      // 原本的句子補充說明對話仍在
  });

  test('讀不到旗標（網路失敗）時當作沒開放，不影響測驗紀錄', async () => {
    apiGet.mockRejectedValue(new Error('network'));
    getCurrentSituation.mockResolvedValue(page([SITUATION]));
    render(<Review />);

    expect(await screen.findByRole('button', { name: '查看測驗' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AI助手/ })).toBeDisabled();
  });
});

describe('Review 稽核 WP-9（FE1-11、FE4-10、FE4-20）', () => {
  beforeEach(() => {
    getCurrentSituation.mockReset();
    getQuizById.mockReset();
    apiGet.mockReset();
    apiGet.mockResolvedValue({ features: { questionReview: false } });
  });

  test('FE4-10：還有更早的紀錄時顯示「載入更早的紀錄」，按下後用 cursor 接著讀並附加在後面', async () => {
    const older = { ...SITUATION, id: 'situation-2', quizType: '初級' };
    getCurrentSituation
      .mockResolvedValueOnce(page([SITUATION], { cursor: 'CURSOR-1', hasMore: true }))
      .mockResolvedValueOnce(page([older], { cursor: 'CURSOR-2', hasMore: false }));
    const user = userEvent.setup();
    render(<Review />);

    await user.click(await screen.findByRole('button', { name: '載入更早的紀錄' }));

    expect(getCurrentSituation).toHaveBeenLastCalledWith({ cursor: 'CURSOR-1' });
    expect(await screen.findByText('初級')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '查看測驗' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '載入更早的紀錄' })).not.toBeInTheDocument();
  });

  test('答題紀錄讀取失敗時顯示錯誤與重試，不顯示「尚無答題紀錄」', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getCurrentSituation
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(page([SITUATION]));
    const user = userEvent.setup();
    render(<Review />);

    expect(await screen.findByText('答題紀錄載入失敗，請稍後再試。')).toBeInTheDocument();
    expect(screen.queryByText('尚無答題紀錄')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '重試' }));
    expect(await screen.findByRole('button', { name: '查看測驗' })).toBeInTheDocument();
    expect(screen.queryByText('答題紀錄載入失敗，請稍後再試。')).not.toBeInTheDocument();
    errorSpy.mockRestore();
  });

  test('FE4-20：題目讀取中按鈕顯示「讀取中…」並停用；讀不到題目時顯示提示，停在列表', async () => {
    getCurrentSituation.mockResolvedValue(page([SITUATION]));
    let resolveQuiz;
    getQuizById.mockImplementation(() => new Promise((resolve) => { resolveQuiz = resolve; }));
    const user = userEvent.setup();
    render(<Review />);

    await user.click(await screen.findByRole('button', { name: '查看測驗' }));
    expect(screen.getByRole('button', { name: '讀取中…' })).toBeDisabled();

    resolveQuiz(null);

    expect(await screen.findByRole('alert')).toHaveTextContent('這次測驗的題目已無法讀取');
    expect(screen.getByRole('button', { name: '查看測驗' })).toBeEnabled();
  });
});
