import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import RecommendedQuizQuestion from './quiz_recommon_question';
import { apiPost } from '../../utils/apiClient';
import { loadQuizModel, saveQuizModel } from './quizModelService';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));
vi.mock('../../src/userServives/authContext', () => ({
  useAuth: () => ({ userData: { uid: 'user-1' } }),
}));
vi.mock('../../utils/apiClient', () => ({
  apiPost: vi.fn(),
}));
vi.mock('./quizModelService', () => ({
  loadQuizModel: vi.fn(),
  saveQuizModel: vi.fn(),
}));
vi.mock('./quizResultAnalysis', () => ({
  getWordNameForQuestion: () => 'word',
  buildResultAnalysis: () => ({ analysis: 'analysis', suggestion: 'suggestion' }),
}));

// 五個真正的題型元件牽涉太多細節，換成一個簡化版：按下按鈕就回報固定的
// 作答結果並直接 onConfirm，讓測試能推進到下一題／結束測驗。
vi.mock('../_quiz_questions/sentenceFill', () => ({
  default: ({ onSelect, onConfirm }) => (
    <button
      type="button"
      onClick={() => {
        onSelect({ result: true, question: 'q', answer: 'a', userAnswer: 'a', correctAnswer: 'a' });
        onConfirm();
      }}
    >
      作答
    </button>
  ),
}));
vi.mock('../_quiz_questions/sentenceSpeak', () => ({ default: () => null }));
vi.mock('../_quiz_questions/sentenceOrder', () => ({ default: () => null }));
vi.mock('../_quiz_questions/wordMatch', () => ({ default: () => null }));
vi.mock('../_quiz_questions/wordTranslation', () => ({ default: () => null }));

function generateResponse(questions) {
  return { questions };
}

describe('RecommendedQuizQuestion（FR-4b）', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    apiPost.mockReset();
    loadQuizModel.mockReset();
    saveQuizModel.mockReset();
    loadQuizModel.mockResolvedValue({});
    saveQuizModel.mockResolvedValue();
  });

  test('題目的 canonical id/type 不會被 payload 裡同名欄位覆蓋（回歸測試：原本 spread 順序反了）', async () => {
    apiPost.mockResolvedValueOnce(generateResponse([
      { id: 'real-id', type: 'sentence-fill', payload: { id: 'fake-id-from-payload', type: 'wrong-type' }, difficulty: 1, meta: {} },
    ]));

    render(<RecommendedQuizQuestion tribe="tayal" />);

    // type 沒有被 payload 的 "wrong-type" 蓋掉，才會正確渲染出 sentence-fill
    // 的假元件（按鈕文字「作答」），而不是掉進「未知題型」的離開畫面。
    expect(await screen.findByRole('button', { name: '作答' })).toBeInTheDocument();
  });

  test('未知題型時顯示明確的離開畫面，而不是讓「下一題」永遠 disabled 卡住', async () => {
    apiPost.mockResolvedValueOnce(generateResponse([
      { id: 'q1', type: 'not-a-real-type', payload: {}, difficulty: 1, meta: {} },
    ]));

    render(<RecommendedQuizQuestion tribe="tayal" />);

    expect(await screen.findByText('這一題的題型暫時無法顯示，請返回測驗選單重新開始。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '返回測驗選單' }));
    expect(mockNavigate).toHaveBeenCalledWith('..');
  });

  test('切換族語會重設上一份測驗的作答進度（回歸測試：原本沒有重設 current/userAnswers）', async () => {
    apiPost.mockResolvedValueOnce(generateResponse([
      { id: 'q1', type: 'sentence-fill', payload: {}, difficulty: 1, meta: {} },
      { id: 'q2', type: 'sentence-fill', payload: {}, difficulty: 1, meta: {} },
    ]));

    const { rerender } = render(<RecommendedQuizQuestion tribe="tayal" />);
    await screen.findByRole('button', { name: '作答' });

    fireEvent.click(screen.getByRole('button', { name: '作答' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '下一題' }));
    });
    await waitFor(() => expect(screen.getByText('第 2 / 2 題')).toBeInTheDocument());

    // 切換族語：重新觸發載入，新測驗應該從第 1 題重新開始，不是沿用剛剛的 current=1
    apiPost.mockResolvedValueOnce(generateResponse([
      { id: 'q1', type: 'sentence-fill', payload: {}, difficulty: 1, meta: {} },
    ]));
    rerender(<RecommendedQuizQuestion tribe="amis" />);

    await waitFor(() => expect(screen.getByText('第 1 / 1 題')).toBeInTheDocument());
  });

  test('快速連點「作答」按鈕（isAdvancing）不會讓同一題被送出兩次', async () => {
    apiPost.mockResolvedValueOnce(generateResponse([
      { id: 'q1', type: 'sentence-fill', payload: {}, difficulty: 1, meta: {} },
      { id: 'q2', type: 'sentence-fill', payload: {}, difficulty: 1, meta: {} },
    ]));
    let resolveSubmit;
    apiPost.mockImplementationOnce(() => new Promise((resolve) => { resolveSubmit = resolve; }));

    render(<RecommendedQuizQuestion tribe="tayal" />);
    await screen.findByRole('button', { name: '作答' });

    fireEvent.click(screen.getByRole('button', { name: '作答' }));
    const nextButton = screen.getByRole('button', { name: '下一題' });

    // 送出中按鈕應該被 disable，第二次點擊不會再觸發一次提交
    fireEvent.click(nextButton);
    fireEvent.click(nextButton);
    expect(apiPost).toHaveBeenCalledTimes(2); // 產生題目 1 次 + 提交答案 1 次

    await act(async () => {
      resolveSubmit({ user_model: {} });
    });
  });

  test('提交答案失敗時顯示警告，但仍會前進到下一題', async () => {
    apiPost.mockResolvedValueOnce(generateResponse([
      { id: 'q1', type: 'sentence-fill', payload: {}, difficulty: 1, meta: {} },
      { id: 'q2', type: 'sentence-fill', payload: {}, difficulty: 1, meta: {} },
    ]));
    apiPost.mockRejectedValueOnce(new Error('network down'));

    render(<RecommendedQuizQuestion tribe="tayal" />);
    await screen.findByRole('button', { name: '作答' });

    fireEvent.click(screen.getByRole('button', { name: '作答' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '下一題' }));
    });

    expect(await screen.findByRole('alert')).toHaveTextContent('這次的作答結果可能沒有真的存進學習模型');
    expect(screen.getByText('第 2 / 2 題')).toBeInTheDocument();
  });
});
