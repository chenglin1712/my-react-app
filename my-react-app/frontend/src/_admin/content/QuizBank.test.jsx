import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import QuizBank from './QuizBank';
import { apiGet, apiPost, apiPatch, apiDelete } from '../../../utils/apiClient';

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

function renderPage() {
  return render(
    <MemoryRouter>
      <QuizBank />
    </MemoryRouter>,
  );
}

const vocabItem = {
  id: 1,
  tribe: 'tayal',
  category: 'noun',
  foreign_word: 'huzil',
  chinese_gloss: '狗',
  audio_file_id: '',
  status: 'pending_review',
  has_pending_revision: false,
  created_by: 'editor-uid',
};

const clozeItem = {
  id: 2,
  tribe: 'tayal',
  passage_foreign: 'Lokah! {blank1}',
  passage_chinese: '你好！',
  blanks: {
    blank1: {
      options: ['a', 'b', 'c', 'd'],
      answer: 1,
    },
  },
  status: 'pending_review',
  has_pending_revision: false,
  created_by: 'editor-uid',
};

// QuizBank.jsx 使用 react-bootstrap Tabs，兩個分頁掛載時都會載入列表。
// pending-revision 單筆查詢也會包含相同路徑，因此必須先判斷它。
function mockApiGet({
  vocabResults = [vocabItem],
  clozeResults = [clozeItem],
  vocabRevision,
  clozeRevision,
  missingVocabRevision = false,
  missingClozeRevision = false,
} = {}) {
  apiGet.mockImplementation((url) => {
    if (url === '/adminapi/quiz-bank/vocab/1/pending-revision/') {
      if (missingVocabRevision) {
        return Promise.reject(
          Object.assign(new Error('目前沒有待審核的修改'), { status: 404 }),
        );
      }
      if (vocabRevision) return Promise.resolve(vocabRevision);
      return Promise.reject(new Error(`unexpected url: ${url}`));
    }

    if (url === '/adminapi/quiz-bank/cloze/2/pending-revision/') {
      if (missingClozeRevision) {
        return Promise.reject(
          Object.assign(new Error('目前沒有待審核的修改'), { status: 404 }),
        );
      }
      if (clozeRevision) return Promise.resolve(clozeRevision);
      return Promise.reject(new Error(`unexpected url: ${url}`));
    }

    if (url.startsWith('/adminapi/quiz-bank/vocab/?')) {
      return Promise.resolve({
        results: vocabResults,
        count: vocabResults.length,
        page: 1,
        page_size: 20,
      });
    }

    if (url.startsWith('/adminapi/quiz-bank/cloze/?')) {
      return Promise.resolve({
        results: clozeResults,
        count: clozeResults.length,
        page: 1,
        page_size: 20,
      });
    }

    return Promise.reject(new Error(`unexpected url: ${url}`));
  });
}

describe('QuizBank', () => {
  beforeEach(() => {
    mockRole = 'owner';
    apiGet.mockReset();
    apiPost.mockReset();
    apiPatch.mockReset();
    apiDelete.mockReset();
    mockApiGet();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  test('載入後配合題詞彙分頁顯示詞彙列表', async () => {
    renderPage();

    expect(await screen.findByText('huzil')).toBeInTheDocument();
    expect(screen.getByText('狗')).toBeInTheDocument();
  });

  test('切到克漏字短文分頁能看到短文列表', async () => {
    renderPage();

    await screen.findByText('huzil');
    fireEvent.click(screen.getByRole('tab', { name: '克漏字短文' }));

    expect(await screen.findByText(/Lokah!/)).toBeInTheDocument();
  });

  test('reviewer 看得到核准與退件按鈕', async () => {
    mockRole = 'reviewer';
    renderPage();

    const row = await screen
      .findByText('huzil')
      .then((element) => element.closest('tr'));

    expect(
      within(row).getByRole('button', { name: /^核准$/ }),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole('button', { name: /^退件$/ }),
    ).toBeInTheDocument();
  });

  test('editor 看不到核准與退件按鈕，但看得到編輯與送審', async () => {
    mockRole = 'editor';
    mockApiGet({
      vocabResults: [{ ...vocabItem, status: 'draft' }],
    });

    renderPage();

    const row = await screen
      .findByText('huzil')
      .then((element) => element.closest('tr'));

    expect(
      within(row).getByRole('button', { name: /編輯/ }),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole('button', { name: /送審/ }),
    ).toBeInTheDocument();
    expect(
      within(row).queryByRole('button', { name: /^核准$/ }),
    ).not.toBeInTheDocument();
  });

  test('點核准會呼叫 POST approve 端點並重新載入', async () => {
    apiPost.mockResolvedValueOnce({});
    renderPage();

    const row = await screen
      .findByText('huzil')
      .then((element) => element.closest('tr'));

    fireEvent.click(
      within(row).getByRole('button', { name: /^核准$/ }),
    );

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/vocab/1/approve/',
        { review_comment: '' },
      );
    });
  });

  test('退件需要填寫理由，送出後帶上理由呼叫 reject', async () => {
    apiPost.mockResolvedValueOnce({});
    renderPage();

    const row = await screen
      .findByText('huzil')
      .then((element) => element.closest('tr'));

    fireEvent.click(
      within(row).getByRole('button', { name: /^退件$/ }),
    );

    const confirmButton = await screen.findByRole(
      'button',
      { name: '確認退件' },
    );

    expect(confirmButton).toBeDisabled();

    fireEvent.change(
      screen.getByLabelText('請說明需要修改的內容'),
      { target: { value: '用字需要再確認' } },
    );
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/vocab/1/reject/',
        { review_comment: '用字需要再確認' },
      );
    });
  });

  test('published 詞彙的 editor 看得到編輯按鈕', async () => {
    mockRole = 'editor';
    mockApiGet({
      vocabResults: [{ ...vocabItem, status: 'published' }],
      missingVocabRevision: true,
    });

    renderPage();

    const row = await screen
      .findByText('huzil')
      .then((element) => element.closest('tr'));

    expect(
      within(row).getByRole('button', { name: /編輯/ }),
    ).toBeInTheDocument();
    expect(
      within(row).queryByRole('button', { name: /送審/ }),
    ).not.toBeInTheDocument();
  });

  test('點擊 published 詞彙的編輯會先 GET pending-revision', async () => {
    mockRole = 'editor';
    mockApiGet({
      vocabResults: [{ ...vocabItem, status: 'published' }],
      missingVocabRevision: true,
    });

    renderPage();

    const row = await screen
      .findByText('huzil')
      .then((element) => element.closest('tr'));

    fireEvent.click(
      within(row).getByRole('button', { name: /編輯/ }),
    );

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/vocab/1/pending-revision/',
      );
    });

    const modal = await screen.findByRole('dialog');
    expect(
      within(modal).getByLabelText('族語詞彙 *'),
    ).toHaveValue('huzil');
  });

  test('published 詞彙已有待審修改時，表單使用 revision payload', async () => {
    mockRole = 'editor';
    mockApiGet({
      vocabResults: [{
        ...vocabItem,
        status: 'published',
        has_pending_revision: true,
      }],
      vocabRevision: {
        id: 51,
        payload: {
          foreign_word: 'huzil-new',
          chinese_gloss: '狗（修改版）',
        },
        submitted_by: 'editor-uid',
        submitted_at: '2026-08-03T01:00:00Z',
      },
    });

    renderPage();

    const row = await screen
      .findByText('huzil')
      .then((element) => element.closest('tr'));

    fireEvent.click(
      within(row).getByRole('button', { name: /編輯/ }),
    );

    const modal = await screen.findByRole('dialog');

    expect(
      within(modal).getByLabelText('族語詞彙 *'),
    ).toHaveValue('huzil-new');
    expect(
      within(modal).getByLabelText('中文詞義 *'),
    ).toHaveValue('狗（修改版）');
  });

  test('儲存 published 詞彙會 POST pending-revision 而不是 PATCH', async () => {
    mockRole = 'editor';
    mockApiGet({
      vocabResults: [{ ...vocabItem, status: 'published' }],
      missingVocabRevision: true,
    });
    apiPost.mockResolvedValueOnce({
      id: 51,
      payload: {},
    });

    renderPage();

    const row = await screen
      .findByText('huzil')
      .then((element) => element.closest('tr'));

    fireEvent.click(
      within(row).getByRole('button', { name: /編輯/ }),
    );

    const modal = await screen.findByRole('dialog');

    fireEvent.change(
      within(modal).getByLabelText('中文詞義 *'),
      { target: { value: '家犬' } },
    );
    fireEvent.click(
      within(modal).getByRole('button', { name: '儲存' }),
    );

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/vocab/1/pending-revision/',
        expect.objectContaining({
          tribe: 'tayal',
          category: 'noun',
          foreign_word: 'huzil',
          chinese_gloss: '家犬',
        }),
      );
    });

    expect(apiPatch).not.toHaveBeenCalled();
  });

  test('published 詞彙有待審修改時顯示徽章及核准修改與退件修改按鈕', async () => {
    mockRole = 'reviewer';
    mockApiGet({
      vocabResults: [{
        ...vocabItem,
        status: 'published',
        has_pending_revision: true,
      }],
    });

    renderPage();

    const row = await screen
      .findByText('huzil')
      .then((element) => element.closest('tr'));

    expect(within(row).getByText('有待審修改')).toBeInTheDocument();
    expect(
      within(row).getByRole('button', { name: /核准修改/ }),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole('button', { name: /退件修改/ }),
    ).toBeInTheDocument();
  });

  test('核准待審修改會呼叫 pending-revision approve 端點', async () => {
    mockRole = 'reviewer';
    mockApiGet({
      vocabResults: [{
        ...vocabItem,
        status: 'published',
        has_pending_revision: true,
      }],
    });
    apiPost.mockResolvedValueOnce({});

    renderPage();

    const row = await screen
      .findByText('huzil')
      .then((element) => element.closest('tr'));

    fireEvent.click(
      within(row).getByRole('button', { name: /核准修改/ }),
    );

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/vocab/1/pending-revision/approve/',
        { review_comment: '' },
      );
    });
  });

  test('退件待審修改必須填理由並呼叫 pending-revision reject 端點', async () => {
    mockRole = 'reviewer';
    mockApiGet({
      vocabResults: [{
        ...vocabItem,
        status: 'published',
        has_pending_revision: true,
      }],
    });
    apiPost.mockResolvedValueOnce({ detail: '已退件，原內容不受影響' });

    renderPage();

    const row = await screen
      .findByText('huzil')
      .then((element) => element.closest('tr'));

    fireEvent.click(
      within(row).getByRole('button', { name: /退件修改/ }),
    );

    const confirmButton = await screen.findByRole(
      'button',
      { name: '確認退件修改' },
    );

    expect(confirmButton).toBeDisabled();

    fireEvent.change(
      screen.getByLabelText('請說明需要修改的內容'),
      { target: { value: '修改後的詞義不夠精確' } },
    );
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/vocab/1/pending-revision/reject/',
        { review_comment: '修改後的詞義不夠精確' },
      );
    });
  });

  test('published 狀態的詞彙，reviewer 仍看得到下架按鈕', async () => {
    mockRole = 'reviewer';
    mockApiGet({
      vocabResults: [{ ...vocabItem, status: 'published' }],
    });
    apiPost.mockResolvedValueOnce({});

    renderPage();

    const row = await screen
      .findByText('huzil')
      .then((element) => element.closest('tr'));

    fireEvent.click(
      within(row).getByRole('button', { name: /下架/ }),
    );

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/vocab/1/unpublish/',
        undefined,
      );
    });
  });

  test('新增詞彙送出正確 payload', async () => {
    mockRole = 'editor';
    apiPost.mockResolvedValueOnce({});

    renderPage();

    await screen.findByText('huzil');
    fireEvent.click(
      screen.getByRole('button', { name: /新增詞彙/ }),
    );

    const modal = await screen.findByRole('dialog');

    fireEvent.change(
      within(modal).getByLabelText('族語詞彙 *'),
      { target: { value: 'bzyok' } },
    );
    fireEvent.change(
      within(modal).getByLabelText('中文詞義 *'),
      { target: { value: '豬' } },
    );
    fireEvent.click(
      within(modal).getByRole('button', { name: '儲存' }),
    );

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/vocab/',
        expect.objectContaining({
          tribe: 'tayal',
          category: 'noun',
          foreign_word: 'bzyok',
          chinese_gloss: '豬',
        }),
      );
    });
  });

  test('draft 詞彙編輯仍使用 PATCH', async () => {
    mockRole = 'editor';
    mockApiGet({
      vocabResults: [{ ...vocabItem, status: 'draft' }],
    });
    apiPatch.mockResolvedValueOnce({});

    renderPage();

    const row = await screen
      .findByText('huzil')
      .then((element) => element.closest('tr'));

    fireEvent.click(
      within(row).getByRole('button', { name: /編輯/ }),
    );

    const modal = await screen.findByRole('dialog');

    fireEvent.change(
      within(modal).getByLabelText('中文詞義 *'),
      { target: { value: '家犬' } },
    );
    fireEvent.click(
      within(modal).getByRole('button', { name: '儲存' }),
    );

    await waitFor(() => {
      expect(apiPatch).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/vocab/1/',
        expect.objectContaining({ chinese_gloss: '家犬' }),
      );
    });
  });

  test('editor 看不到刪除按鈕', async () => {
    mockRole = 'editor';
    mockApiGet({
      vocabResults: [{ ...vocabItem, status: 'draft' }],
    });

    renderPage();

    const row = await screen
      .findByText('huzil')
      .then((element) => element.closest('tr'));

    expect(
      within(row).queryByRole('button', { name: /刪除/ }),
    ).not.toBeInTheDocument();
  });

  test('owner 刪除 draft 詞彙前顯示確認框，確認後呼叫 apiDelete', async () => {
    mockRole = 'owner';
    mockApiGet({
      vocabResults: [{ ...vocabItem, status: 'draft' }],
    });
    apiDelete.mockResolvedValueOnce({});

    renderPage();

    const row = await screen
      .findByText('huzil')
      .then((element) => element.closest('tr'));

    fireEvent.click(
      within(row).getByRole('button', { name: /刪除/ }),
    );

    expect(window.confirm).toHaveBeenCalled();

    await waitFor(() => {
      expect(apiDelete).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/vocab/1/',
      );
    });
  });

  test('克漏字短文新增時，每個空格四個選項皆必填才能儲存', async () => {
    mockRole = 'editor';
    apiPost.mockResolvedValueOnce({});

    renderPage();

    await screen.findByText('huzil');
    fireEvent.click(
      screen.getByRole('tab', { name: '克漏字短文' }),
    );
    await screen.findByText(/Lokah!/);

    fireEvent.click(
      screen.getByRole('button', { name: /新增短文/ }),
    );

    const modal = await screen.findByRole('dialog');
    const saveButton = within(modal).getByRole(
      'button',
      { name: '儲存' },
    );

    expect(saveButton).toBeDisabled();

    fireEvent.change(
      within(modal).getByLabelText('族語短文 *'),
      { target: { value: 'Lokah! {blank1}' } },
    );
    fireEvent.change(
      within(modal).getByLabelText('中文翻譯 *'),
      { target: { value: '你好！' } },
    );

    const optionInputs = within(modal).getAllByPlaceholderText(/選項 \d/);
    optionInputs.forEach((input, index) => {
      fireEvent.change(input, {
        target: { value: `選項${index + 1}` },
      });
    });

    expect(saveButton).not.toBeDisabled();
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/cloze/',
        expect.objectContaining({
          tribe: 'tayal',
          passage_foreign: 'Lokah! {blank1}',
          passage_chinese: '你好！',
        }),
      );
    });
  });

  test('點擊 published 克漏字編輯會先 GET revision，儲存時 POST revision', async () => {
    mockRole = 'editor';
    mockApiGet({
      clozeResults: [{ ...clozeItem, status: 'published' }],
      clozeRevision: {
        id: 52,
        payload: {
          passage_foreign: 'Musa! {blank1}',
          passage_chinese: '出發吧！',
        },
        submitted_by: 'editor-uid',
        submitted_at: '2026-08-03T02:00:00Z',
      },
    });
    apiPost.mockResolvedValueOnce({
      id: 52,
      payload: {},
    });

    renderPage();

    await screen.findByText('huzil');
    fireEvent.click(
      screen.getByRole('tab', { name: '克漏字短文' }),
    );

    const row = await screen
      .findByText(/Lokah!/)
      .then((element) => element.closest('tr'));

    fireEvent.click(
      within(row).getByRole('button', { name: /編輯/ }),
    );

    await waitFor(() => {
      expect(apiGet).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/cloze/2/pending-revision/',
      );
    });

    const modal = await screen.findByRole('dialog');

    expect(
      within(modal).getByLabelText('族語短文 *'),
    ).toHaveValue('Musa! {blank1}');
    expect(
      within(modal).getByLabelText('中文翻譯 *'),
    ).toHaveValue('出發吧！');

    fireEvent.click(
      within(modal).getByRole('button', { name: '儲存' }),
    );

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/cloze/2/pending-revision/',
        expect.objectContaining({
          tribe: 'tayal',
          passage_foreign: 'Musa! {blank1}',
          passage_chinese: '出發吧！',
        }),
      );
    });

    expect(apiPatch).not.toHaveBeenCalled();
  });

  test('published 克漏字有待審修改時可核准與退件修改', async () => {
    mockRole = 'reviewer';
    mockApiGet({
      clozeResults: [{
        ...clozeItem,
        status: 'published',
        has_pending_revision: true,
      }],
    });
    apiPost.mockResolvedValue({});

    renderPage();

    await screen.findByText('huzil');
    fireEvent.click(
      screen.getByRole('tab', { name: '克漏字短文' }),
    );

    const row = await screen
      .findByText(/Lokah!/)
      .then((element) => element.closest('tr'));

    expect(within(row).getByText('有待審修改')).toBeInTheDocument();

    fireEvent.click(
      within(row).getByRole('button', { name: /核准修改/ }),
    );

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/cloze/2/pending-revision/approve/',
        { review_comment: '' },
      );
    });

    fireEvent.click(
      within(row).getByRole('button', { name: /退件修改/ }),
    );

    fireEvent.change(
      await screen.findByLabelText('請說明需要修改的內容'),
      { target: { value: '短文內容需要重新確認' } },
    );
    fireEvent.click(
      screen.getByRole('button', { name: '確認退件修改' }),
    );

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith(
        '/adminapi/quiz-bank/cloze/2/pending-revision/reject/',
        { review_comment: '短文內容需要重新確認' },
      );
    });
  });

  test('族語篩選送出後 vocab 查詢字串帶上篩選條件', async () => {
    renderPage();

    await screen.findByText('huzil');
    apiGet.mockClear();
    mockApiGet();

    const panel = screen.getByRole(
      'tabpanel',
      { name: '配合題詞彙' },
    );

    fireEvent.change(
      within(panel).getByLabelText('族語'),
      { target: { value: 'amis' } },
    );
    fireEvent.click(
      within(panel).getByRole('button', { name: '搜尋' }),
    );

    await waitFor(() => {
      const call = apiGet.mock.calls.find(
        ([url]) => (
          url.includes('/quiz-bank/vocab/')
          && url.includes('tribe=amis')
        ),
      );
      expect(call).toBeTruthy();
    });
  });
});
