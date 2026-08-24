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
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';
import PronunciationCommunity from './PronunciationCommunity';
import { submitReport } from '../../../src/userServives/reportService';

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  getDocs: vi.fn(),
  limit: vi.fn(),
  orderBy: vi.fn(),
  query: vi.fn(),
}));

vi.mock('../../../../firebase', () => ({
  db: { name: 'mock-db' },
}));

vi.mock('../../../src/userServives/reportService', () => ({
  submitReport: vi.fn(),
}));

const timestamp = (dateString) => ({
  toDate: () => new Date(dateString),
});

const recordingDocs = [
  {
    id: 'recording-a',
    data: () => ({
      word: 'lokah',
      tribe: 'tayal',
      uid: 'private-user-a',
      score: 92,
      storageUrl: 'https://example.com/lokah-a.webm',
      createdAt: timestamp('2026-08-03T08:00:00Z'),
    }),
  },
  {
    id: 'recording-b',
    data: () => ({
      word: 'lokah',
      tribe: 'tayal',
      uid: 'private-user-b',
      score: 85,
      storageUrl: 'https://example.com/lokah-b.webm',
      createdAt: timestamp('2026-08-02T08:00:00Z'),
    }),
  },
  {
    id: 'recording-c',
    data: () => ({
      word: 'mhuway',
      tribe: 'tayal',
      uid: 'private-user-c',
      score: 78,
      storageUrl: 'https://example.com/mhuway.webm',
      createdAt: timestamp('2026-08-01T08:00:00Z'),
    }),
  },
];

function renderCommunity(tribe = 'tayal') {
  return render(
    <MemoryRouter>
      <PronunciationCommunity tribe={tribe} />
    </MemoryRouter>,
  );
}

describe('PronunciationCommunity', () => {
  beforeEach(() => {
    collection.mockReset();
    getDocs.mockReset();
    limit.mockReset();
    orderBy.mockReset();
    query.mockReset();
    submitReport.mockReset();

    collection.mockReturnValue('recordings-collection');
    orderBy.mockReturnValue('created-at-order');
    limit.mockReturnValue('recording-limit');
    query.mockReturnValue('recordings-query');
    getDocs.mockResolvedValue({ docs: recordingDocs });
    submitReport.mockResolvedValue(undefined);
  });

  test('依 tribe 查詢最近 200 筆錄音', async () => {
    renderCommunity();

    expect(await screen.findByText('lokah')).toBeInTheDocument();

    expect(collection).toHaveBeenCalledWith(
      { name: 'mock-db' },
      'pronunciations',
      'tayal',
      'recordings',
    );
    expect(orderBy).toHaveBeenCalledWith('createdAt', 'desc');
    expect(limit).toHaveBeenCalledWith(200);
    expect(query).toHaveBeenCalledWith(
      'recordings-collection',
      'created-at-order',
      'recording-limit',
    );
    expect(getDocs).toHaveBeenCalledWith('recordings-query');
  });

  test('依 word 分組，並在同一個詞下顯示所有錄音', async () => {
    renderCommunity();

    const lokahHeading = await screen.findByRole('heading', {
      name: 'lokah',
    });
    const group = lokahHeading.closest('section');

    expect(within(group).getByText('2 筆錄音')).toBeInTheDocument();
    expect(within(group).getAllByLabelText('lokah 的社群示範發音'))
      .toHaveLength(2);

    expect(screen.getByRole('heading', { name: 'mhuway' }))
      .toBeInTheDocument();
  });

  test('顯示分數與日期，但不揭露 uid', async () => {
    renderCommunity();

    expect(await screen.findByText('92 分')).toBeInTheDocument();
    expect(screen.getByText('85 分')).toBeInTheDocument();
    expect(screen.queryByText('private-user-a')).not.toBeInTheDocument();
    expect(screen.queryByText('private-user-b')).not.toBeInTheDocument();
  });

  test('audio 使用 recording 的 storageUrl', async () => {
    renderCommunity();

    const audio = await screen.findAllByLabelText('lokah 的社群示範發音');

    expect(audio[0]).toHaveAttribute(
      'src',
      'https://example.com/lokah-a.webm',
    );
  });

  test('送出一般原因檢舉時保留 Firestore 文件 ID 與 tribe', async () => {
    renderCommunity();

    const lokahHeading = await screen.findByRole('heading', {
      name: 'lokah',
    });
    const group = lokahHeading.closest('section');

    fireEvent.click(
      within(group).getAllByRole('button', { name: '檢舉' })[0],
    );

    const modal = screen.getByRole('dialog');
    expect(within(modal).getByText('詞彙：lokah')).toBeInTheDocument();

    fireEvent.click(
      within(modal).getByRole('radio', { name: '內容錯誤' }),
    );
    fireEvent.click(
      within(modal).getByRole('button', { name: '送出檢舉' }),
    );

    await waitFor(() => {
      expect(submitReport).toHaveBeenCalledWith({
        targetType: 'recording',
        targetId: 'recording-a',
        targetTribe: 'tayal',
        reason: 'wrong_content',
        reasonText: '',
      });
    });

    expect(
      await screen.findByText(
        '已送出檢舉，感謝您協助維護社群品質',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('選擇其他時必須填寫補充說明', async () => {
    renderCommunity();

    const buttons = await screen.findAllByRole('button', {
      name: '檢舉',
    });
    fireEvent.click(buttons[0]);

    const modal = screen.getByRole('dialog');
    fireEvent.click(within(modal).getByRole('radio', { name: '其他' }));

    const submitButton = within(modal).getByRole('button', {
      name: '送出檢舉',
    });
    expect(submitButton).toBeDisabled();

    fireEvent.change(within(modal).getByLabelText('補充說明'), {
      target: { value: '  錄音內容與詞彙無關  ' },
    });
    expect(submitButton).not.toBeDisabled();

    fireEvent.click(submitButton);

    await waitFor(() => {
      expect(submitReport).toHaveBeenCalledWith({
        targetType: 'recording',
        targetId: 'recording-a',
        targetTribe: 'tayal',
        reason: 'other',
        reasonText: '錄音內容與詞彙無關',
      });
    });
  });

  test('Firestore 查詢失敗時顯示通用錯誤訊息，不會把原始例外訊息顯示給使用者', async () => {
    getDocs.mockRejectedValueOnce(new Error('錄音載入失敗'));

    renderCommunity();

    expect(await screen.findByText('載入社群錄音失敗，請稍後再試。'))
      .toBeInTheDocument();
  });

  test('submitReport 失敗時保留 Modal 並顯示通用錯誤（不是原始例外訊息）', async () => {
    submitReport.mockRejectedValueOnce(new Error('檢舉送出失敗'));

    renderCommunity();

    const buttons = await screen.findAllByRole('button', {
      name: '檢舉',
    });
    fireEvent.click(buttons[0]);
    fireEvent.click(
      screen.getByRole('button', { name: '送出檢舉' }),
    );

    expect(await screen.findByText('送出檢舉失敗，請稍後再試。'))
      .toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('沒有錄音時顯示空狀態', async () => {
    getDocs.mockResolvedValueOnce({ docs: [] });

    renderCommunity();

    expect(await screen.findByText('目前還沒有示範錄音'))
      .toBeInTheDocument();
  });

  test('切換族語時，前一次還沒回來的請求即使晚一步解析也不會覆蓋新族語的結果（回歸測試：原本沒有取消機制）', async () => {
    let resolveFirst;
    getDocs.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    const { rerender } = renderCommunity('tayal');

    getDocs.mockResolvedValueOnce({ docs: [recordingDocs[2]] });
    rerender(
      <MemoryRouter>
        <PronunciationCommunity tribe="amis" />
      </MemoryRouter>,
    );
    expect(await screen.findByText('mhuway')).toBeInTheDocument();

    resolveFirst({ docs: [recordingDocs[0]] });
    await Promise.resolve();
    await Promise.resolve();

    // 泰雅語那次過期的請求現在才回來，不該再把畫面換回它的結果
    expect(screen.queryByText('lokah')).not.toBeInTheDocument();
    expect(screen.getByText('mhuway')).toBeInTheDocument();
  });
});
