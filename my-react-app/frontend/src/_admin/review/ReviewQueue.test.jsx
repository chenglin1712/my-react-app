import {
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ReviewQueue from './ReviewQueue';
import { apiGet } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
  apiGet: vi.fn(),
}));

let mockRole = 'owner';
let mockAuthLoading = false;

vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({
    userData: mockRole ? { role: mockRole } : null,
    loading: mockAuthLoading,
  }),
}));

const queueItems = [
  {
    type: 'submission',
    content_type: 'announcement',
    id: 12,
    title: '部落活動公告',
    submitted_by: 'editor-uid',
    submitted_at: '2026-08-01T12:00:00+00:00',
    link: '/admin/content/announcements',
  },
  {
    type: 'revision',
    content_type: 'quiz_cloze_passage',
    id: 15,
    title: '傳統祭儀克漏字',
    submitted_by: 'reviewer-uid',
    submitted_at: null,
    link: '/admin/quiz-bank/vocab?tab=cloze',
  },
  {
    type: 'report',
    content_type: 'recording',
    id: 'rep123',
    title: '疑似不當錄音',
    submitted_by: 'member-uid',
    submitted_at: '2026-08-02T08:00:00+00:00',
    link: '/admin/moderation/reports',
  },
];

function renderQueue() {
  return render(
    <MemoryRouter>
      <ReviewQueue />
    </MemoryRouter>,
  );
}

describe('ReviewQueue', () => {
  beforeEach(() => {
    mockRole = 'owner';
    mockAuthLoading = false;
    apiGet.mockReset();
    apiGet.mockResolvedValue({
      results: queueItems,
      count: 3,
      page: 1,
      page_size: 20,
    });
  });

  test('載入後顯示類型、內容種類與標題中文', async () => {
    renderQueue();

    expect(await screen.findByText('部落活動公告')).toBeInTheDocument();

    const table = screen.getByRole('table');
    expect(within(table).getByText('新內容送審')).toBeInTheDocument();
    expect(within(table).getByText('已發布內容修改')).toBeInTheDocument();
    expect(within(table).getByText('檢舉')).toBeInTheDocument();
    expect(within(table).getByText('公告')).toBeInTheDocument();
    expect(within(table).getByText('克漏字短文')).toBeInTheDocument();
    expect(within(table).getByText('發音錄音')).toBeInTheDocument();
  });

  test('只透過 apiGet 查詢，並帶入分頁參數', async () => {
    renderQueue();

    await screen.findByText('部落活動公告');

    expect(apiGet).toHaveBeenCalledWith(
      '/adminapi/review-queue/?page=1&page_size=20',
    );
  });

  test('切換類型篩選後重新查詢並帶入 type', async () => {
    renderQueue();
    await screen.findByText('部落活動公告');

    fireEvent.change(screen.getByLabelText('佇列類型'), {
      target: { value: 'report' },
    });

    await waitFor(() => {
      expect(apiGet).toHaveBeenLastCalledWith(
        '/adminapi/review-queue/?page=1&page_size=20&type=report',
      );
    });
  });

  test('submitted_at 為 null 時日期與等待時間都顯示破折號', async () => {
    renderQueue();

    const row = await screen.findByText('傳統祭儀克漏字')
      .then((element) => element.closest('tr'));

    expect(within(row).getAllByText('—')).toHaveLength(2);
  });

  test('前往處理按鈕使用 API 回傳的內部路徑', async () => {
    renderQueue();

    const row = await screen.findByText('疑似不當錄音')
      .then((element) => element.closest('tr'));
    const link = within(row).getByRole('button', { name: /前往處理/ });

    expect(link).toHaveAttribute('href', '/admin/moderation/reports');
  });

  test('下一頁按鈕依 count 與 page_size 判斷並查詢下一頁', async () => {
    apiGet.mockResolvedValue({
      results: [queueItems[0]],
      count: 21,
      page: 1,
      page_size: 20,
    });

    renderQueue();
    await screen.findByText('部落活動公告');

    fireEvent.click(screen.getByRole('button', { name: /下一頁/ }));

    await waitFor(() => {
      expect(apiGet).toHaveBeenLastCalledWith(
        '/adminapi/review-queue/?page=2&page_size=20',
      );
    });
  });

  test('staff 角色可以讀取佇列', async () => {
    mockRole = 'analyst';

    renderQueue();

    expect(await screen.findByText('部落活動公告')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalled();
  });

  test('非 staff 角色不呼叫 API 並顯示權限錯誤', () => {
    mockRole = 'member';

    renderQueue();

    expect(screen.getByText('您沒有權限檢視送審佇列。'))
      .toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalled();
  });

  test('apiGet 失敗時顯示錯誤訊息', async () => {
    apiGet.mockRejectedValueOnce(new Error('送審佇列載入失敗'));

    renderQueue();

    expect(await screen.findByText('送審佇列載入失敗'))
      .toBeInTheDocument();
  });
});
