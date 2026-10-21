import { useEffect, useState } from 'react';
import { Alert, Form, Spinner } from 'react-bootstrap';
import AdminTable from '../components/AdminTable';
import { useAuth } from '../../userServives/authContext';
import { apiGet } from '../../../utils/apiClient';
import '../../../static/css/_admin/system.css';
import '../../../static/css/_admin/ai-usage.css';

const STAFF_ROLES = ['owner', 'admin', 'editor', 'reviewer', 'analyst'];

const RANGE_OPTIONS = [
    { value: 7, label: '最近 7 天' },
    { value: 14, label: '最近 14 天' },
    { value: 30, label: '最近 30 天' },
    { value: 90, label: '最近 90 天' },
];

// 後端的 feature／status 是固定的英文代號，後台顯示成管理者看得懂的名稱；
// 不認得的代號（日後新增功能）原樣顯示，不會整列消失。
const FEATURE_LABELS = {
    chat: 'AI 助手聊天',
    plan: 'AI 助手讀書計畫',
    review: '錯題補充說明',
    translate: '族語翻譯',
};

const STATUS_LABELS = {
    ok: '成功',
    timeout: '逾時',
    rate_limit: '被限流',
    connection_error: '連線失敗',
    server_error: '供應商錯誤',
    breaker_open: '斷路器暫停中',
    refusal: '模型拒答',
    error: '其他錯誤',
};

// 後端若回了 null、NaN 或負數，畫面寧可顯示 0，也不要出現 NaN 或負的次數。
const safe = (n) => (Number.isFinite(Number(n)) ? Math.max(0, Number(n)) : 0);
const number = (n) => safe(n).toLocaleString('zh-TW');

// 單次對話只有零點幾美分，小於 1 美元時多顯示幾位，才看得出差別。
const usd = (n) => `US$${safe(n).toLocaleString('en-US', {
    minimumFractionDigits: safe(n) >= 1 ? 2 : 4,
    maximumFractionDigits: safe(n) >= 1 ? 2 : 4,
})}`;

const hasValue = (n) => n != null && Number.isFinite(Number(n));
const percent = (rate) => (hasValue(rate) ? `${(Math.min(1, safe(rate)) * 100).toFixed(1)}%` : '無資料');
const ms = (value) => (hasValue(value) ? `${number(value)} ms` : '無資料');

const EMPTY_BUCKET = {
    calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, costUsd: 0, costIncomplete: false,
};
const list = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

// 把後端回應整理成頁面一定讀得動的形狀：缺的物件補空值、缺的陣列補 []。
function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
        priceNote: raw.priceNote ?? '',
        totals: { ...EMPTY_BUCKET, ...(raw.totals ?? {}) },
        daily: list(raw.daily),
        byFeature: list(raw.byFeature),
        byModel: list(raw.byModel),
        byStatus: list(raw.byStatus),
        topUsers: list(raw.topUsers),
    };
}

function Panel({ title, note, children }) {
    return (
        <section className="ai-usage-panel">
            <div className="ai-usage-panel-heading">
                <h2>{title}</h2>
                {note && <p>{note}</p>}
            </div>
            {children}
        </section>
    );
}

function EmptyRow({ colSpan }) {
    return (
        <tr>
            <td colSpan={colSpan} className="admin-empty">這段期間沒有資料</td>
        </tr>
    );
}

function CostCell({ row }) {
    return (
        <>
            {usd(row.costUsd)}
            {row.costIncomplete && (
                <span className="ai-usage-flag" title="這組資料含有沒有價目的模型，費用偏低">
                    不完整
                </span>
            )}
        </>
    );
}

function GroupTable({ label, firstHeading, rows, firstCell }) {
    return (
        <AdminTable label={label} hover className="admin-table ai-usage-table">
            <thead>
                <tr>
                    <th>{firstHeading}</th>
                    <th className="ai-usage-num">呼叫</th>
                    <th className="ai-usage-num">失敗</th>
                    <th className="ai-usage-num">輸入 token</th>
                    <th className="ai-usage-num">輸出 token</th>
                    <th className="ai-usage-num">快取讀取</th>
                    <th className="ai-usage-num">估算費用</th>
                </tr>
            </thead>
            <tbody>
                {rows.length > 0 ? rows.map((row) => (
                    <tr key={firstCell(row).key}>
                        <td>{firstCell(row).node}</td>
                        <td className="ai-usage-num">{number(row.calls)}</td>
                        <td className="ai-usage-num">{number(row.errors)}</td>
                        <td className="ai-usage-num">{number(row.inputTokens)}</td>
                        <td className="ai-usage-num">{number(row.outputTokens)}</td>
                        <td className="ai-usage-num">{number(row.cacheReadTokens)}</td>
                        <td className="ai-usage-num"><CostCell row={row} /></td>
                    </tr>
                )) : <EmptyRow colSpan={7} />}
            </tbody>
        </AdminTable>
    );
}

export default function AiUsage() {
    const { userData, loading: authLoading } = useAuth();
    const canView = STAFF_ROLES.includes(userData?.role);

    const [days, setDays] = useState(7);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!canView) {
            setData(null);
            setError('');
            setLoading(false);
            return undefined;
        }
        let active = true;
        setLoading(true);
        setError('');

        (async () => {
            try {
                const result = await apiGet(`/adminapi/ai-usage/?days=${days}`);
                if (active) setData(normalize(result));
            } catch (err) {
                if (active) {
                    // 新區間查詢失敗時不能繼續顯示上一個區間的數字，會被誤認成目前區間的結果。
                    setData(null);
                    setError(err.message);
                }
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => {
            active = false;
        };
    }, [days, canView]);

    const totals = data?.totals;
    const maxDailyCost = Math.max(0, ...(data?.daily ?? []).map((row) => safe(row.costUsd)));
    const failureRate = totals && safe(totals.calls) > 0 ? safe(totals.errors) / safe(totals.calls) : null;

    return (
        <main className="admin-page system-page ai-usage-page">
            <div className="admin-page-heading">
                <div>
                    <h1>AI 用量</h1>
                    <p>AI 助手與族語翻譯呼叫 Anthropic 的次數、token 與估算費用</p>
                </div>
                <div className="ai-usage-range">
                    <Form.Label htmlFor="ai-usage-days">統計區間</Form.Label>
                    <Form.Select
                        id="ai-usage-days"
                        value={days}
                        disabled={!canView}
                        onChange={(event) => setDays(Number(event.target.value))}
                    >
                        {RANGE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </Form.Select>
                </div>
            </div>

            {!canView && !authLoading && (
                <Alert variant="danger">你的角色沒有權限檢視 AI 用量。</Alert>
            )}
            {canView && error && <Alert variant="danger">{error}</Alert>}

            {canView && loading && !data && (
                <div className="admin-loading">
                    <Spinner animation="border" />
                    <span>載入中…</span>
                </div>
            )}

            {canView && data && (
                <div className="ai-usage-content" aria-busy={loading}>
                    <Alert variant="info" className="ai-usage-note">
                        {data.priceNote}
                        {totals.costIncomplete && ' 有些模型沒有價目，下方標示「不完整」的費用會偏低。'}
                    </Alert>

                    <section className="ai-usage-summary" aria-label="用量總覽">
                        <dl>
                            <div>
                                <dt>呼叫次數</dt>
                                <dd>{number(totals.calls)}</dd>
                            </div>
                            <div>
                                <dt>失敗比例</dt>
                                <dd>
                                    {percent(failureRate)}
                                    <small>{number(totals.errors)} 次</small>
                                </dd>
                            </div>
                            <div>
                                <dt>估算費用</dt>
                                <dd><CostCell row={totals} /></dd>
                            </div>
                            <div>
                                <dt>快取命中率</dt>
                                <dd>{percent(totals.cacheHitRate)}</dd>
                            </div>
                            <div>
                                <dt>延遲中位數</dt>
                                <dd>{ms(totals.latencyP50Ms)}</dd>
                            </div>
                            <div>
                                <dt>延遲 P95</dt>
                                <dd>{ms(totals.latencyP95Ms)}</dd>
                            </div>
                        </dl>
                    </section>

                    <Panel title="每日費用" note="最新的日期在最上面">
                        <AdminTable label="每日用量" hover className="admin-table ai-usage-table">
                            <thead>
                                <tr>
                                    <th>日期</th>
                                    <th className="ai-usage-num">呼叫</th>
                                    <th className="ai-usage-num">失敗</th>
                                    <th className="ai-usage-num">估算費用</th>
                                    <th className="ai-usage-bar-column"><span className="visually-hidden">費用占比</span></th>
                                </tr>
                            </thead>
                            <tbody>
                                {[...data.daily].reverse().map((row) => (
                                    <tr key={row.date}>
                                        <td>{row.date}</td>
                                        <td className="ai-usage-num">{number(row.calls)}</td>
                                        <td className="ai-usage-num">{number(row.errors)}</td>
                                        <td className="ai-usage-num"><CostCell row={row} /></td>
                                        <td className="ai-usage-bar-column">
                                            <span className="ai-usage-bar" aria-hidden="true">
                                                <span
                                                    className="ai-usage-bar-fill"
                                                    style={{ width: maxDailyCost > 0 ? `${Math.min(100, (safe(row.costUsd) / maxDailyCost) * 100)}%` : '0%' }}
                                                />
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </AdminTable>
                    </Panel>

                    <Panel title="依功能" note="費用由高到低">
                        <GroupTable
                            label="各功能用量"
                            firstHeading="功能"
                            rows={data.byFeature}
                            firstCell={(row) => ({ key: row.feature, node: FEATURE_LABELS[row.feature] ?? row.feature })}
                        />
                    </Panel>

                    <Panel title="依模型">
                        <GroupTable
                            label="各模型用量"
                            firstHeading="模型"
                            rows={data.byModel}
                            firstCell={(row) => ({ key: row.model, node: <code>{row.model || '未記錄'}</code> })}
                        />
                    </Panel>

                    <div className="ai-usage-split">
                        <Panel title="呼叫結果">
                            <AdminTable label="呼叫結果統計" hover className="admin-table ai-usage-table">
                                <thead>
                                    <tr>
                                        <th>結果</th>
                                        <th className="ai-usage-num">次數</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.byStatus.length > 0 ? data.byStatus.map((row) => (
                                        <tr key={row.status}>
                                            <td>{STATUS_LABELS[row.status] ?? row.status}</td>
                                            <td className="ai-usage-num">{number(row.calls)}</td>
                                        </tr>
                                    )) : <EmptyRow colSpan={2} />}
                                </tbody>
                            </AdminTable>
                        </Panel>

                        <Panel title="呼叫最多的使用者" note="最多顯示 10 位">
                            <AdminTable label="使用者用量" hover className="admin-table ai-usage-table">
                                <thead>
                                    <tr>
                                        <th>使用者</th>
                                        <th className="ai-usage-num">呼叫</th>
                                        <th className="ai-usage-num">估算費用</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.topUsers.length > 0 ? data.topUsers.map((row) => (
                                        <tr key={row.uid}>
                                            <td><code className="ai-usage-uid">{row.uid}</code></td>
                                            <td className="ai-usage-num">{number(row.calls)}</td>
                                            <td className="ai-usage-num"><CostCell row={row} /></td>
                                        </tr>
                                    )) : <EmptyRow colSpan={3} />}
                                </tbody>
                            </AdminTable>
                        </Panel>
                    </div>
                </div>
            )}
        </main>
    );
}
