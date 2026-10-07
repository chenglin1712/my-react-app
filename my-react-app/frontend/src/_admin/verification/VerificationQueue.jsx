import {
    useCallback, useEffect, useRef, useState,
} from 'react';
import {
    Alert, Badge, Button, Form, Modal, Spinner, Table,
} from 'react-bootstrap';
import { Download, Upload } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { apiGet, apiPost } from '../../../utils/apiClient';
import {
    STAFF_ROLES, VERIFICATION_EXPORTERS, VERIFICATION_IMPORTERS, VERIFICATION_REVIEWERS,
} from '../constants/roles';
import stateLabel from './stateLabel';
import '../../../static/css/_admin/system.css';

const BASE = '/adminapi/verification';

const TRIBES = {
    tayal: '泰雅語', amis: '阿美語', bunun: '布農語', kavalan: '葛瑪蘭語', paiwan: '排灣語',
};
const KINDS = {
    unmatched_form: '詞形（辭典對不到）',
    morph_analysis: '詞形分析結果',
};
const QUESTIONS = {
    unmatched_form: '這個詞形是正確的族語詞（拼寫正確、值得收錄）嗎？',
    morph_analysis: '詞形分析器給的詞根正確嗎？',
};
const VERDICTS = { agree: '同意', disagree: '不同意', uncertain: '不確定' };
const REVIEWER_TYPES = { staff: '工作人員', external: '外部審核者' };

const PAGE_SIZE = 25;
const EMPTY_FILTERS = {
    tribe: '', kind: '', state: '', q: '',
};

function ProposalCell({ item }) {
    if (!item.proposal) return <span className="system-morph-muted">—</span>;
    return (
        <div>
            <div>
                分析：
                <code>{item.proposal.predicted_root}</code>
                {' '}
                （規則
                {' '}
                <code>{item.proposal.rule}</code>
                ）
            </div>
            <div className="system-morph-muted">
                辭典標註：
                {item.proposal.gold_roots.join('、')}
            </div>
        </div>
    );
}

function ReviewModal({ item, canSeeOpinions, onClose, onSaved }) {
    const mine = item.my_review;
    const [verdict, setVerdict] = useState(mine?.verdict ?? '');
    const [correction, setCorrection] = useState(mine?.correction ?? '');
    const [dialect, setDialect] = useState(mine?.dialect ?? '');
    const [notes, setNotes] = useState(mine?.notes ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [reviews, setReviews] = useState(null);
    const [reviewsError, setReviewsError] = useState('');

    useEffect(() => {
        if (!canSeeOpinions) return undefined;
        let active = true;
        apiGet(`${BASE}/items/${item.id}/`)
            .then((detail) => { if (active) setReviews(detail.reviews ?? []); })
            // 載入失敗不能偽裝成「沒有既有意見」：使用者會在缺少脈絡的情況下送出新意見
            .catch((err) => { if (active) setReviewsError(err.message); });
        return () => { active = false; };
    }, [canSeeOpinions, item.id]);

    const submit = async () => {
        setSaving(true);
        setError('');
        try {
            const response = await apiPost(`${BASE}/items/${item.id}/review/`, {
                verdict, correction, dialect, notes,
            });
            onSaved(response.item);
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal show onHide={onClose} centered>
            <Modal.Header closeButton>
                <Modal.Title>提供意見：{item.form}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <p>{QUESTIONS[item.kind]}</p>
                <ProposalCell item={item} />
                <Alert variant="secondary" className="mt-3">
                    你的意見只會被記錄，不會改動辭典或測驗題庫；這個項目仍然待專家驗證。
                </Alert>
                {error && <Alert variant="danger">{error}</Alert>}
                <Form.Group className="mb-3">
                    <Form.Label>你的意見</Form.Label>
                    <div>
                        {Object.entries(VERDICTS).map(([value, label]) => (
                            <Form.Check
                                inline
                                key={value}
                                type="radio"
                                id={`verdict-${value}`}
                                name="verdict"
                                label={label}
                                checked={verdict === value}
                                onChange={() => setVerdict(value)}
                            />
                        ))}
                    </div>
                </Form.Group>
                <Form.Group className="mb-3" controlId="verification-correction">
                    <Form.Label>建議的正確寫法或詞根（選填）</Form.Label>
                    <Form.Control value={correction} maxLength={200} onChange={(e) => setCorrection(e.target.value)} />
                </Form.Group>
                <Form.Group className="mb-3" controlId="verification-dialect">
                    <Form.Label>方言別（選填）</Form.Label>
                    <Form.Control value={dialect} maxLength={40} onChange={(e) => setDialect(e.target.value)} />
                </Form.Group>
                <Form.Group className="mb-3" controlId="verification-notes">
                    <Form.Label>備註（選填）</Form.Label>
                    <Form.Control as="textarea" rows={3} value={notes} maxLength={1000} onChange={(e) => setNotes(e.target.value)} />
                </Form.Group>
                {reviewsError && (
                    <Alert variant="warning">無法載入既有意見（{reviewsError}），請確認後再送出。</Alert>
                )}
                {canSeeOpinions && reviews && reviews.length > 0 && (
                    <div>
                        <h3 className="h6">目前已有的意見</h3>
                        <ul className="system-morph-problems" style={{ color: 'inherit' }}>
                            {reviews.map((r) => (
                                <li key={`${r.reviewer_type}-${r.reviewer_label}`}>
                                    {REVIEWER_TYPES[r.reviewer_type] ?? r.reviewer_type}
                                    {' '}
                                    {r.reviewer_label}
                                    ：
                                    {VERDICTS[r.verdict]}
                                    {r.correction ? `，建議「${r.correction}」` : ''}
                                    {r.dialect ? `（${r.dialect}）` : ''}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </Modal.Body>
            <Modal.Footer>
                <Button variant="outline-secondary" onClick={onClose}>取消</Button>
                <Button variant="primary" disabled={!verdict || saving} onClick={submit}>
                    {saving ? <Spinner animation="border" size="sm" /> : null}
                    送出意見
                </Button>
            </Modal.Footer>
        </Modal>
    );
}

function ImportPanel({ onApplied }) {
    const [text, setText] = useState('');
    const [fileName, setFileName] = useState('');
    const [preview, setPreview] = useState(null);
    const [busy, setBusy] = useState(false);
    const [reading, setReading] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState('');
    const readToken = useRef(0);

    const call = async (dryRun) => {
        setBusy(true);
        setError('');
        setDone('');
        try {
            const result = await apiPost(`${BASE}/import/`, { csv: text, dry_run: dryRun });
            if (dryRun) setPreview(result);
            else {
                setPreview(null);
                setDone(`已匯入：新增 ${result.created}、更新 ${result.updated}、沒有變動 ${result.unchanged}。這些項目仍待專家驗證。`);
                onApplied();
            }
        } catch (err) {
            setPreview(err.data?.errors ? { ...err.data, failed: true } : null);
            setError(err.data?.errors ? '檔案有錯誤，沒有寫入任何資料。' : err.message);
        } finally {
            setBusy(false);
        }
    };

    const onFile = async (event) => {
        const file = event.target.files?.[0];
        readToken.current += 1;                 // 之前還沒讀完的檔案作廢，不會晚到的舊檔蓋掉新檔
        const token = readToken.current;
        setPreview(null);
        setError('');
        setDone('');
        setText('');                            // 新檔讀完之前不能拿舊檔內容去預覽
        setFileName('');
        if (!file) return;
        setReading(true);
        try {
            const content = await file.text();
            if (token !== readToken.current) return;
            setFileName(file.name);
            setText(content);
        } catch (err) {
            if (token === readToken.current) setError(`讀取檔案失敗：${err.message}`);
        } finally {
            if (token === readToken.current) setReading(false);
        }
    };

    return (
        <section className="system-action-card">
            <div className="system-action-card-heading">
                <Upload size={22} aria-hidden="true" />
                <div>
                    <h2>匯入意見（CSV）</h2>
                    <p>
                        用「匯出待填 CSV」下載的檔案，填寫 reviewer、verdict（agree／disagree／uncertain）等欄位後匯入。
                        先預覽，確認無誤再寫入；任何一列有錯就整批不寫入。
                    </p>
                </div>
            </div>
            <Form.Group controlId="verification-import-file" className="mb-3">
                <Form.Label>選擇要匯入的 CSV 檔</Form.Label>
                <Form.Control type="file" accept=".csv,text/csv" onChange={onFile} />
            </Form.Group>
            {error && <Alert variant="danger">{error}</Alert>}
            {done && <Alert variant="success">{done}</Alert>}
            {preview && (
                <Alert variant={preview.failed ? 'danger' : 'info'}>
                    <div>
                        共 {preview.rows_total} 列，可匯入 {preview.rows_valid} 列，略過空白列 {preview.rows_skipped_blank} 列，錯誤 {preview.error_count} 個。
                    </div>
                    {!preview.failed && (
                        <div>
                            預覽：新增 {preview.created}、更新 {preview.updated}、沒有變動 {preview.unchanged}。
                        </div>
                    )}
                    {preview.errors?.length > 0 && (
                        <ul className="system-morph-problems">
                            {preview.errors.map((e) => <li key={`${e.line}-${e.message}`}>第 {e.line} 列：{e.message}</li>)}
                        </ul>
                    )}
                </Alert>
            )}
            <div className="system-action-card-footer">
                <Button variant="outline-secondary" disabled={!text || busy || reading} onClick={() => call(true)}>
                    預覽{fileName ? `（${fileName}）` : ''}
                </Button>
                <Button
                    variant="primary"
                    disabled={!preview || preview.failed || busy || reading || preview.rows_valid === 0}
                    onClick={() => call(false)}
                >
                    確認匯入
                </Button>
            </div>
        </section>
    );
}

export default function VerificationQueue() {
    const { userData } = useAuth();
    const role = userData?.role;
    const canView = STAFF_ROLES.includes(role);
    const canReview = VERIFICATION_REVIEWERS.includes(role);
    const canExport = VERIFICATION_EXPORTERS.includes(role);
    const canImport = VERIFICATION_IMPORTERS.includes(role);

    const [enabled, setEnabled] = useState(null);
    const [filters, setFilters] = useState(EMPTY_FILTERS);
    const [page, setPage] = useState(1);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(canView);
    const [error, setError] = useState('');
    const [active, setActive] = useState(null);
    const [exportError, setExportError] = useState('');

    useEffect(() => {
        if (!canView) return undefined;
        let live = true;
        apiGet(`${BASE}/status/`)
            .then((r) => { if (live) setEnabled(r.enabled === true); })
            .catch((err) => { if (live) { setEnabled(false); setError(err.message); setLoading(false); } });
        return () => { live = false; };
    }, [canView]);

    const query = useCallback((extra = {}) => {
        const params = new URLSearchParams();
        Object.entries({ ...filters, ...extra }).forEach(([k, v]) => { if (v) params.set(k, v); });
        return params;
    }, [filters]);

    const load = useCallback(async (isLive = () => true) => {
        setLoading(true);
        setError('');
        try {
            const params = query({ page, page_size: PAGE_SIZE });
            const response = await apiGet(`${BASE}/items/?${params.toString()}`);
            if (isLive()) setData(response);
        } catch (err) {
            // 失敗（含被撤權或旗標被關）就清掉舊清單，不讓使用者以為舊資料還是現況
            if (isLive()) { setData(null); setError(err.message); }
        } finally {
            if (isLive()) setLoading(false);
        }
    }, [query, page]);

    useEffect(() => {
        if (!canView || enabled !== true) return undefined;
        let live = true;
        load(() => live);
        return () => { live = false; };
    }, [canView, enabled, load]);

    const setFilter = (key, value) => {
        setFilters((prev) => ({ ...prev, [key]: value }));
        setPage(1);
    };

    const exportCsv = async () => {
        setExportError('');
        try {
            const params = query();
            const text = await apiGet(`${BASE}/export/?${params.toString()}`);
            if (typeof text !== 'string') throw new Error('匯出內容格式不符');
            const blob = new Blob([text.startsWith('\uFEFF') ? text : `\uFEFF${text}`], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = 'verification-queue-template.csv';
            link.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            setExportError(err.message);
        }
    };

    const onSaved = (updated) => {
        setActive(null);
        setData((prev) => (prev ? { ...prev, results: prev.results.map((r) => (r.id === updated.id ? updated : r)) } : prev));
    };

    const totalPages = data ? Math.max(1, Math.ceil(data.count / data.page_size)) : 1;

    return (
        <main className="admin-page verification-page">
            <div className="admin-page-heading">
                <div>
                    <h1>待專家驗證佇列</h1>
                    <p>收集對候選詞形與分析結果的意見。意見不會寫回辭典或測驗題庫，所有項目都仍待專家驗證。</p>
                </div>
                {canView && enabled && canExport && (
                    <Button variant="outline-secondary" onClick={exportCsv}>
                        <Download size={16} />
                        匯出待填 CSV
                    </Button>
                )}
            </div>

            {!canView && <Alert variant="danger">你的角色沒有權限檢視待專家驗證佇列。</Alert>}
            {canView && enabled === false && !error && (
                <Alert variant="warning">待專家驗證佇列尚未啟用（功能開關 verification_queue 關閉）。</Alert>
            )}
            {error && <Alert variant="danger">{error}</Alert>}
            {exportError && <Alert variant="danger">{exportError}</Alert>}

            {canView && enabled && (
                <>
                    <Alert variant="secondary">
                        內部資料：清單內容來自例句與基準報表的抽樣（不是完整母體），只含詞形與統計，不含句子。
                        {!canReview && ' 你的角色可以檢視，但不能提交意見。'}
                    </Alert>
                    <div className="system-filter-panel" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
                        <Form.Select aria-label="族語" value={filters.tribe} onChange={(e) => setFilter('tribe', e.target.value)}>
                            <option value="">全部族語</option>
                            {Object.entries(TRIBES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </Form.Select>
                        <Form.Select aria-label="種類" value={filters.kind} onChange={(e) => setFilter('kind', e.target.value)}>
                            <option value="">全部種類</option>
                            {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                        </Form.Select>
                        <Form.Select aria-label="狀態" value={filters.state} onChange={(e) => setFilter('state', e.target.value)}>
                            <option value="">全部狀態</option>
                            <option value="awaiting_expert_review">尚無意見</option>
                            <option value="opinions_recorded">已有意見</option>
                            <option value="conflicting_opinions">意見不一致</option>
                        </Form.Select>
                        <Form.Control
                            aria-label="搜尋詞形"
                            placeholder="搜尋詞形"
                            value={filters.q}
                            maxLength={50}
                            onChange={(e) => setFilter('q', e.target.value)}
                        />
                    </div>

                    {loading && !data && (
                        <div className="admin-loading"><Spinner animation="border" /><span>載入中…</span></div>
                    )}
                    {data && (
                        <div className="admin-table-card">
                            <Table responsive hover className="admin-table">
                                <thead>
                                    <tr>
                                        <th>詞形</th><th>族語／種類</th><th>提案</th><th>統計（詞次／句數）</th><th>狀態</th><th />
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.results.length === 0 && (
                                        <tr><td colSpan="6" className="admin-empty">沒有符合條件的項目</td></tr>
                                    )}
                                    {data.results.map((item) => {
                                        const label = stateLabel(item);
                                        return (
                                            <tr key={item.id}>
                                                <td><code>{item.form}</code></td>
                                                <td>
                                                    {TRIBES[item.tribe] ?? item.tribe}
                                                    <div className="system-morph-muted">{KINDS[item.kind] ?? item.kind}</div>
                                                </td>
                                                <td><ProposalCell item={item} /></td>
                                                <td>
                                                    {item.occurrence_count ?? '—'}
                                                    ／
                                                    {item.sentence_count ?? '—'}
                                                </td>
                                                <td>
                                                    <Badge bg={label.variant}>{label.text}</Badge>
                                                    {item.my_review && (
                                                        <div className="system-morph-muted">
                                                            你的意見：
                                                            {VERDICTS[item.my_review.verdict]}
                                                        </div>
                                                    )}
                                                </td>
                                                <td>
                                                    {canReview && (
                                                        <Button size="sm" variant="outline-primary" onClick={() => setActive(item)}>
                                                            {item.my_review ? '修改我的意見' : '提供意見'}
                                                        </Button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </Table>
                            <div className="admin-pagination">
                                <Button size="sm" variant="outline-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一頁</Button>
                                <span>第 {data.page} / {totalPages} 頁（共 {data.count} 筆）</span>
                                <Button size="sm" variant="outline-secondary" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一頁</Button>
                            </div>
                        </div>
                    )}
                    {canImport && (
                        <div className="mt-4">
                            <ImportPanel onApplied={() => load()} />
                        </div>
                    )}
                </>
            )}

            {active && (
                <ReviewModal item={active} canSeeOpinions={canReview} onClose={() => setActive(null)} onSaved={onSaved} />
            )}
        </main>
    );
}
