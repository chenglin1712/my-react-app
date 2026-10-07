import {
    beforeEach, describe, expect, test, vi,
} from 'vitest';
import {
    fireEvent, render, screen, waitFor,
} from '@testing-library/react';
import MorphologyCapabilities from './MorphologyCapabilities';
import formatRatio from './formatRatio';
import { apiGet } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({ apiGet: vi.fn() }));

let mockRole = 'owner';
vi.mock('../../userServives/authContext', () => ({
    useAuth: () => ({ userData: { role: mockRole }, loading: false }),
}));

const ratio = (k, n, value, lo, hi) => ({
    k, n, value, lo, hi,
});
const FAMILIES = ['stem', 'sub1', 'indel1', 'sub2', 'rand'];

const tribe = (slug, overrides = {}) => ({
    tribe: slug,
    layers: {
        input_freshness: 'fresh',
        artifact_integrity: 'valid',
        runtime_rebuild_loadable: true,
        gate: 'passed',
    },
    snapshot_stale: false,
    artifact_enabled: true,
    reason: '',
    loadable_reason: '',
    problems: [],
    inputs: { n_headwords: 8680, n_pairs: 5242 },
    metrics: {
        real_evaluated: 962,
        accepted: 79,
        release_rate: ratio(79, 962, 0.082121, 0.066, 0.101),
        precision: ratio(78, 79, 0.987342, 0.932, 0.998),
        wrong_root_rate: ratio(1, 79, 0.012658, 0.002, 0.068),
        false_accept: Object.fromEntries(FAMILIES.map((f) => [f, ratio(0, 1000, 0, 0, 0.0038)])),
    },
    ...overrides,
});

const disabled = (slug) => tribe(slug, {
    layers: {
        input_freshness: 'fresh', artifact_integrity: 'valid', runtime_rebuild_loadable: false, gate: 'disabled',
    },
    artifact_enabled: false,
    reason: '資料不足：訓練資料歸納不出任何規則',
    loadable_reason: '放行檔標示 paiwan 停用',
    metrics: null,
});

const respond = (tribes, extra = {}) => ({
    report: {
        report_version: 1, artifact_generator: 'morphology_calibration/2', artifact_error: null, tribes, ...extra,
    },
    generated_at: '2026-10-07T02:00:00Z',
    cached: false,
    cache_ttl_seconds: 60,
});

describe('formatRatio', () => {
    test('顯示百分比與區間，沒有資料時不是 0%', () => {
        expect(formatRatio(ratio(79, 962, 0.082121, 0.066, 0.101))).toBe('8.2%（6.6%–10.1%）');
        expect(formatRatio(ratio(0, 0, null, 0, 1))).toBe('無資料');
        expect(formatRatio(ratio(0, 1000, 0, 0, 0.0038))).toBe('0.0%（0.0%–0.4%）');
        expect(formatRatio(undefined)).toBe('—');
    });
});

describe('MorphologyCapabilities', () => {
    beforeEach(() => {
        mockRole = 'owner';
        apiGet.mockReset();
    });

    test('顯示四層狀態與指標', async () => {
        apiGet.mockResolvedValue(respond([tribe('amis')]));
        render(<MorphologyCapabilities />);

        expect(await screen.findByText('阿美語')).toBeInTheDocument();
        expect(screen.getByText('輸入一致')).toBeInTheDocument();
        expect(screen.getByText('放行檔完整')).toBeInTheDocument();
        expect(screen.getByText('可重建載入')).toBeInTheDocument();
        expect(screen.getByText('閘門通過')).toBeInTheDocument();
        expect(screen.getByText('8.2%（6.6%–10.1%）')).toBeInTheDocument();
        expect(screen.getByText('79／962')).toBeInTheDocument();
        expect(apiGet).toHaveBeenCalledWith('/adminapi/system/morphology-capabilities/');
    });

    test('停用的族語顯示原因與無法載入，不顯示指標', async () => {
        apiGet.mockResolvedValue(respond([disabled('paiwan')]));
        render(<MorphologyCapabilities />);

        expect(await screen.findByText('排灣語')).toBeInTheDocument();
        expect(screen.getByText('已停用')).toBeInTheDocument();
        expect(screen.getByText('無法載入')).toBeInTheDocument();
        expect(screen.getByText('資料不足：訓練資料歸納不出任何規則')).toBeInTheDocument();
        expect(screen.queryByText('8.2%（6.6%–10.1%）')).not.toBeInTheDocument();
    });

    test('舊資料快照的列有明確標示與說明，數字仍顯示', async () => {
        apiGet.mockResolvedValue(respond([
            tribe('kavalan', {
                snapshot_stale: true,
                layers: {
                    input_freshness: 'stale',
                    artifact_integrity: 'valid',
                    runtime_rebuild_loadable: false,
                    gate: 'passed',
                },
                loadable_reason: '葛瑪蘭語的辭典詞庫內容與放行檔不一致',
            }),
        ]));
        render(<MorphologyCapabilities />);

        expect(await screen.findByText('舊資料快照')).toBeInTheDocument();
        expect(screen.getByText(/辭典之後已變動，不代表現況/)).toBeInTheDocument();
        expect(screen.getByText('8.2%（6.6%–10.1%）')).toBeInTheDocument();
        expect(screen.getByText('葛瑪蘭語的辭典詞庫內容與放行檔不一致')).toBeInTheDocument();
    });

    test('放行檔異常時列出問題且不顯示指標', async () => {
        apiGet.mockResolvedValue(respond([
            tribe('amis', {
                layers: {
                    input_freshness: 'fresh',
                    artifact_integrity: 'invalid',
                    runtime_rebuild_loadable: false,
                    gate: 'unknown',
                },
                problems: ['correct + wrong_root ≠ accepted'],
                metrics: null,
            }),
        ]));
        render(<MorphologyCapabilities />);

        expect(await screen.findByText('放行檔異常')).toBeInTheDocument();
        expect(screen.getByText('correct + wrong_root ≠ accepted')).toBeInTheDocument();
        expect(screen.queryByText('閘門通過')).not.toBeInTheDocument();
    });

    test('放行檔讀取失敗時顯示警告', async () => {
        apiGet.mockResolvedValue(respond([tribe('amis')], { artifact_error: 'FileNotFoundError' }));
        render(<MorphologyCapabilities />);

        expect(await screen.findByText(/放行檔讀取失敗/)).toBeInTheDocument();
        expect(screen.getByText(/FileNotFoundError/)).toBeInTheDocument();
    });

    test('API 失敗時顯示錯誤訊息，可重新整理後恢復', async () => {
        apiGet.mockRejectedValueOnce(new Error('目前無法產生形態分析能力報表，請稍後再試'));
        apiGet.mockResolvedValueOnce(respond([tribe('amis')]));
        render(<MorphologyCapabilities />);

        expect(await screen.findByText('目前無法產生形態分析能力報表，請稍後再試')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /重新整理/ }));
        expect(await screen.findByText('阿美語')).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByText(/目前無法產生/)).not.toBeInTheDocument());
    });

    test('重新整理失敗（例如被撤權）時清掉舊報表，不留下過期數字', async () => {
        apiGet.mockResolvedValueOnce(respond([tribe('amis')]));
        apiGet.mockRejectedValueOnce(new Error('沒有權限'));
        render(<MorphologyCapabilities />);

        expect(await screen.findByText('阿美語')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /重新整理/ }));
        expect(await screen.findByText('沒有權限')).toBeInTheDocument();
        expect(screen.queryByText('阿美語')).not.toBeInTheDocument();
    });

    test('角色在載入後變成沒有權限時，報表被隱藏', async () => {
        apiGet.mockResolvedValue(respond([tribe('amis')]));
        const { rerender } = render(<MorphologyCapabilities />);
        expect(await screen.findByText('阿美語')).toBeInTheDocument();

        mockRole = 'learner';
        rerender(<MorphologyCapabilities />);
        expect(screen.getByText('你的角色沒有權限檢視形態分析能力。')).toBeInTheDocument();
        expect(screen.queryByText('阿美語')).not.toBeInTheDocument();
    });

    test('沒有後台角色的使用者看到無權限，且不呼叫 API', () => {
        mockRole = 'learner';
        render(<MorphologyCapabilities />);

        expect(screen.getByText('你的角色沒有權限檢視形態分析能力。')).toBeInTheDocument();
        expect(apiGet).not.toHaveBeenCalled();
    });

    test('分析師等唯讀角色也能檢視', async () => {
        mockRole = 'analyst';
        apiGet.mockResolvedValue(respond([tribe('amis')]));
        render(<MorphologyCapabilities />);

        expect(await screen.findByText('阿美語')).toBeInTheDocument();
    });
});
