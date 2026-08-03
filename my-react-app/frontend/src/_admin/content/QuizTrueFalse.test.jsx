import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import QuizTrueFalse from './QuizTrueFalse';
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
} from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPatch: vi.fn(),
  apiDelete: vi.fn(),
}));

let mockRole = 'owner';

vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({
    userData: { role: mockRole },
    loading: false,
  }),
}));

const trueFalseItem = {
  id: 11,
  tribe: 'tayal',
  question_ab: "Musa' su inu?",
  question_ch: '你要去哪裡？',
  audio_url: 'https://res.cloudinary.com/demo/video/upload/question.mp3',
  image_url: 'https://res.cloudinary.com/demo/image/upload/question.jpg',
  answer: 1,
  status: 'pending_review',
  created_by: 'editor-uid',
};

describe('QuizTrueFalse', () => {
  beforeEach(() => {
    mockRole = 'owner';

    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
    apiDelete.mockReset();

    apiGet.mockResolvedValue({
      results: [trueFalseItem],
      count: 1,
      page: 1,
      page_size: 20,
    });

    globalThis.fetch = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  test('載入後顯示初級是非題列表與文字化正解', async () => {
    render(<QuizTrueFalse />);

    const question = await screen.findByText("Musa' su inu?");
    const row = question.closest('tr');

    expect(row).not.toBeNull();
    expect(within(row).getByText('O 符合')).toBeInTheDocument();
    expect(within(row).getByText('泰雅語')).toBeInTheDocument();
  });

  test('reviewer 看得到核准與退件按鈕', async () => {
    mockRole = 'reviewer';
    render(<QuizTrueFalse />);

    const row = (await screen.findByText("Musa' su inu?")).closest('tr');

    expect(
      within(row).getByRole('button', { name: /核准/ }),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole('button', { name: /退件/ }),
    ).toBeInTheDocument();
  });

  test('analyst 看不到任何操作按鈕', async () => {
    mockRole = 'analyst';
    render(<QuizTrueFalse />);

    const row = (await screen.findByText("Musa' su inu?")).closest('tr');

    expect(within(row).queryAllByRole('button')).toHaveLength(0);
    expect(
      screen.queryByRole('button', { name: /新增初級是非題/ }),
    ).not.toBeInTheDocument();
  });

  test('新增時必填欄位未完成不能儲存，上傳後送出正確 payload', async () => {
    mockRole = 'editor';
    apiPost.mockResolvedValueOnce({});

    globalThis.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          secure_url:
            'https://res.cloudinary.com/demo/video/upload/new-question.mp3',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          secure_url:
            'https://res.cloudinary.com/demo/image/upload/new-question.jpg',
        }),
      });

    render(<QuizTrueFalse />);
    await screen.findByText("Musa' su inu?");

    fireEvent.click(
      screen.getByRole('button', { name: /新增初級是非題/ }),
    );

    const modal = await screen.findByRole('dialog');
    const saveButton = within(modal).getByRole('button', {
      name: '儲存',
    });

    expect(saveButton).toBeDisabled();

    fireEvent.change(within(modal).getByLabelText(/族語句子/), {
      target: { value: "Ima' lalu su?" },
    });
    fireEvent.change(within(modal).getByLabelText(/中文句意/), {
      target: { value: '你叫什麼名字？' },
    });

    fireEvent.change(within(modal).getByLabelText(/音檔/), {
      target: {
        files: [new File(['audio'], 'question.mp3', { type: 'audio/mpeg' })],
      },
    });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/video/upload'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    fireEvent.change(within(modal).getByLabelText(/圖片/), {
      target: {
        files: [new File(['image'], 'question.jpg', { type: 'image/jpeg' })],
      },
    });

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/image/upload/f_auto,q_auto'),
        expect.objectContaining({ method: 'POST' }),
      );
      expect(saveButton).not.toBeDisabled();
    });

    fireEvent.click(
      within(modal).getByRole('radio', { name: /X 不符合/ }),
    );
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/true-false/',
        {
          tribe: 'tayal',
          question_ab: "Ima' lalu su?",
          question_ch: '你叫什麼名字？',
          audio_url:
            'https://res.cloudinary.com/demo/video/upload/new-question.mp3',
          image_url:
            'https://res.cloudinary.com/demo/image/upload/new-question.jpg',
          answer: 2,
        },
      );
    });
  });

  test('刪除前跳出原生確認框', async () => {
    apiGet.mockResolvedValue({
      results: [{ ...trueFalseItem, status: 'draft' }],
      count: 1,
      page: 1,
      page_size: 20,
    });
    apiDelete.mockResolvedValueOnce({});

    render(<QuizTrueFalse />);

    const row = (await screen.findByText("Musa' su inu?")).closest('tr');
    fireEvent.click(
      within(row).getByRole('button', { name: /刪除/ }),
    );

    expect(window.confirm).toHaveBeenCalledWith(
      '確定要刪除這則初級是非題嗎？',
    );

    await waitFor(() => {
      expect(apiDelete).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/true-false/11/',
      );
    });
  });
});
