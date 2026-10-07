import { useCallback, useEffect, useState } from 'react';
import {
    Alert, Badge, Button, Spinner, Table,
} from 'react-bootstrap';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { apiGet } from '../../../utils/apiClient';
import { STAFF_ROLES } from '../constants/roles';
import formatRatio from './formatRatio';
import '../../../static/css/_admin/system.css';

const TRIBE_NAMES = {
    tayal: '泰雅語',
    amis: '阿美語',
    bunun: '布農語',
    kavalan: '葛瑪蘭語',
    paiwan: '排灣語',
};

const FAMILY_LABELS = {
    stem: '詞幹', sub1: '替換 1', indel1: '增刪 1', sub2: '替換 2', rand: '隨機',
};

// 每一層各自回答不同的問題，不合併成單一「OK」；顏色只是輔助，文字才是主要資訊。
const FRESHNESS = {
    fresh: ['success', '輸入一致'],
    stale: ['warning', '舊資料快照'],
    unknown: ['secondary', '無法比對'],
};
const INTEGRITY = {
    valid: ['success', '放行檔完整'],
    invalid: ['danger', '放行檔異常'],
    unknown: ['secondary', '無放行檔資料'],
};
const GATE = {
    passed: ['success', '閘門通過'],
    failed: ['danger', '閘門未通過'],
    disabled: ['secondary', '已停用'],
    unknown: ['secondary', '閘門未知'],
};

function StatusBadge({ map, value }) {
    const [variant, label] = map[value] ?? ['secondary', String(value)];
    return <Badge bg={variant} className="system-morph-badge">{label}</Badge>;
}

function TribeRow({ tribe }) {
    const { layers, metrics } = tribe;
    const loadable = layers.runtime_rebuild_loadable;
    return (
        <tr className={tribe.snapshot_stale ? 'system-morph-stale' : undefined}>
            <td>
                <strong>{TRIBE_NAMES[tribe.tribe] ?? tribe.tribe}</strong>
                <div className="system-morph-muted">
                    詞庫 {tribe.inputs.n_headwords}／配對 {tribe.inputs.n_pairs}
                </div>
            </td>
            <td>
                <div className="system-morph-badges">
                    <StatusBadge map={FRESHNESS} value={layers.input_freshness} />
                    <StatusBadge map={INTEGRITY} value={layers.artifact_integrity} />
                    <Badge bg={loadable ? 'success' : 'secondary'} className="system-morph-badge">
                        {loadable ? '可重建載入' : '無法載入'}
                    </Badge>
                    <StatusBadge map={GATE} value={layers.gate} />
                </div>
                {tribe.snapshot_stale && (
                    <div className="system-morph-note">
                        下列數字是放行檔當時的辭典上量到的成績，辭典之後已變動，不代表現況。
                    </div>
                )}
                {!loadable && tribe.loadable_reason && (
                    <div className="system-morph-muted">{tribe.loadable_reason}</div>
                )}
                {tribe.problems.length > 0 && (
                    <ul className="system-morph-problems">
                        {tribe.problems.map((problem) => <li key={problem}>{problem}</li>)}
                    </ul>
                )}
            </td>
            {metrics ? (
                <>
                    <td>
                        {formatRatio(metrics.release_rate)}
                        <div className="system-morph-muted">
                            {metrics.accepted}／{metrics.real_evaluated}
                        </div>
                    </td>
                    <td>
                        {formatRatio(metrics.precision)}
                        <div className="system-morph-muted">
                            錯詞根 {formatRatio(metrics.wrong_root_rate)}
                        </div>
                    </td>
                    <td>
                        <ul className="system-morph-fa">
                            {Object.entries(FAMILY_LABELS).map(([family, label]) => (
                                <li key={family}>
                                    {label}
                                    {' '}
                                    {formatRatio(metrics.false_accept[family])}
                                </li>
                            ))}
                        </ul>
                    </td>
                </>
            ) : (
                <td colSpan="3" className="system-morph-muted">
                    {tribe.reason || '沒有可顯示的最終測試指標'}
                </td>
            )}
        </tr>
    );
}

export default function MorphologyCapabilities() {
    const { userData } = useAuth();
    const canView = STAFF_ROLES.includes(userData?.role);

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(canView);
    const [error, setError] = useState('');

    const load = useCallback(async (isActive = () => true) => {
        setLoading(true);
        setError('');
        try {
            const response = await apiGet('/adminapi/system/morphology-capabilities/');
            if (isActive()) setData(response);
        } catch (err) {
            // 失敗（含被撤權的 401／403）就清掉舊報表，不讓使用者以為舊數字還是現況
            if (isActive()) {
                setData(null);
                setError(err.message);
            }
        } finally {
            if (isActive()) setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!canView) return undefined;
        let active = true;
        load(() => active);
        return () => {
            active = false;
        };
    }, [canView, load]);

    // 沒有權限時一律不顯示報表，即使先前（角色變更前）已經載入過
    const report = canView ? data?.report : undefined;

    return (
        <main className="admin-page system-page">
            <div className="admin-page-heading">
                <div>
                    <h1>形態分析能力</h1>
                    <p>各族語詞形分析器在最終測試上的放行率、精確率與錯放行率（Wilson 95% 區間）。唯讀。</p>
                </div>
                {canView && (
                    <Button variant="outline-secondary" disabled={loading} onClick={() => load()}>
                        {loading ? <Spinner animation="border" size="sm" /> : <RefreshCw size={16} />}
                        重新整理
                    </Button>
                )}
            </div>

            {!canView && <Alert variant="danger">你的角色沒有權限檢視形態分析能力。</Alert>}
            {error && <Alert variant="danger">{error}</Alert>}

            {report?.artifact_error && (
                <Alert variant="danger">
                    放行檔讀取失敗（
                    {report.artifact_error}
                    ），以下各層狀態無法確認。
                </Alert>
            )}

            {canView && loading && !data && (
                <div className="admin-loading">
                    <Spinner animation="border" />
                    <span>載入中…</span>
                </div>
            )}

            {report && (
                <>
                    <p className="system-morph-muted">
                        產生時間 {data.generated_at}
                        {data.cached ? `（快取，約 ${data.cache_ttl_seconds} 秒內會重新計算）` : ''}
                        ｜放行檔產生器 {report.artifact_generator ?? '—'}
                    </p>
                    <Table responsive hover className="admin-table system-morph-table">
                        <thead>
                            <tr>
                                <th>族語</th>
                                <th>狀態（四層）</th>
                                <th>放行率</th>
                                <th>精確率</th>
                                <th>錯放行率（各負例類別）</th>
                            </tr>
                        </thead>
                        <tbody>
                            {report.tribes.map((tribe) => <TribeRow key={tribe.tribe} tribe={tribe} />)}
                        </tbody>
                    </Table>
                    <details className="system-morph-definitions">
                        <summary>數字怎麼算</summary>
                        <ul>
                            <li>放行率：分析器敢給答案的真詞 ÷ 最終測試的真詞。</li>
                            <li>精確率：給出答案的當中，詞根正確的比例。</li>
                            <li>錯放行率：把人工造的非詞當成真詞放行的比例，五種造法各算一次。</li>
                            <li>括號內是 Wilson 95% 信賴區間；沒有資料時顯示「無資料」，不是 0%。</li>
                            <li>
                                「可重建載入」只代表放行檔現在能通過載入檢查；實際是否生效還要看功能旗標。
                            </li>
                        </ul>
                    </details>
                </>
            )}
        </main>
    );
}
