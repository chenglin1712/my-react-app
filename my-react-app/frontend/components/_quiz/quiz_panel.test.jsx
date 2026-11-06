import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import Panel from './quiz_panel';
import { useQuizPanelData } from './useQuizPanelData';
import { uploadSituationDB } from '../../src/userServives/uploadDb';
import { trackEvent } from '../../utils/apiClient';

// 站內確認視窗（原本是瀏覽器原生 window.confirm）：測試直接替換成可控制回傳值的 mock
const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock('@components/ui/ConfirmDialog', () => ({ confirmAction: confirmMock }));

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
    confirmMock.mockResolvedValue(true);
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
    confirmMock.mockResolvedValueOnce(false);

    render(<Panel tribe="tayal" />);
    const submitButtons = screen.getAllByRole('button', { name: '繳交試卷' });

    await act(async () => {
      fireEvent.click(submitButtons[1]);
    });

    expect(confirmMock).toHaveBeenCalled();
    // 確認內容要說出還有幾題沒答（P2-56）
    const { message } = confirmMock.mock.calls[0][0];
    const { container } = render(message);
    expect(container.textContent).toContain('還有 1 題尚未作答');
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
      state: { situationID: undefined, fallback: expect.objectContaining({ saveFailed: true }) },
    });
  });

  test('AnswerBox 的題號在尚未作答時不會顯示成已作答（回歸測試：原本用 !== undefined 判斷，null 也會被當成已作答）', () => {
    useQuizPanelData.mockReturnValue(baseHookState({ userAnswers: [null] }));
    render(<Panel tribe="tayal" />);

    const questionButton = screen.getByRole('button', { name: /^第 1 題，未作答/ });
    expect(questionButton).not.toHaveClass('answer');
    expect(questionButton.querySelector('.answered-mark')).toBeNull();
  });

  test('已作答的題目會顯示成已作答', () => {
    useQuizPanelData.mockReturnValue(baseHookState({ userAnswers: [1] }));
    render(<Panel tribe="tayal" />);

    const questionButton = screen.getByRole('button', { name: /^第 1 題，已作答/ });
    expect(questionButton).toHaveClass('answer');
    // 已作答不只靠綠底：有勾勾形狀（審查項 P1-7）
    expect(questionButton.querySelector('.answered-mark')).not.toBeNull();
  });

  test('標星是 button：有名稱、aria-pressed 反映狀態，點擊會呼叫 handleStar 並念出結果（審查項 P1-3）', () => {
    const handleStar = vi.fn();
    useQuizPanelData.mockReturnValue(baseHookState({ userStars: ['F'], handleStar }));
    render(<Panel tribe="tayal" />);

    const star = screen.getByRole('button', { name: '標記待複習' });
    expect(star).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(star);
    expect(handleStar).toHaveBeenCalledTimes(1);
  });

  test('已標星的題目 aria-pressed 為 true，題號面板的名稱也說明已標記', () => {
    useQuizPanelData.mockReturnValue(baseHookState({ userStars: ['T'], userAnswers: [1] }));
    render(<Panel tribe="tayal" />);

    expect(screen.getByRole('button', { name: '標記待複習' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /^第 1 題，已作答，已標記待複習/ })).toBeInTheDocument();
  });
});

describe('Panel 作答頁細節（E-6，P2-59）', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    confirmMock.mockResolvedValue(true);
  });

  test('說明按鈕有 aria-expanded，點一下開、再點關，Esc 也能關閉', () => {
    useQuizPanelData.mockReturnValue(baseHookState());
    render(<Panel tribe="tayal" />);
    const button = screen.getByRole('button', { name: '說明' });
    expect(button).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('說明', { selector: 'p' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  test('載入中有 role=status', () => {
    useQuizPanelData.mockReturnValue(baseHookState({ isLoading: true }));
    render(<Panel tribe="tayal" />);
    expect(screen.getByRole('status')).toHaveTextContent('題目載入中');
  });

  test('是非題音檔改用自製的播放鈕，不再是原生 audio controls', () => {
    const hook = baseHookState();
    hook.data.parts[0].questions = [{ ...QUESTION, audio: 'a.mp3' }];
    useQuizPanelData.mockReturnValue(hook);
    const { container } = render(<Panel tribe="tayal" />);
    expect(screen.getByRole('button', { name: '播放題目音檔' })).toBeInTheDocument();
    expect(container.querySelector('audio')).toBeNull();
  });
});

describe('Panel 的作答專注模式（Apple 化步驟 4-6a）', () => {
  test('作答畫面掛載時 <html> 帶 data-quiz-focus，卸載（離開作答）後一定移除', () => {
    useQuizPanelData.mockReturnValue(baseHookState());
    const { unmount } = render(<Panel tribe="tayal" />);
    expect(document.documentElement).toHaveAttribute('data-quiz-focus', 'true');
    unmount();
    expect(document.documentElement).not.toHaveAttribute('data-quiz-focus');
  });

  test('專注模式下仍有離開測驗的出口與題目導覽', () => {
    useQuizPanelData.mockReturnValue(baseHookState());
    render(<Panel tribe="tayal" />);
    expect(screen.getByRole('button', { name: '離開測驗' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一題' })).toBeInTheDocument();
  });
});

describe('Panel 專注模式只在題目可作答時啟用（審查補強：載入與錯誤畫面沒有離開鈕，導覽必須留著）', () => {
  test.each([
    ['載入中', { isLoading: true }],
    ['題目資料無效', { data: { parts: [{ questions: [] }] } }],
    ['測驗建立失敗', { uploadFailed: true }],
  ])('%s：不掛 data-quiz-focus', (_name, overrides) => {
    useQuizPanelData.mockReturnValue(baseHookState(overrides));
    render(<Panel tribe="tayal" />);
    expect(document.documentElement).not.toHaveAttribute('data-quiz-focus');
  });

  test('進入作答時焦點移到測驗標題（導覽收起後不讓焦點掉到 body）', () => {
    useQuizPanelData.mockReturnValue(baseHookState());
    render(<Panel tribe="tayal" />);
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: /.*/ }));
  });
});
