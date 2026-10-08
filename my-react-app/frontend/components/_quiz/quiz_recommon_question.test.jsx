import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import RecommendedQuizQuestion from './quiz_recommon_question';
import { apiPost } from '../../utils/apiClient';
import { loadQuizModel, saveQuizModel } from './quizModelService';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));
let mockAuth = { userData: { uid: 'user-1' }, loading: false };
vi.mock('../../src/userServives/authContext', () => ({
  useAuth: () => mockAuth,
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
// 單字翻譯：用來驗證「不是句子填空的題型不會送出診斷用的欄位」
vi.mock('../_quiz_questions/wordTranslation', () => ({
  default: ({ onSelect, onConfirm }) => (
    <button
      type="button"
      onClick={() => {
        onSelect({ result: true, question: 'q', answer: 'a', userAnswer: 'x', correctAnswer: 'a' });
        onConfirm();
      }}
    >
      翻譯作答
    </button>
  ),
}));

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

  describe('詞素診斷（句子填空）', () => {
    async function answerOnly(question, submitResponse) {
      apiPost.mockResolvedValueOnce(generateResponse([question]));
      apiPost.mockResolvedValueOnce(submitResponse);
      render(<RecommendedQuizQuestion tribe="amis" />);
      fireEvent.click(await screen.findByRole('button', { name: '作答' }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '結束測驗' }));
      });
    }

    const submitAnswerPayload = () => apiPost.mock.calls[1][1].answer;

    test('句子填空會把所選選項與出題時的 token 一起送出', async () => {
      await answerOnly(
        { id: 'sf-1', type: 'sentence-fill', payload: { questionToken: 'signed-token' }, difficulty: 1, meta: {} },
        { user_model: {} },
      );
      expect(submitAnswerPayload()).toMatchObject({ question_id: 'sf-1', question_type: 'sentence-fill', selected_option: 'a', question_token: 'signed-token' });
    });

    test('題目沒有 token（功能沒開）時仍送出所選選項，token 省略', async () => {
      await answerOnly({ id: 'sf-1', type: 'sentence-fill', payload: {}, difficulty: 1, meta: {} }, { user_model: {} });
      expect(submitAnswerPayload().selected_option).toBe('a');
      expect(submitAnswerPayload().question_token).toBeUndefined();
    });

    test('測驗結束時，結果頁會拿到每題的診斷與族語', async () => {
      const diagnosis = { status: 'classified', errorType: 'wrong_affix', targetRule: 'v1|amis|P|ma||0', selectedRule: 'v1|amis|P|pa||0' };
      await answerOnly(
        { id: 'sf-1', type: 'sentence-fill', payload: { questionToken: 't' }, difficulty: 1, meta: {} },
        { user_model: {}, diagnosis, rule_update: { rule: 'v1|amis|P|ma||0', before: 0.35, after: 0.3, n: 1 } },
      );
      await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
      const state = mockNavigate.mock.calls[0][1].state;
      expect(state.tribe).toBe('amis');
      expect(state.ruleFeedback).toEqual([{ id: 'sf-1', diagnosis, ruleUpdate: { rule: 'v1|amis|P|ma||0', before: 0.35, after: 0.3, n: 1 } }]);
    });

    test('後端沒有回診斷（功能關閉）時，結果頁的診斷清單是空的', async () => {
      await answerOnly({ id: 'sf-1', type: 'sentence-fill', payload: {}, difficulty: 1, meta: {} }, { user_model: {}, diagnosis: null, rule_update: null });
      await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
      expect(mockNavigate.mock.calls[0][1].state.ruleFeedback).toEqual([]);
    });

    test('不是句子填空的題型不會送出所選選項與 token', async () => {
      apiPost.mockResolvedValueOnce(generateResponse([
        { id: 'wt-1', type: 'word-translate', payload: { questionToken: 'should-not-be-sent' }, difficulty: 1, meta: {} },
      ]));
      apiPost.mockResolvedValueOnce({ user_model: {} });
      render(<RecommendedQuizQuestion tribe="amis" />);
      fireEvent.click(await screen.findByRole('button', { name: '翻譯作答' }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '結束測驗' }));
      });
      const answer = apiPost.mock.calls[1][1].answer;
      expect(answer.question_type).toBe('word-translate');
      expect(answer).not.toHaveProperty('selected_option');
      expect(answer.question_token).toBeUndefined();
    });

    test('切換族語重新開始測驗時，上一份測驗的診斷不會帶進新測驗的結果', async () => {
      const diagnosis = { status: 'classified', errorType: 'wrong_affix', targetRule: 'v1|amis|P|ma||0', selectedRule: 'v1|amis|P|pa||0' };
      apiPost.mockResolvedValueOnce(generateResponse([
        { id: 'old-1', type: 'sentence-fill', payload: {}, difficulty: 1, meta: {} },
        { id: 'old-2', type: 'sentence-fill', payload: {}, difficulty: 1, meta: {} },
      ]));
      apiPost.mockResolvedValueOnce({ user_model: {}, diagnosis, rule_update: null });
      const { rerender } = render(<RecommendedQuizQuestion tribe="amis" />);
      fireEvent.click(await screen.findByRole('button', { name: '作答' }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '下一題' }));
      });
      await waitFor(() => expect(screen.getByText('第 2 / 2 題')).toBeInTheDocument());

      apiPost.mockResolvedValueOnce(generateResponse([{ id: 'new-1', type: 'sentence-fill', payload: {}, difficulty: 1, meta: {} }]));
      apiPost.mockResolvedValueOnce({ user_model: {}, diagnosis: null, rule_update: null });
      rerender(<RecommendedQuizQuestion tribe="kavalan" />);
      await waitFor(() => expect(screen.getByText('第 1 / 1 題')).toBeInTheDocument());
      fireEvent.click(screen.getByRole('button', { name: '作答' }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '結束測驗' }));
      });
      await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
      expect(mockNavigate.mock.calls[0][1].state.ruleFeedback).toEqual([]);
    });

    test('提交失敗時不會留下診斷，測驗照常結束', async () => {
      apiPost.mockResolvedValueOnce(generateResponse([{ id: 'sf-1', type: 'sentence-fill', payload: {}, difficulty: 1, meta: {} }]));
      apiPost.mockRejectedValueOnce(new Error('down'));
      render(<RecommendedQuizQuestion tribe="amis" />);
      fireEvent.click(await screen.findByRole('button', { name: '作答' }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '結束測驗' }));
      });
      await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
      expect(mockNavigate.mock.calls[0][1].state.ruleFeedback).toEqual([]);
    });
  });
});

describe('RecommendedQuizQuestion 的登入狀態', () => {
  beforeEach(() => {
    apiPost.mockReset();
    loadQuizModel.mockReset();
  });
  afterEach(() => { mockAuth = { userData: { uid: 'user-1' }, loading: false }; });

  test('登入狀態確認完仍沒有使用者：顯示請先登入，不會永遠停在載入中，也不會呼叫出題', async () => {
    mockAuth = { userData: null, loading: false };
    render(<RecommendedQuizQuestion tribe="amis" />);

    expect(await screen.findByText('請先登入後再開始測驗。')).toBeInTheDocument();
    expect(screen.queryByText(/題目載入中/)).not.toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });

  test('登入狀態從確認中變成已登入：只出題一次，過程中不會出現「請先登入」', async () => {
    loadQuizModel.mockResolvedValue({});
    apiPost.mockResolvedValue({ questions: [] });
    mockAuth = { userData: null, loading: true };
    const { rerender } = render(<RecommendedQuizQuestion tribe="amis" />);
    expect(screen.queryByText('請先登入後再開始測驗。')).not.toBeInTheDocument();

    mockAuth = { userData: { uid: 'user-1' }, loading: false };
    rerender(<RecommendedQuizQuestion tribe="amis" />);

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(loadQuizModel).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('請先登入後再開始測驗。')).not.toBeInTheDocument();
  });

  test('登入狀態還在確認時維持載入中，不誤報未登入', () => {
    mockAuth = { userData: null, loading: true };
    render(<RecommendedQuizQuestion tribe="amis" />);

    expect(screen.getByText(/題目載入中/)).toBeInTheDocument();
    expect(screen.queryByText('請先登入後再開始測驗。')).not.toBeInTheDocument();
    expect(apiPost).not.toHaveBeenCalled();
  });
});
