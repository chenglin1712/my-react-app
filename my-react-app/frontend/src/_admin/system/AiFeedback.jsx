import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Form, Spinner } from 'react-bootstrap';
import AdminTable from '../components/AdminTable';
import { useAuth } from '../../userServives/authContext';
import { apiGet, apiPost } from '../../../utils/apiClient';
import '../../../static/css/_admin/system.css';
import '../../../static/css/_admin/ai-usage.css';
import '../../../static/css/_admin/ai-feedback.css';

// 回饋內容含學生自己寫的問題與說明，後端只開放 owner／admin；前端同步擋，省得其他角色看到一個必定 403 的頁面。
const VIEWER_ROLES = ['owner', 'admin'];

const REASON_LABELS = {
    wrong_tribal: '族語有錯',
    irrelevant: '答非所問',
    too_hard: '太難懂',
    too_long: '太長',
    other: '其他',
};

const NOTE_MAX = 300;

const formatTime = (iso) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '時間不明';
    return date.toLocaleString('zh-TW', { hour12: false, timeZone: 'Asia/Taipei' });
};

function CandidateCell({ item, onChange, busy }) {
    const [note, setNote] = useState(item.evalNote || '');
    // 重播用的問題預設帶入學生原文，管理者要先去掉姓名、電話等個資再加入；評測只會用這一欄
    const [question, setQuestion] = useState(item.evalQuestion || item.question);
    const inputId = `ai-feedback-note-${item.id}`;
    const questionId = `ai-feedback-question-${item.id}`;
    return (
        <div className="ai-feedback-candidate">
            {item.evalCandidate ? (
                <>
                    <p className="ai-feedback-note"><span>重播問題</span>{item.evalQuestion}</p>
                    <p className="ai-feedback-note">{item.evalNote || '（沒有備註）'}</p>
                    <Button size="sm" variant="outline-secondary" disabled={busy} onClick={() => onChange(item, false, '', '')}>
                        移出評測題組
                    </Button>
                </>
            ) : (
                <>
                    <Form.Label htmlFor={questionId} className="visually-hidden">重播的問題（請先去掉個資）</Form.Label>
                    <Form.Control
                        id={questionId}
                        as="textarea"
                        rows={2}
                        size="sm"
                        value={question}
                        maxLength={NOTE_MAX}
                        placeholder="重播的問題（請先去掉個資）"
                        onChange={(event) => setQuestion(event.target.value)}
                    />
                    <Form.Label htmlFor={inputId} className="visually-hidden">期望的答案方向（選填）</Form.Label>
                    <Form.Control
                        id={inputId}
                        size="sm"
                        value={note}
                        maxLength={NOTE_MAX}
                        placeholder="期望的答案方向（選填）"
                        onChange={(event) => setNote(event.target.value)}
                    />
                    <Button size="sm" variant="outline-primary" disabled={busy || !question.trim()} onClick={() => onChange(item, true, note, question)}>
                        加入評測題組
                    </Button>
                </>
            )}
        </div>
    );
}

export default function AiFeedback() {
    const { userData, loading: authLoading } = useAuth();
    const canView = VIEWER_ROLES.includes(userData?.role);

    const [filters, setFilters] = useState({ rating: '', reason: '', candidate: false });
    const [page, setPage] = useState(1);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busyId, setBusyId] = useState(null);

    useEffect(() => {
        if (!canView) {
            setData(null);
            setLoading(false);
            return undefined;
        }
        let active = true;
        setLoading(true);
        setError('');
        const params = new URLSearchParams({ page: String(page) });
        if (filters.rating) params.set('rating', filters.rating);
        if (filters.reason) params.set('reason', filters.reason);
        if (filters.candidate) params.set('candidate', '1');
        (async () => {
            try {
                const result = await apiGet(`/adminapi/ai-feedback/?${params}`);
                if (active) setData(result);
            } catch (err) {
                if (active) {
                    setData(null); // 不能繼續顯示上一組篩選的結果
                    setError(err.message);
                }
            } finally {
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, [canView, filters, page]);

    const changeFilter = (patch) => {
        setFilters((prev) => ({ ...prev, ...patch }));
        setPage(1);
    };

    const markCandidate = useCallback(async (item, candidate, note, question) => {
        setBusyId(item.id);
        setError('');
        try {
            const updated = await apiPost(`/adminapi/ai-feedback/${item.id}/eval-candidate/`, { candidate, note, question });
            setData((prev) => prev && ({
                ...prev,
                items: prev.items.map((row) => (row.id === item.id ? updated : row)),
                summary: { ...prev.summary, candidates: prev.summary.candidates + (candidate ? 1 : -1) },
            }));
        } catch (err) {
            setError(err.message);
        } finally {
            setBusyId(null);
        }
    }, []);

    const summary = data?.summary;
    const satisfaction = summary && summary.total > 0 ? Math.round((summary.up / summary.total) * 100) : null;

    return (
        <main className="admin-page system-page ai-usage-page ai-feedback-page">
            <div className="admin-page-heading">
                <div>
                    <h1>AI 回饋</h1>
                    <p>學生對 AI 助手回覆的讚與倒讚。內容含學生寫的問題，請勿外流；保存 180 天後自動清除。</p>
                </div>
            </div>

            {!canView && !authLoading && <Alert variant="danger">只有擁有者與管理員可以檢視 AI 回饋。</Alert>}
            {canView && error && <Alert variant="danger">{error}</Alert>}

            {canView && loading && !data && (
                <div className="admin-loading">
                    <Spinner animation="border" />
                    <span>載入中…</span>
                </div>
            )}

            {canView && data && (
                <div className="ai-usage-content" aria-busy={loading}>
                    <section className="ai-usage-summary" aria-label="回饋總覽">
                        <dl>
                            <div><dt>回饋總數</dt><dd>{summary.total}</dd></div>
                            <div><dt>讚</dt><dd>{summary.up}{satisfaction !== null && <small>{satisfaction}%</small>}</dd></div>
                            <div><dt>倒讚</dt><dd>{summary.down}</dd></div>
                            <div><dt>已加入題組</dt><dd>{summary.candidates}</dd></div>
                        </dl>
                        {summary.down > 0 && (
                            <p className="ai-feedback-reasons">
                                倒讚原因：
                                {Object.entries(REASON_LABELS).map(([key, label]) => `${label} ${summary.byReason[key] ?? 0}`).join('、')}
                            </p>
                        )}
                    </section>

                    <form className="ai-feedback-filters" onSubmit={(event) => event.preventDefault()} aria-label="篩選回饋">
                        <div>
                            <Form.Label htmlFor="ai-feedback-rating">評價</Form.Label>
                            <Form.Select id="ai-feedback-rating" value={filters.rating} onChange={(e) => changeFilter({ rating: e.target.value })}>
                                <option value="">全部</option>
                                <option value="up">讚</option>
                                <option value="down">倒讚</option>
                            </Form.Select>
                        </div>
                        <div>
                            <Form.Label htmlFor="ai-feedback-reason">倒讚原因</Form.Label>
                            <Form.Select id="ai-feedback-reason" value={filters.reason} onChange={(e) => changeFilter({ reason: e.target.value })}>
                                <option value="">全部</option>
                                {Object.entries(REASON_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                            </Form.Select>
                        </div>
                        <Form.Check
                            id="ai-feedback-candidate"
                            type="checkbox"
                            label="只看已加入題組的"
                            checked={filters.candidate}
                            onChange={(e) => changeFilter({ candidate: e.target.checked })}
                        />
                    </form>

                    <AdminTable label="AI 回饋列表" hover className="admin-table ai-feedback-table">
                        <thead>
                            <tr>
                                <th>時間</th>
                                <th>評價</th>
                                <th>問題與回覆</th>
                                <th>追溯</th>
                                <th>評測題組</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.items.length > 0 ? data.items.map((item) => (
                                <tr key={item.id}>
                                    <td className="ai-usage-nowrap">{formatTime(item.createdAt)}</td>
                                    <td>
                                        <strong>{item.rating === 'up' ? '讚' : '倒讚'}</strong>
                                        {item.reason && <div>{REASON_LABELS[item.reason] ?? item.reason}</div>}
                                        {item.comment && <div className="ai-feedback-comment">{item.comment}</div>}
                                    </td>
                                    <td className="ai-feedback-text">
                                        <p><span>問（學生端回報）</span>{item.question}</p>
                                        <p><span>答</span>{item.reply}</p>
                                    </td>
                                    <td className="ai-feedback-trace">
                                        <div>模型：{item.model || '未記錄'}</div>
                                        <div className="ai-feedback-muted">模型與 Request 以用量紀錄核對過；提示詞版本與問題由學生端回報。</div>
                                        <div>提示詞版本：{item.promptVersion || '未記錄'}</div>
                                        <div>Request：{item.requestId || '未記錄'}</div>
                                        <div>使用者：{item.user}</div>
                                    </td>
                                    <td>
                                        {item.rating === 'down'
                                            ? <CandidateCell item={item} onChange={markCandidate} busy={busyId === item.id} />
                                            : <span className="ai-feedback-muted">只有倒讚可以加入</span>}
                                    </td>
                                </tr>
                            )) : (
                                <tr><td colSpan={5} className="admin-empty">沒有符合條件的回饋</td></tr>
                            )}
                        </tbody>
                    </AdminTable>

                    {data.pages > 1 && (
                        <nav className="ai-feedback-pager" aria-label="分頁">
                            <Button size="sm" variant="outline-secondary" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>上一頁</Button>
                            <span>第 {data.page} / {data.pages} 頁</span>
                            <Button size="sm" variant="outline-secondary" disabled={page >= data.pages || loading} onClick={() => setPage(page + 1)}>下一頁</Button>
                        </nav>
                    )}
                </div>
            )}
        </main>
    );
}
