import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import QuizChoice from './QuizChoice';
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

const choiceItem = {
  id: 21,
  tribe: 'amis',
  question_ab: 'O maan ko niyam?',
  question_ch: '哪一張圖片是正確的？',
  image_a_url: 'https://res.cloudinary.com/demo/image/upload/a.jpg',
  image_b_url: 'https://res.cloudinary.com/demo/image/upload/b.jpg',
  image_c_url: 'https://res.cloudinary.com/demo/image/upload/c.jpg',
  answer: 2,
  status: 'pending_review',
  created_by: 'editor-uid',
};

describe('QuizChoice', () => {
  beforeEach(() => {
    mockRole = 'owner';

    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
    apiDelete.mockReset();

    apiGet.mockResolvedValue({
      results: [choiceItem],
      count: 1,
      page: 1,
      page_size: 20,
    });

    globalThis.fetch = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  test('載入後顯示中級選擇題列表與 A/B/C 正解', async () => {
    render(<QuizChoice />);

    const question = await screen.findByText('O maan ko niyam?');
    const row = question.closest('tr');

    expect(row).not.toBeNull();
    expect(within(row).getByText('阿美語')).toBeInTheDocument();
    expect(within(row).getByText('B')).toBeInTheDocument();
  });

  test('reviewer 看得到核准與退件按鈕', async () => {
    mockRole = 'reviewer';
    render(<QuizChoice />);

    const row = (await screen.findByText('O maan ko niyam?')).closest('tr');

    expect(
      within(row).getByRole('button', { name: /核准/ }),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole('button', { name: /退件/ }),
    ).toBeInTheDocument();
  });

  test('analyst 看不到任何操作按鈕', async () => {
    mockRole = 'analyst';
    render(<QuizChoice />);

    const row = (await screen.findByText('O maan ko niyam?')).closest('tr');

    expect(within(row).queryAllByRole('button')).toHaveLength(0);
    expect(
      screen.queryByRole('button', { name: /新增中級選擇題/ }),
    ).not.toBeInTheDocument();
  });

  test('新增時三張圖片皆為必填，上傳完成後送出正確 payload', async () => {
    mockRole = 'editor';
    apiPost.mockResolvedValueOnce({});

    globalThis.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          secure_url:
            'https://res.cloudinary.com/demo/image/upload/new-a.jpg',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          secure_url:
            'https://res.cloudinary.com/demo/image/upload/new-b.jpg',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          secure_url:
            'https://res.cloudinary.com/demo/image/upload/new-c.jpg',
        }),
      });

    render(<QuizChoice />);
    await screen.findByText('O maan ko niyam?');

    fireEvent.click(
      screen.getByRole('button', { name: /新增中級選擇題/ }),
    );

    const modal = await screen.findByRole('dialog');
    const saveButton = within(modal).getByRole('button', {
      name: '儲存',
    });

    expect(saveButton).toBeDisabled();

    fireEvent.change(within(modal).getByLabelText(/族語句子/), {
      target: { value: 'Fangcal ko roma.' },
    });
    fireEvent.change(within(modal).getByLabelText(/中文句意/), {
      target: { value: '選出正確的圖片。' },
    });

    for (const label of ['A', 'B', 'C']) {
      const input = within(modal).getByLabelText(
        new RegExp(`圖片 ${label}`),
      );

      fireEvent.change(input, {
        target: {
          files: [
            new File([`image-${label}`], `${label}.jpg`, {
              type: 'image/jpeg',
            }),
          ],
        },
      });

      await waitFor(() => {
        expect(globalThis.fetch).toHaveBeenCalledTimes(
          label === 'A' ? 1 : label === 'B' ? 2 : 3,
        );
      });
    }

    await waitFor(() => {
      expect(saveButton).not.toBeDisabled();
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/image/upload/f_auto,q_auto'),
      expect.objectContaining({ method: 'POST' }),
    );

    fireEvent.click(
      within(modal).getByRole('radio', {
        name: /選項 C（設為正解）/,
      }),
    );
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/choice/',
        {
          tribe: 'tayal',
          question_ab: 'Fangcal ko roma.',
          question_ch: '選出正確的圖片。',
          image_a_url:
            'https://res.cloudinary.com/demo/image/upload/new-a.jpg',
          image_b_url:
            'https://res.cloudinary.com/demo/image/upload/new-b.jpg',
          image_c_url:
            'https://res.cloudinary.com/demo/image/upload/new-c.jpg',
          answer: 3,
        },
      );
    });
  });

  test('刪除前跳出原生確認框', async () => {
    apiGet.mockResolvedValue({
      results: [{ ...choiceItem, status: 'draft' }],
      count: 1,
      page: 1,
      page_size: 20,
    });
    apiDelete.mockResolvedValueOnce({});

    render(<QuizChoice />);

    const row = (await screen.findByText('O maan ko niyam?')).closest('tr');
    fireEvent.click(
      within(row).getByRole('button', { name: /刪除/ }),
    );

    expect(window.confirm).toHaveBeenCalledWith(
      '確定要刪除這則中級選擇題嗎？',
    );

    await waitFor(() => {
      expect(apiDelete).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/choice/21/',
      );
    });
  });
});
