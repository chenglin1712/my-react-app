import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import Panel from './quiz_panel';
import { useQuizPanelData } from './useQuizPanelData';
import { uploadSituationDB } from '../../src/userServives/uploadDb';
import { trackEvent } from '../../utils/apiClient';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useParams: () => ({ level: '1' }),
  useNavigate: () => mockNavigate,
}));

vi.mock('./useQuizPanelData', () => ({
  useQuizPanelData: vi.fn(),
}));
vi.mock('../../src/userServives/uploadDb', () => ({
  uploadSituationDB: vi.fn(),
}));
vi.mock('../../utils/apiClient', () => ({
  trackEvent: vi.fn(),
}));
vi.mock('lottie-web', () => ({
  default: { loadAnimation: vi.fn(() => ({ destroy: vi.fn() })) },
}));

const QUESTION = { question_ab: 'Q1', image: 'img.png', answer: 1 };

function baseHookState(overrides = {}) {
  return {
    data: { parts: [{ type: 'true_false', title: '初級', intro: '說明', questions: [QUESTION] }] },
    dataLen: 1,
    isLoading: false,
    quizInfo: { id: 'quiz-1', ans: [1] },
    savedQuestions: [{ ...QUESTION }],
    uploadFailed: false,
    userAnswers: [null],
    userStars: ['F'],
    currentQuestionIndex: 0,
    setCurrentQuestionIndex: vi.fn(),
    handleStar: vi.fn(),
    handleAnswer: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  };
}

describe('Panel + AnswerBox 提交流程整合（FR-4a：兩顆繳交按鈕必須走同一條路）', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    uploadSituationDB.mockReset();
    trackEvent.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    sessionStorage.clear();
  });

  test('點主畫面的「繳交試卷」會存 situation、寫 sessionStorage 並帶 situationID 導頁', async () => {
    useQuizPanelData.mockReturnValue(baseHookState({ userAnswers: [1] }));
    uploadSituationDB.mockResolvedValueOnce('situation-1');

    render(<Panel tribe="tayal" />);
    const submitButtons = screen.getAllByRole('button', { name: '繳交試卷' });
    expect(submitButtons).toHaveLength(2); // 主畫面 + AnswerBox 側邊欄

    await act(async () => {
      fireEvent.click(submitButtons[0]);
    });

    expect(uploadSituationDB).toHaveBeenCalledWith('quiz-1', [1], [1], ['F']);
    expect(mockNavigate).toHaveBeenCalledWith('/quiz/1/submit', {
      state: { situationID: 'situation-1', fallback: expect.objectContaining({ tribe: 'tayal' }) },
    });
    expect(JSON.parse(sessionStorage.getItem('quizFallback')).tribe).toBe('tayal');
  });

  test('點側邊欄 AnswerBox 的「繳交試卷」跟主畫面走完全一樣的存檔流程（回歸測試：原本側邊欄會整個繞過存檔，直接 navigate）', async () => {
    useQuizPanelData.mockReturnValue(baseHookState({ userAnswers: [1] }));
    uploadSituationDB.mockResolvedValueOnce('situation-2');

    render(<Panel tribe="tayal" />);
    const submitButtons = screen.getAllByRole('button', { name: '繳交試卷' });

    await act(async () => {
      fireEvent.click(submitButtons[1]);
    });

    expect(uploadSituationDB).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/quiz/1/submit', {
      state: { situationID: 'situation-2', fallback: expect.anything() },
    });
  });

  test('作答未完成時兩顆按鈕都會先跳確認框，取消就不會存檔也不會導頁', async () => {
    useQuizPanelData.mockReturnValue(baseHookState({ userAnswers: [null] }));
    window.confirm.mockReturnValueOnce(false);

    render(<Panel tribe="tayal" />);
    const submitButtons = screen.getAllByRole('button', { name: '繳交試卷' });

    await act(async () => {
      fireEvent.click(submitButtons[1]);
    });

    expect(window.confirm).toHaveBeenCalled();
    expect(uploadSituationDB).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  test('uploadSituationDB 失敗時仍會用 fallback 導頁，但會顯示錯誤提示（回歸測試：原本靜默失敗，使用者以為分數存好了）', async () => {
    useQuizPanelData.mockReturnValue(baseHookState({ userAnswers: [1] }));
    uploadSituationDB.mockResolvedValueOnce(undefined);

    render(<Panel tribe="tayal" />);
    const submitButtons = screen.getAllByRole('button', { name: '繳交試卷' });

    await act(async () => {
      fireEvent.click(submitButtons[0]);
    });

    expect(screen.getByRole('alert')).toHaveTextContent('作答結果儲存失敗');
    expect(mockNavigate).toHaveBeenCalledWith('/quiz/1/submit', {
      state: { situationID: undefined, fallback: expect.anything() },
    });
  });

  test('AnswerBox 的題號在尚未作答時不會顯示成已作答（回歸測試：原本用 !== undefined 判斷，null 也會被當成已作答）', () => {
    useQuizPanelData.mockReturnValue(baseHookState({ userAnswers: [null] }));
    render(<Panel tribe="tayal" />);

    const questionButton = screen.getByRole('button', { name: '1' });
    expect(questionButton).not.toHaveClass('answer');
  });

  test('已作答的題目會顯示成已作答', () => {
    useQuizPanelData.mockReturnValue(baseHookState({ userAnswers: [1] }));
    render(<Panel tribe="tayal" />);

    const questionButton = screen.getByRole('button', { name: '1' });
    expect(questionButton).toHaveClass('answer');
  });
});
