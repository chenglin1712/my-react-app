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
  audio_url:
    'https://res.cloudinary.com/demo/video/upload/question.mp3',
  image_url:
    'https://res.cloudinary.com/demo/image/upload/question.jpg',
  answer: 1,
  status: 'pending_review',
  has_pending_revision: false,
  created_by: 'editor-uid',
};

function mockApiGet({
  results = [trueFalseItem],
  revision,
  missingRevision = false,
} = {}) {
  apiGet.mockImplementation((url) => {
    if (
      url
      === '/adminapi/quiz-bank/true-false/11/pending-revision/'
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

    if (url.startsWith('/adminapi/quiz-bank/true-false/?')) {
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

describe('QuizTrueFalse', () => {
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

    const row = (await screen.findByText("Musa' su inu?"))
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
    render(<QuizTrueFalse />);

    const row = (await screen.findByText("Musa' su inu?"))
      .closest('tr');

    expect(within(row).queryAllByRole('button')).toHaveLength(0);
    expect(
      screen.queryByRole(
        'button',
        { name: /新增初級是非題/ },
      ),
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
      screen.getByRole(
        'button',
        { name: /新增初級是非題/ },
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
      { target: { value: "Ima' lalu su?" } },
    );
    fireEvent.change(
      within(modal).getByLabelText(/中文句意/),
      { target: { value: '你叫什麼名字？' } },
    );

    fireEvent.change(
      within(modal).getByLabelText(/音檔/),
      {
        target: {
          files: [
            new File(
              ['audio'],
              'question.mp3',
              { type: 'audio/mpeg' },
            ),
          ],
        },
      },
    );

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/video/upload'),
        expect.objectContaining({ method: 'POST' }),
      );
    });

    fireEvent.change(
      within(modal).getByLabelText(/圖片/),
      {
        target: {
          files: [
            new File(
              ['image'],
              'question.jpg',
              { type: 'image/jpeg' },
            ),
          ],
        },
      },
    );

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          '/image/upload/f_auto,q_auto',
        ),
        expect.objectContaining({ method: 'POST' }),
      );
      expect(saveButton).not.toBeDisabled();
    });

    fireEvent.click(
      within(modal).getByRole(
        'radio',
        { name: /X 不符合/ },
      ),
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

  test('draft 編輯仍呼叫一般 PATCH 端點', async () => {
    mockRole = 'editor';
    mockApiGet({
      results: [{ ...trueFalseItem, status: 'draft' }],
    });
    apiPatch.mockResolvedValueOnce({});

    render(<QuizTrueFalse />);

    const row = (await screen.findByText("Musa' su inu?"))
      .closest('tr');

    fireEvent.click(
      within(row).getByRole('button', { name: /編輯/ }),
    );

    const modal = await screen.findByRole('dialog');

    fireEvent.change(
      within(modal).getByLabelText(/中文句意/),
      { target: { value: '你要去哪兒？' } },
    );
    fireEvent.click(
      within(modal).getByRole(
        'button',
        { name: '儲存' },
      ),
    );

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/true-false/11/',
        expect.objectContaining({
          question_ch: '你要去哪兒？',
        }),
      );
    });

    expect(apiPost).not.toHaveBeenCalled();
  });

  test('published 狀態下 editor 看得到編輯但沒有送審按鈕', async () => {
    mockRole = 'editor';
    mockApiGet({
      results: [{
        ...trueFalseItem,
        status: 'published',
      }],
      missingRevision: true,
    });

    render(<QuizTrueFalse />);

    const row = (await screen.findByText("Musa' su inu?"))
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
        ...trueFalseItem,
        status: 'published',
      }],
      missingRevision: true,
    });

    render(<QuizTrueFalse />);

    const row = (await screen.findByText("Musa' su inu?"))
      .closest('tr');

    fireEvent.click(
      within(row).getByRole('button', { name: /編輯/ }),
    );

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/true-false/11/pending-revision/',
      );
    });

    const modal = await screen.findByRole('dialog');

    expect(
      within(modal).getByLabelText(/族語句子/),
    ).toHaveValue("Musa' su inu?");
    expect(
      within(modal).getByLabelText(/中文句意/),
    ).toHaveValue('你要去哪裡？');
  });

  test('pending-revision 是 404 時使用目前發布內容預填', async () => {
    mockRole = 'editor';
    mockApiGet({
      results: [{
        ...trueFalseItem,
        status: 'published',
      }],
      missingRevision: true,
    });

    render(<QuizTrueFalse />);

    const row = (await screen.findByText("Musa' su inu?"))
      .closest('tr');

    fireEvent.click(
      within(row).getByRole('button', { name: /編輯/ }),
    );

    const modal = await screen.findByRole('dialog');

    expect(
      within(modal).getByLabelText(/族語句子/),
    ).toHaveValue(trueFalseItem.question_ab);
    expect(
      within(modal).getByLabelText(/中文句意/),
    ).toHaveValue(trueFalseItem.question_ch);
    expect(
      within(modal).getByRole(
        'radio',
        { name: /O 符合/ },
      ),
    ).toBeChecked();
    expect(
      within(modal).getByAltText('題目圖片預覽'),
    ).toHaveAttribute('src', trueFalseItem.image_url);
    expect(
      within(modal).getByLabelText('目前音檔預覽'),
    ).toHaveAttribute('src', trueFalseItem.audio_url);
  });

  test('已有待審修改時使用 revision payload 預填表單', async () => {
    mockRole = 'editor';
    mockApiGet({
      results: [{
        ...trueFalseItem,
        status: 'published',
        has_pending_revision: true,
      }],
      revision: {
        id: 91,
        payload: {
          question_ab: "Ima' lalu su?",
          question_ch: '你叫什麼名字？',
          answer: 2,
        },
        submitted_by: 'editor-uid',
        submitted_at: '2026-08-03T01:00:00Z',
      },
    });

    render(<QuizTrueFalse />);

    const row = (await screen.findByText("Musa' su inu?"))
      .closest('tr');

    fireEvent.click(
      within(row).getByRole('button', { name: /編輯/ }),
    );

    const modal = await screen.findByRole('dialog');

    expect(
      within(modal).getByLabelText(/族語句子/),
    ).toHaveValue("Ima' lalu su?");
    expect(
      within(modal).getByLabelText(/中文句意/),
    ).toHaveValue('你叫什麼名字？');
    expect(
      within(modal).getByRole(
        'radio',
        { name: /X 不符合/ },
      ),
    ).toBeChecked();

    // Partial revision payload 沒有媒體欄位時，沿用目前生效內容。
    expect(
      within(modal).getByAltText('題目圖片預覽'),
    ).toHaveAttribute('src', trueFalseItem.image_url);
    expect(
      within(modal).getByLabelText('目前音檔預覽'),
    ).toHaveAttribute('src', trueFalseItem.audio_url);
  });

  test('儲存 published 內容會 POST pending-revision 而不是 PATCH', async () => {
    mockRole = 'editor';
    mockApiGet({
      results: [{
        ...trueFalseItem,
        status: 'published',
      }],
      missingRevision: true,
    });
    apiPost.mockResolvedValueOnce({
      id: 91,
      payload: {},
    });

    render(<QuizTrueFalse />);

    const row = (await screen.findByText("Musa' su inu?"))
      .closest('tr');

    fireEvent.click(
      within(row).getByRole('button', { name: /編輯/ }),
    );

    const modal = await screen.findByRole('dialog');

    fireEvent.change(
      within(modal).getByLabelText(/中文句意/),
      { target: { value: '你準備去哪裡？' } },
    );
    fireEvent.click(
      within(modal).getByRole(
        'radio',
        { name: /X 不符合/ },
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
        '/adminapi/quiz-bank/true-false/11/pending-revision/',
        {
          tribe: 'tayal',
          question_ab: "Musa' su inu?",
          question_ch: '你準備去哪裡？',
          audio_url: trueFalseItem.audio_url,
          image_url: trueFalseItem.image_url,
          answer: 2,
        },
      );
    });

    expect(apiPatch).not.toHaveBeenCalled();
  });

  test('has_pending_revision 顯示徽章及修改審核按鈕', async () => {
    mockRole = 'reviewer';
    mockApiGet({
      results: [{
        ...trueFalseItem,
        status: 'published',
        has_pending_revision: true,
      }],
    });

    render(<QuizTrueFalse />);

    const row = (await screen.findByText("Musa' su inu?"))
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
        ...trueFalseItem,
        status: 'published',
        has_pending_revision: true,
      }],
    });
    apiPost.mockResolvedValueOnce({});

    render(<QuizTrueFalse />);

    const row = (await screen.findByText("Musa' su inu?"))
      .closest('tr');

    fireEvent.click(
      within(row).getByRole(
        'button',
        { name: /核准修改/ },
      ),
    );

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/true-false/11/pending-revision/approve/',
        { review_comment: '' },
      );
    });
  });

  test('退件修改需填理由並呼叫 pending-revision reject 端點', async () => {
    mockRole = 'reviewer';
    mockApiGet({
      results: [{
        ...trueFalseItem,
        status: 'published',
        has_pending_revision: true,
      }],
    });
    apiPost.mockResolvedValueOnce({
      detail: '已退件，原內容不受影響',
    });

    render(<QuizTrueFalse />);

    const row = (await screen.findByText("Musa' su inu?"))
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
      { target: { value: '句意與圖片不一致' } },
    );
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/true-false/11/pending-revision/reject/',
        { review_comment: '句意與圖片不一致' },
      );
    });
  });

  test('沒有待審修改時不顯示修改審核按鈕', async () => {
    mockRole = 'reviewer';
    mockApiGet({
      results: [{
        ...trueFalseItem,
        status: 'published',
        has_pending_revision: false,
      }],
    });

    render(<QuizTrueFalse />);

    const row = (await screen.findByText("Musa' su inu?"))
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
        ...trueFalseItem,
        status: 'published',
        has_pending_revision: true,
      }],
      missingRevision: true,
    });

    render(<QuizTrueFalse />);

    const row = (await screen.findByText("Musa' su inu?"))
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
        ...trueFalseItem,
        status: 'published',
      }],
    });
    apiPost.mockResolvedValueOnce({});

    render(<QuizTrueFalse />);

    const row = (await screen.findByText("Musa' su inu?"))
      .closest('tr');

    fireEvent.click(
      within(row).getByRole('button', { name: /下架/ }),
    );

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/true-false/11/unpublish/',
        undefined,
      );
    });
  });

  test('刪除前跳出原生確認框', async () => {
    mockApiGet({
      results: [{ ...trueFalseItem, status: 'draft' }],
    });
    apiDelete.mockResolvedValueOnce({});

    render(<QuizTrueFalse />);

    const row = (await screen.findByText("Musa' su inu?"))
      .closest('tr');

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
