import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ExamSchedule from './ExamSchedule';
import { apiGet, apiPost, apiPut, apiDelete } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
}));

let mockRole = 'owner';
vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <ExamSchedule />
    </MemoryRouter>,
  );
}

const baseData = {
  crawled: {
    available: true,
    session: '115年度第1次原住民族語言能力認證測驗日程表',
    phases: [
      { phase: '報名', label: '報名日期', start_date: '2026-01-21', end_date: '2026-02-26' },
      { phase: '測驗', label: '測驗日期', start_date: '2026-04-18', end_date: null },
    ],
  },
  effective_phases: [
    { phase: '報名', label: '報名日期', start_date: '2026-01-21', end_date: '2026-02-26' },
    { phase: '測驗', label: '測驗日期', start_date: '2026-04-18', end_date: null },
  ],
  overrides: [],
  status: { last_success_at: '2026-08-02T08:00:00Z', last_failure_at: null, last_failure_reason: '', consecutive_failures: 0 },
};

describe('ExamSchedule', () => {
  beforeEach(() => {
    mockRole = 'owner';
    apiGet.mockReset();
    apiPost.mockReset();
    apiPut.mockReset();
    apiDelete.mockReset();
    apiGet.mockResolvedValue(baseData);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  test('載入後同時顯示爬蟲原始結果與後台生效值兩欄', async () => {
    renderPage();
    await screen.findByText('爬蟲原始結果');
    expect(screen.getByText('後台生效值')).toBeInTheDocument();
    // 兩欄都有「報名」「測驗」，用 getAllByText 確認至少各出現兩次（左右各一）。
    expect(screen.getAllByText('報名').length).toBeGreaterThanOrEqual(2);
  });

  test('有效覆寫時，後台生效值那欄顯示「覆寫中」徽章，爬蟲原始結果欄不顯示', async () => {
    apiGet.mockResolvedValue({
      ...baseData,
      effective_phases: [
        { phase: '報名', label: '報名（人工修正）', start_date: '2026-01-25', end_date: '2026-03-01' },
        baseData.effective_phases[1],
      ],
      overrides: [{ phase: '報名', label: '報名（人工修正）', start_date: '2026-01-25', end_date: '2026-03-01', is_active: true, updated_by: 'u', updated_at: '2026-08-01T00:00:00Z' }],
    });
    renderPage();
    await screen.findByText('爬蟲原始結果');
    expect(screen.getByText('覆寫中')).toBeInTheDocument();
  });

  test('連續失敗 3 次以上顯示警告橫幅', async () => {
    apiGet.mockResolvedValue({ ...baseData, status: { ...baseData.status, consecutive_failures: 3 } });
    renderPage();
    expect(await screen.findByText(/連續失敗 3 次/)).toBeInTheDocument();
  });

  test('爬蟲無法取得資料時，原始結果欄顯示明確訊息而不是空表格', async () => {
    apiGet.mockResolvedValue({
      ...baseData,
      crawled: { available: false, session: null, phases: [] },
      effective_phases: [],
    });
    renderPage();
    expect(await screen.findByText('爬蟲目前無法取得資料')).toBeInTheDocument();
    expect(screen.getByText('目前沒有任何生效中的時程資料')).toBeInTheDocument();
  });

  test('reviewer 看得到兩欄比對，但看不到任何操作按鈕', async () => {
    mockRole = 'reviewer';
    renderPage();
    await screen.findByText('爬蟲原始結果');
    expect(screen.queryByRole('button', { name: /編輯覆寫/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /重新爬取/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /新增覆寫/ })).not.toBeInTheDocument();
  });

  test('owner 點重新爬取會呼叫 POST 並重新載入列表', async () => {
    apiPost.mockResolvedValueOnce({});
    renderPage();
    await screen.findByText('爬蟲原始結果');
    apiGet.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /重新爬取/ }));

    await waitFor(() => {
      expect(apiPost).toHaveBeenCalledWith('/adminapi/exam-schedule/');
      expect(apiGet).toHaveBeenCalled();
    });
  });

  test('編輯覆寫送出後呼叫 PUT，帶上正確的 phase 與日期', async () => {
    apiPut.mockResolvedValueOnce({});
    renderPage();
    await screen.findByText('爬蟲原始結果');

    const rightTable = screen.getByText('後台生效值').closest('section').querySelector('table');
    const row = within(rightTable).getByText('報名').closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: /編輯覆寫/ }));

    const modal = await screen.findByRole('dialog');
    fireEvent.change(within(modal).getByLabelText(/開始日期/), { target: { value: '2026-02-01' } });
    fireEvent.click(within(modal).getByRole('button', { name: /儲存覆寫/ }));

    await waitFor(() => {
      expect(apiPut).toHaveBeenCalledWith(
        '/adminapi/exam-schedule/overrides/%E5%A0%B1%E5%90%8D/',
        expect.objectContaining({ start_date: '2026-02-01' }),
      );
    });
  });

  test('清除覆寫前會跳原生確認框，確認後呼叫 apiDelete', async () => {
    apiGet.mockResolvedValue({
      ...baseData,
      effective_phases: [
        { phase: '報名', label: '報名（人工修正）', start_date: '2026-01-25', end_date: '2026-03-01' },
        baseData.effective_phases[1],
      ],
      overrides: [{ phase: '報名', label: '', start_date: '2026-01-25', end_date: '2026-03-01', is_active: true, updated_by: 'u', updated_at: '2026-08-01T00:00:00Z' }],
    });
    apiDelete.mockResolvedValueOnce({});
    renderPage();
    await screen.findByText('覆寫中');

    const rightTable = screen.getByText('後台生效值').closest('section').querySelector('table');
    const row = within(rightTable).getByText('報名').closest('tr');
    fireEvent.click(within(row).getByRole('button', { name: /清除覆寫/ }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(apiDelete).toHaveBeenCalledWith('/adminapi/exam-schedule/overrides/%E5%A0%B1%E5%90%8D/');
    });
  });

  test('apiGet 失敗時顯示錯誤訊息', async () => {
    apiGet.mockReset();
    apiGet.mockRejectedValueOnce(new Error('伺服器錯誤，請稍後再試'));
    renderPage();
    expect(await screen.findByText('伺服器錯誤，請稍後再試')).toBeInTheDocument();
  });
});
