import {
    beforeEach, describe, expect, test, vi,
} from 'vitest';
import {
    fireEvent, render, screen, waitFor, within,
} from '@testing-library/react';
import AiUsage from './AiUsage';
import { apiGet } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
    apiGet: vi.fn(),
}));

let mockRole = 'analyst';
vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

const bucket = (extra = {}) => ({
    calls: 0,
    errors: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    costIncomplete: false,
    ...extra,
});

const summary = (overrides = {}) => ({
    days: 7,
    totals: {
        ...bucket({
            calls: 1250, errors: 25, inputTokens: 900000, outputTokens: 120000, costUsd: 3.2468,
        }),
        cacheHitRate: 0.4231,
        latencyP50Ms: 1800,
        latencyP95Ms: 6400,
        latencySampleSize: 1225,
    },
    daily: [
        bucket({ date: '2026-10-20', calls: 400, costUsd: 1 }),
        bucket({ date: '2026-10-21', calls: 850, costUsd: 2.2468 }),
    ],
    byFeature: [
        bucket({ feature: 'chat', calls: 900, costUsd: 2.5 }),
        bucket({ feature: 'future_feature', calls: 10, costUsd: 0.1 }),
    ],
    byModel: [bucket({ model: 'claude-sonnet-5', calls: 1250, costUsd: 3.2468 })],
    byStatus: [
        { status: 'ok', calls: 1225 },
        { status: 'timeout', calls: 25 },
    ],
    topUsers: [bucket({ uid: 'user-heavy', calls: 300, costUsd: 0.9 })],
    priceNote: '費用依公開價目估算，實際金額以 Anthropic Console 為準。',
    ...overrides,
});

describe('AiUsage', () => {
    beforeEach(() => {
        mockRole = 'analyst';
        apiGet.mockReset();
    });

    test('載入後顯示總覽、估算說明與各分組表格', async () => {
        apiGet.mockResolvedValue(summary());
        render(<AiUsage />);

        expect(await screen.findByText('費用依公開價目估算，實際金額以 Anthropic Console 為準。')).toBeInTheDocument();
        expect(apiGet).toHaveBeenCalledWith('/adminapi/ai-usage/?days=7');

        const overview = screen.getByRole('region', { name: '用量總覽' });
        expect(within(overview).getByText('1,250')).toBeInTheDocument();
        expect(within(overview).getByText('2.0%')).toBeInTheDocument(); // 25 / 1250
        expect(within(overview).getByText('US$3.25')).toBeInTheDocument();
        expect(within(overview).getByText('42.3%')).toBeInTheDocument();
        expect(within(overview).getByText('1,800 ms')).toBeInTheDocument();
        expect(within(overview).getByText('6,400 ms')).toBeInTheDocument();

        expect(screen.getByText('AI 助手聊天')).toBeInTheDocument();
        // 不認得的功能代號原樣顯示，不會整列消失
        expect(screen.getByText('future_feature')).toBeInTheDocument();
        expect(screen.getByText('逾時')).toBeInTheDocument();
        expect(screen.getByText('user-heavy')).toBeInTheDocument();
        // 每日表格最新日期在最上面
        const dailyRows = screen.getAllByRole('row').filter((row) => /^2026-10-2/.test(row.textContent));
        expect(dailyRows[0]).toHaveTextContent('2026-10-21');
    });

    test('切換統計區間會重新查詢', async () => {
        apiGet.mockResolvedValue(summary());
        render(<AiUsage />);
        await screen.findByRole('region', { name: '用量總覽' });

        fireEvent.change(screen.getByLabelText('統計區間'), { target: { value: '30' } });

        await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/adminapi/ai-usage/?days=30'));
    });

    test('沒有資料時延遲與快取命中率顯示「無資料」，表格顯示空狀態', async () => {
        apiGet.mockResolvedValue(summary({
            totals: {
                ...bucket(), cacheHitRate: null, latencyP50Ms: null, latencyP95Ms: null, latencySampleSize: 0,
            },
            daily: [bucket({ date: '2026-10-21' })],
            byFeature: [],
            byModel: [],
            byStatus: [],
            topUsers: [],
        }));
        render(<AiUsage />);

        const overview = await screen.findByRole('region', { name: '用量總覽' });
        expect(within(overview).getAllByText('無資料')).toHaveLength(4); // 失敗比例、快取命中率、P50、P95
        expect(screen.getAllByText('這段期間沒有資料').length).toBeGreaterThanOrEqual(4);
    });

    test('有模型沒有價目時，總覽與該列標示「不完整」並說明費用偏低', async () => {
        apiGet.mockResolvedValue(summary({
            totals: { ...summary().totals, costIncomplete: true },
            byModel: [bucket({ model: 'some-future-model', calls: 5, costUsd: 0, costIncomplete: true })],
        }));
        render(<AiUsage />);

        await screen.findByRole('region', { name: '用量總覽' });
        expect(screen.getAllByText('不完整').length).toBeGreaterThanOrEqual(2);
        expect(screen.getByText(/下方標示「不完整」的費用會偏低/)).toBeInTheDocument();
    });

    test('查詢失敗時顯示錯誤訊息', async () => {
        apiGet.mockRejectedValue(new Error('伺服器忙碌'));
        render(<AiUsage />);

        expect(await screen.findByText('伺服器忙碌')).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: '用量總覽' })).not.toBeInTheDocument();
    });

    test('先後切換區間時，較晚回來的舊請求不會覆蓋新區間的結果', async () => {
        let resolveSlow;
        apiGet
            .mockResolvedValueOnce(summary())
            .mockImplementationOnce(() => new Promise((resolve) => { resolveSlow = resolve; }))
            .mockResolvedValueOnce(summary({ priceNote: '90 天的結果' }));
        render(<AiUsage />);
        await screen.findByRole('region', { name: '用量總覽' });

        fireEvent.change(screen.getByLabelText('統計區間'), { target: { value: '30' } });
        fireEvent.change(screen.getByLabelText('統計區間'), { target: { value: '90' } });
        expect(await screen.findByText('90 天的結果')).toBeInTheDocument();

        resolveSlow(summary({ priceNote: '30 天的舊結果' }));
        await waitFor(() => expect(screen.queryByText('30 天的舊結果')).not.toBeInTheDocument());
        expect(screen.getByText('90 天的結果')).toBeInTheDocument();
    });

    test('換區間後查詢失敗，不再顯示上一個區間的數字', async () => {
        apiGet.mockResolvedValueOnce(summary()).mockRejectedValueOnce(new Error('查詢失敗'));
        render(<AiUsage />);
        await screen.findByRole('region', { name: '用量總覽' });

        fireEvent.change(screen.getByLabelText('統計區間'), { target: { value: '30' } });

        expect(await screen.findByText('查詢失敗')).toBeInTheDocument();
        expect(screen.queryByRole('region', { name: '用量總覽' })).not.toBeInTheDocument();
    });

    test('後端缺欄位或給了 null、負數時不會壞掉，也不會顯示 NaN', async () => {
        apiGet.mockResolvedValue({
            totals: { calls: -5, errors: null, costUsd: Number.NaN },
            daily: [null, { date: '2026-10-21', calls: 1, costUsd: -3 }],
            byFeature: null,
        });
        render(<AiUsage />);

        const overview = await screen.findByRole('region', { name: '用量總覽' });
        expect(overview.textContent).not.toMatch(/NaN|Infinity|-\d/);
        expect(screen.getAllByText('這段期間沒有資料').length).toBeGreaterThanOrEqual(3);
    });

    test('沒有後台角色的使用者看到無權限提示，也不發出請求', () => {
        mockRole = 'user';
        render(<AiUsage />);

        expect(screen.getByText('你的角色沒有權限檢視 AI 用量。')).toBeInTheDocument();
        expect(apiGet).not.toHaveBeenCalled();
    });
});
