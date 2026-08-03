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
  image_a_url:
    'https://res.cloudinary.com/demo/image/upload/a.jpg',
  image_b_url:
    'https://res.cloudinary.com/demo/image/upload/b.jpg',
  image_c_url:
    'https://res.cloudinary.com/demo/image/upload/c.jpg',
  answer: 2,
  status: 'pending_review',
  has_pending_revision: false,
  created_by: 'editor-uid',
};

function mockApiGet({
  results = [choiceItem],
  revision,
  missingRevision = false,
} = {}) {
  apiGet.mockImplementation((url) => {
    if (
      url
      === '/adminapi/quiz-bank/choice/21/pending-revision/'
    ) {
      if (missingRevision) {
        return Promise.reject(
          Object.assign(
            new Error('目前沒有待審核的修改'),
            { status: 404 },
          ),
        );
      }

      if (revision) return Promise.resolve(revision);
      return Promise.reject(new Error(`unexpected url: ${url}`));
    }

    if (url.startsWith('/adminapi/quiz-bank/choice/?')) {
      return Promise.resolve({
        results,
        count: results.length,
        page: 1,
        page_size: 20,
      });
    }

    return Promise.reject(new Error(`unexpected url: ${url}`));
  });
}

describe('QuizChoice', () => {
  beforeEach(() => {
    mockRole = 'owner';

    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
    apiDelete.mockReset();

    mockApiGet();

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

    const row = (await screen.findByText('O maan ko niyam?'))
      .closest('tr');

    expect(
      within(row).getByRole('button', { name: /^核准$/ }),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole('button', { name: /^退件$/ }),
    ).toBeInTheDocument();
  });

  test('analyst 看不到任何操作按鈕', async () => {
    mockRole = 'analyst';
    render(<QuizChoice />);

    const row = (await screen.findByText('O maan ko niyam?'))
      .closest('tr');

    expect(within(row).queryAllByRole('button')).toHaveLength(0);
    expect(
      screen.queryByRole(
        'button',
        { name: /新增中級選擇題/ },
      ),
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
      screen.getByRole(
        'button',
        { name: /新增中級選擇題/ },
      ),
    );

    const modal = await screen.findByRole('dialog');
    const saveButton = within(modal).getByRole(
      'button',
      { name: '儲存' },
    );

    expect(saveButton).toBeDisabled();

    fireEvent.change(
      within(modal).getByLabelText(/族語句子/),
      { target: { value: 'Fangcal ko roma.' } },
    );
    fireEvent.change(
      within(modal).getByLabelText(/中文句意/),
      { target: { value: '選出正確的圖片。' } },
    );

    for (const label of ['A', 'B', 'C']) {
      const input = within(modal).getByLabelText(
        new RegExp(`圖片 ${label}`),
      );

      fireEvent.change(input, {
        target: {
          files: [
            new File(
              [`image-${label}`],
              `${label}.jpg`,
              { type: 'image/jpeg' },
            ),
          ],
        },
      });

      await waitFor(() => {
        const expectedCalls = label === 'A'
          ? 1
          : label === 'B'
            ? 2
            : 3;
        expect(globalThis.fetch).toHaveBeenCalledTimes(
          expectedCalls,
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
      within(modal).getByRole(
        'radio',
        { name: /選項 C（設為正解）/ },
      ),
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

  test('draft 編輯仍呼叫一般 PATCH 端點', async () => {
    mockRole = 'editor';
    mockApiGet({
      results: [{ ...choiceItem, status: 'draft' }],
    });
    apiPatch.mockResolvedValueOnce({});

    render(<QuizChoice />);

    const row = (await screen.findByText('O maan ko niyam?'))
      .closest('tr');

    fireEvent.click(
      within(row).getByRole('button', { name: /編輯/ }),
    );

    const modal = await screen.findByRole('dialog');

    fireEvent.change(
      within(modal).getByLabelText(/中文句意/),
      { target: { value: '請選出正確的圖片。' } },
    );
    fireEvent.click(
      within(modal).getByRole(
        'button',
        { name: '儲存' },
      ),
    );

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/choice/21/',
        expect.objectContaining({
          question_ch: '請選出正確的圖片。',
        }),
      );
    });

    expect(apiPost).not.toHaveBeenCalled();
  });

  test('published 狀態下 editor 看得到編輯但沒有送審按鈕', async () => {
    mockRole = 'editor';
    mockApiGet({
      results: [{
        ...choiceItem,
        status: 'published',
      }],
      missingRevision: true,
    });

    render(<QuizChoice />);

    const row = (await screen.findByText('O maan ko niyam?'))
      .closest('tr');

    expect(
      within(row).getByRole('button', { name: /編輯/ }),
    ).toBeInTheDocument();
    expect(
      within(row).queryByRole('button', { name: /送審/ }),
    ).not.toBeInTheDocument();
  });

  test('點擊 published 編輯會先 GET pending-revision', async () => {
    mockRole = 'editor';
    mockApiGet({
      results: [{
        ...choiceItem,
        status: 'published',
      }],
      missingRevision: true,
    });

    render(<QuizChoice />);

    const row = (await screen.findByText('O maan ko niyam?'))
      .closest('tr');

    fireEvent.click(
      within(row).getByRole('button', { name: /編輯/ }),
    );

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/choice/21/pending-revision/',
      );
    });

    const modal = await screen.findByRole('dialog');

    expect(
      within(modal).getByLabelText(/族語句子/),
    ).toHaveValue(choiceItem.question_ab);
    expect(
      within(modal).getByLabelText(/中文句意/),
    ).toHaveValue(choiceItem.question_ch);
  });

  test('pending-revision 是 404 時使用目前發布內容預填', async () => {
    mockRole = 'editor';
    mockApiGet({
      results: [{
        ...choiceItem,
        status: 'published',
      }],
      missingRevision: true,
    });

    render(<QuizChoice />);

    const row = (await screen.findByText('O maan ko niyam?'))
      .closest('tr');

    fireEvent.click(
      within(row).getByRole('button', { name: /編輯/ }),
    );

    const modal = await screen.findByRole('dialog');

    expect(
      within(modal).getByLabelText(/族語句子/),
    ).toHaveValue(choiceItem.question_ab);
    expect(
      within(modal).getByRole(
        'radio',
        { name: /選項 B（設為正解）/ },
      ),
    ).toBeChecked();
    expect(
      within(modal).getByAltText('選項 A 圖片預覽'),
    ).toHaveAttribute('src', choiceItem.image_a_url);
    expect(
      within(modal).getByAltText('選項 B 圖片預覽'),
    ).toHaveAttribute('src', choiceItem.image_b_url);
    expect(
      within(modal).getByAltText('選項 C 圖片預覽'),
    ).toHaveAttribute('src', choiceItem.image_c_url);
  });

  test('已有待審修改時使用 revision payload 預填表單', async () => {
    mockRole = 'editor';
    mockApiGet({
      results: [{
        ...choiceItem,
        status: 'published',
        has_pending_revision: true,
      }],
      revision: {
        id: 101,
        payload: {
          question_ab: 'Pina ko demak?',
          question_ch: '哪一個動作是正確的？',
          image_b_url:
            'https://res.cloudinary.com/demo/image/upload/revision-b.jpg',
          answer: 3,
        },
        submitted_by: 'editor-uid',
        submitted_at: '2026-08-03T01:00:00Z',
      },
    });

    render(<QuizChoice />);

    const row = (await screen.findByText('O maan ko niyam?'))
      .closest('tr');

    fireEvent.click(
      within(row).getByRole('button', { name: /編輯/ }),
    );

    const modal = await screen.findByRole('dialog');

    expect(
      within(modal).getByLabelText(/族語句子/),
    ).toHaveValue('Pina ko demak?');
    expect(
      within(modal).getByLabelText(/中文句意/),
    ).toHaveValue('哪一個動作是正確的？');
    expect(
      within(modal).getByRole(
        'radio',
        { name: /選項 C（設為正解）/ },
      ),
    ).toBeChecked();

    // Partial revision payload 沒有 A/C 時沿用目前生效圖片。
    expect(
      within(modal).getByAltText('選項 A 圖片預覽'),
    ).toHaveAttribute('src', choiceItem.image_a_url);
    expect(
      within(modal).getByAltText('選項 B 圖片預覽'),
    ).toHaveAttribute(
      'src',
      'https://res.cloudinary.com/demo/image/upload/revision-b.jpg',
    );
    expect(
      within(modal).getByAltText('選項 C 圖片預覽'),
    ).toHaveAttribute('src', choiceItem.image_c_url);
  });

  test('儲存 published 內容會 POST pending-revision 而不是 PATCH', async () => {
    mockRole = 'editor';
    mockApiGet({
      results: [{
        ...choiceItem,
        status: 'published',
      }],
      missingRevision: true,
    });
    apiPost.mockResolvedValueOnce({
      id: 101,
      payload: {},
    });

    render(<QuizChoice />);

    const row = (await screen.findByText('O maan ko niyam?'))
      .closest('tr');

    fireEvent.click(
      within(row).getByRole('button', { name: /編輯/ }),
    );

    const modal = await screen.findByRole('dialog');

    fireEvent.change(
      within(modal).getByLabelText(/中文句意/),
      { target: { value: '請找出正確圖片。' } },
    );
    fireEvent.click(
      within(modal).getByRole(
        'radio',
        { name: /選項 C（設為正解）/ },
      ),
    );
    fireEvent.click(
      within(modal).getByRole(
        'button',
        { name: '儲存' },
      ),
    );

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/choice/21/pending-revision/',
        {
          tribe: 'amis',
          question_ab: 'O maan ko niyam?',
          question_ch: '請找出正確圖片。',
          image_a_url: choiceItem.image_a_url,
          image_b_url: choiceItem.image_b_url,
          image_c_url: choiceItem.image_c_url,
          answer: 3,
        },
      );
    });

    expect(apiPatch).not.toHaveBeenCalled();
  });

  test('has_pending_revision 顯示徽章及修改審核按鈕', async () => {
    mockRole = 'reviewer';
    mockApiGet({
      results: [{
        ...choiceItem,
        status: 'published',
        has_pending_revision: true,
      }],
    });

    render(<QuizChoice />);

    const row = (await screen.findByText('O maan ko niyam?'))
      .closest('tr');

    expect(
      within(row).getByText('有待審修改'),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole(
        'button',
        { name: /核准修改/ },
      ),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole(
        'button',
        { name: /退件修改/ },
      ),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole('button', { name: /下架/ }),
    ).toBeInTheDocument();
  });

  test('核准修改會呼叫 pending-revision approve 端點', async () => {
    mockRole = 'reviewer';
    mockApiGet({
      results: [{
        ...choiceItem,
        status: 'published',
        has_pending_revision: true,
      }],
    });
    apiPost.mockResolvedValueOnce({});

    render(<QuizChoice />);

    const row = (await screen.findByText('O maan ko niyam?'))
      .closest('tr');

    fireEvent.click(
      within(row).getByRole(
        'button',
        { name: /核准修改/ },
      ),
    );

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/choice/21/pending-revision/approve/',
        { review_comment: '' },
      );
    });
  });

  test('退件修改需填理由並呼叫 pending-revision reject 端點', async () => {
    mockRole = 'reviewer';
    mockApiGet({
      results: [{
        ...choiceItem,
        status: 'published',
        has_pending_revision: true,
      }],
    });
    apiPost.mockResolvedValueOnce({
      detail: '已退件，原內容不受影響',
    });

    render(<QuizChoice />);

    const row = (await screen.findByText('O maan ko niyam?'))
      .closest('tr');

    fireEvent.click(
      within(row).getByRole(
        'button',
        { name: /退件修改/ },
      ),
    );

    const confirmButton = await screen.findByRole(
      'button',
      { name: '確認退件修改' },
    );

    expect(confirmButton).toBeDisabled();

    fireEvent.change(
      screen.getByLabelText('請說明需要修改的內容'),
      { target: { value: '圖片內容需要重新確認' } },
    );
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/choice/21/pending-revision/reject/',
        { review_comment: '圖片內容需要重新確認' },
      );
    });
  });

  test('沒有待審修改時不顯示修改審核按鈕', async () => {
    mockRole = 'reviewer';
    mockApiGet({
      results: [{
        ...choiceItem,
        status: 'published',
        has_pending_revision: false,
      }],
    });

    render(<QuizChoice />);

    const row = (await screen.findByText('O maan ko niyam?'))
      .closest('tr');

    expect(
      within(row).queryByText('有待審修改'),
    ).not.toBeInTheDocument();
    expect(
      within(row).queryByRole(
        'button',
        { name: /核准修改/ },
      ),
    ).not.toBeInTheDocument();
    expect(
      within(row).queryByRole(
        'button',
        { name: /退件修改/ },
      ),
    ).not.toBeInTheDocument();
    expect(
      within(row).getByRole('button', { name: /下架/ }),
    ).toBeInTheDocument();
  });

  test('editor 可編輯 published 內容但看不到審核修改與下架', async () => {
    mockRole = 'editor';
    mockApiGet({
      results: [{
        ...choiceItem,
        status: 'published',
        has_pending_revision: true,
      }],
      missingRevision: true,
    });

    render(<QuizChoice />);

    const row = (await screen.findByText('O maan ko niyam?'))
      .closest('tr');

    expect(
      within(row).getByRole('button', { name: /編輯/ }),
    ).toBeInTheDocument();
    expect(
      within(row).queryByRole(
        'button',
        { name: /核准修改/ },
      ),
    ).not.toBeInTheDocument();
    expect(
      within(row).queryByRole(
        'button',
        { name: /退件修改/ },
      ),
    ).not.toBeInTheDocument();
    expect(
      within(row).queryByRole('button', { name: /下架/ }),
    ).not.toBeInTheDocument();
  });

  test('published 仍保留下架功能', async () => {
    mockRole = 'reviewer';
    mockApiGet({
      results: [{
        ...choiceItem,
        status: 'published',
      }],
    });
    apiPost.mockResolvedValueOnce({});

    render(<QuizChoice />);

    const row = (await screen.findByText('O maan ko niyam?'))
      .closest('tr');

    fireEvent.click(
      within(row).getByRole('button', { name: /下架/ }),
    );

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/choice/21/unpublish/',
        undefined,
      );
    });
  });

  test('刪除前跳出原生確認框', async () => {
    mockApiGet({
      results: [{ ...choiceItem, status: 'draft' }],
    });
    apiDelete.mockResolvedValueOnce({});

    render(<QuizChoice />);

    const row = (await screen.findByText('O maan ko niyam?'))
      .closest('tr');

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
