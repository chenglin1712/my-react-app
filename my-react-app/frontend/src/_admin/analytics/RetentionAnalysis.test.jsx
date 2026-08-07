import {
    beforeEach,
    describe,
    expect,
    test,
    vi,
} from 'vitest';
import {
    render,
    screen,
    waitFor,
    within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RetentionAnalysis from './RetentionAnalysis';
import { apiGet } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
    apiGet: vi.fn(),
}));

const retentionData = {
    cohorts: [
        {
            cohort_start: '2026-07-27',
            cohort_size: 12,
            retention: [
                {
                    week_offset: 0,
                    active_count: 12,
                    rate: 1,
                },
                {
                    week_offset: 1,
                    active_count: 8,
                    rate: 0.6667,
                },
                {
                    week_offset: 2,
                    active_count: 5,
                    rate: 0.4167,
                },
            ],
        },
        {
            cohort_start: '2026-08-03',
            cohort_size: 5,
            retention: [
                {
                    week_offset: 0,
                    active_count: 5,
                    rate: 1,
                },
            ],
        },
    ],
    max_weeks: 12,
};

function renderPage() {
    return render(
        <MemoryRouter>
            <RetentionAnalysis />
        </MemoryRouter>,
    );
}

describe('RetentionAnalysis', () => {
    beforeEach(() => {
        apiGet.mockReset();
        apiGet.mockResolvedValue(retentionData);
    });

    test('資料載入期間顯示 spinner', () => {
        apiGet.mockImplementation(() => new Promise(() => {}));

        renderPage();

        expect(
            screen.getByRole('status', {
                name: '載入留存資料',
            }),
        ).toBeInTheDocument();

        expect(screen.getByText('載入中')).toBeInTheDocument();
    });

    test('元件掛載時呼叫留存分析 API', async () => {
        renderPage();

        await screen.findByText('2026/07/27 那週（12 人）');

        expect(apiGet).toHaveBeenCalledTimes(1);
        expect(apiGet).toHaveBeenCalledWith(
            '/adminapi/analytics/retention/',
        );
    });

    test('API 失敗時顯示錯誤訊息', async () => {
        apiGet.mockRejectedValueOnce(
            new Error('留存資料載入失敗，請稍後再試'),
        );

        renderPage();

        expect(
            await screen.findByText('留存資料載入失敗，請稍後再試'),
        ).toBeInTheDocument();

        expect(
            screen.getByRole('heading', {
                name: '留存分析',
            }),
        ).toBeInTheDocument();

        expect(
            screen.queryByRole('table'),
        ).not.toBeInTheDocument();
    });

    test('沒有世代資料時顯示空狀態', async () => {
        apiGet.mockResolvedValueOnce({
            cohorts: [],
            max_weeks: 12,
        });

        renderPage();

        expect(
            await screen.findByText('尚無留存資料'),
        ).toBeInTheDocument();

        expect(
            screen.queryByRole('table'),
        ).not.toBeInTheDocument();
    });

    test('正確顯示世代、固定週次欄位與留存百分比', async () => {
        renderPage();

        expect(
            await screen.findByText('2026/07/27 那週（12 人）'),
        ).toBeInTheDocument();

        expect(
            screen.getByText('2026/08/03 那週（5 人）'),
        ).toBeInTheDocument();

        expect(
            screen.getByRole('columnheader', {
                name: '第 0 週',
            }),
        ).toBeInTheDocument();

        expect(
            screen.getByRole('columnheader', {
                name: '第 11 週',
            }),
        ).toBeInTheDocument();

        expect(
            screen.queryByRole('columnheader', {
                name: '第 12 週',
            }),
        ).not.toBeInTheDocument();

        expect(
            screen.getAllByText('100%'),
        ).toHaveLength(2);

        expect(
            screen.getByText('67%'),
        ).toBeInTheDocument();

        expect(
            screen.getByText('42%'),
        ).toBeInTheDocument();
    });

    test('尚未經過的週次顯示破折號且不顯示百分比', async () => {
        renderPage();

        await screen.findByText('2026/08/03 那週（5 人）');

        const pendingCell = screen.getByRole('cell', {
            name: '第 1 週尚未經過',
        });

        expect(
            within(pendingCell).getByText('—'),
        ).toBeInTheDocument();

        expect(
            within(pendingCell).queryByText(/%/),
        ).not.toBeInTheDocument();

        expect(pendingCell).toHaveAttribute(
            'title',
            '這一週尚未經過',
        );
    });

    test('後端尚未回應前不會提前顯示空狀態', async () => {
        let resolveRequest;

        apiGet.mockImplementationOnce(() => new Promise((resolve) => {
            resolveRequest = resolve;
        }));

        renderPage();

        expect(
            screen.queryByText('尚無留存資料'),
        ).not.toBeInTheDocument();

        resolveRequest({
            cohorts: [],
            max_weeks: 12,
        });

        await waitFor(() => {
            expect(
                screen.getByText('尚無留存資料'),
            ).toBeInTheDocument();
        });
    });
});
