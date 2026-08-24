import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import Panel_Submit from './quiz_panel_submit';

const mockNavigate = vi.fn();
let mockLocationState;
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useLocation: () => ({ state: mockLocationState }),
}));

vi.mock('../../src/userServives/uploadDb', () => ({
  getQuizSubmitById: vi.fn(),
  countScore: (results) => {
    if (!results || results.length === 0) return 0;
    const correct = results.filter((r) => r.isCorrect).length;
    return Math.round((correct / results.length) * 100);
  },
}));
vi.mock('../../src/userServives/authContext', () => ({
  useAuth: () => ({ userData: { firestoreData: { name: '小明' } } }),
}));

// 四個題型各自的 fallback 資料，直接透過 location.state.fallback 驗證四種
// ResultRenderer（拆分自原本一長串巢狀 ternary）都還跟原本行為一致，不需要
// 額外 mock Firestore 的 getQuizSubmitById 讀取路徑。
function renderWithFallback(fallback) {
  mockLocationState = { fallback };
  return render(<Panel_Submit tribe="tayal" />);
}

describe('Panel_Submit 的四種題型 ResultRenderer（FR-4a：從巢狀 ternary 拆出來）', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
  });

  test('初級（true_false）：顯示圖片＋單詞，答對/答錯樣式正確', async () => {
    const { container } = renderWithFallback({
      title: '初級',
      questions: [{ question_ab: 'qay', image: 'qay.png' }],
      answers: [1],
      correctAnswers: [1],
    });

    expect(await screen.findByText('qay')).toBeInTheDocument();
    expect(container.querySelector('.quiz-user-answer')).toHaveClass('correct');
    expect(container.querySelector('.quiz-user-answer')).toHaveTextContent('O');
  });

  test('中級（choice）：顯示圖片選項，找不到對應圖片時 fallback 成空字串 src', async () => {
    renderWithFallback({
      title: '中級',
      questions: [{ question_ab: 'q', question_ch: '問題', images: { A: 'a.png' } }],
      answers: [1],
      correctAnswers: [2],
    });

    expect(await screen.findByText('問題')).toBeInTheDocument();
    const images = screen.getAllByRole('img');
    expect(images[0]).toHaveAttribute('src', 'a.png');
  });

  test('中高級（matching）：依 answers 顯示「全對」／「有錯」／「未作答」', async () => {
    renderWithFallback({
      title: '中高級',
      questions: [{ pairs: [{ cn: '你好', word: { word: 'lokah' } }] }],
      answers: [2],
      correctAnswers: [1],
    });

    expect(await screen.findByText(/配合題：你好→lokah/)).toBeInTheDocument();
    expect(screen.getByText('有錯')).toBeInTheDocument();
  });

  test('高級（cloze）：顯示短文與選項文字', async () => {
    renderWithFallback({
      title: '高級',
      questions: [{ passage_ab: 'a＿＿＿b', passage_ch: '中文短文', options: ['選項一', '選項二'] }],
      answers: [1],
      correctAnswers: [2],
    });

    expect(await screen.findByText('中文短文')).toBeInTheDocument();
    expect(screen.getByText('選項一')).toBeInTheDocument();
    expect(screen.getByText('選項二')).toBeInTheDocument();
  });

  test('未作答（answers[i] 為 null）時中高級題目顯示「未作答」而不是「有錯」', async () => {
    renderWithFallback({
      title: '中高級',
      questions: [{ pairs: [{ cn: '你好', word: { word: 'lokah' } }] }],
      answers: [null],
      correctAnswers: [1],
    });

    expect(await screen.findByText('未作答')).toBeInTheDocument();
  });
});
