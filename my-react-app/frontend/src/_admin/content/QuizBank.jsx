import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Form, Modal, Spinner, Table, Tab, Tabs } from 'react-bootstrap';
import { Check, Edit3, Minus, Plus, Send, Trash2, Undo2, X, Archive } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../../utils/apiClient';
import '../../../static/css/_admin/quiz-bank.css';

const CONTENT_EDITORS = ['owner', 'admin', 'editor'];
// 核准／退件／下架用 CONTENT_APPROVERS（含 reviewer），而不是 AnnouncementList
// 用的 PUBLISHERS——族語老師（reviewer）必須能核准題庫內容，這是整個審定
// 流程存在的意義，不能照抄公告管理的角色門檻。
const CONTENT_APPROVERS = ['owner', 'admin', 'reviewer'];
const PUBLISHERS = ['owner', 'admin'];

const TRIBES = {
    tayal: '泰雅語',
    amis: '阿美語',
    bunun: '布農語',
    kavalan: '噶瑪蘭語',
    paiwan: '排灣語',
};

const CATEGORIES = {
    noun: '名詞',
    verb: '動詞',
    time: '時間',
    function: '功能詞',
    kin: '親屬稱謂',
};

const STATUSES = {
    draft: { label: '草稿', bg: 'secondary' },
    pending_review: { label: '待審核', bg: 'warning' },
    rejected: { label: '已退件', bg: 'danger' },
    published: { label: '已啟用', bg: 'success' },
};

// 沒有 Announcement 的 unpublished 中介狀態，已啟用的內容要停用直接呼叫
// unpublish 退回 draft（見 models.py 的 ReviewableContent 說明）。
const EDITABLE_STATUSES = ['draft', 'rejected'];

function StatusCell({ item }) {
    return (
        <div className="d-flex flex-wrap align-items-center gap-1">
            <Badge bg={STATUSES[item.status]?.bg ?? 'secondary'}>
                {STATUSES[item.status]?.label ?? item.status}
            </Badge>
            {item.status === 'published' && item.has_pending_revision && (
                <Badge bg="warning" text="dark">有待審修改</Badge>
            )}
        </div>
    );
}

export default function QuizBank() {
    const { userData } = useAuth();
    const role = userData?.role;

    return (
        <main className="quiz-bank-admin-page">
            <div className="quiz-bank-page-heading">
                <div>
                    <h1>中高級／高級題庫</h1>
                    <p>管理配合題詞彙與克漏字短文，通過族語老師審定後才會出現在學生的測驗裡</p>
                </div>
            </div>
            <Tabs defaultActiveKey="vocab" className="quiz-bank-tabs">
                <Tab eventKey="vocab" title="配合題詞彙">
                    <VocabPanel role={role} />
                </Tab>
                <Tab eventKey="cloze" title="克漏字短文">
                    <ClozePanel role={role} />
                </Tab>
            </Tabs>
        </main>
    );
}

// ---------------------------------------------------------------------------
// 配合題詞彙
// ---------------------------------------------------------------------------

const EMPTY_VOCAB_FORM = {
    tribe: 'tayal',
    category: 'noun',
    foreign_word: '',
    chinese_gloss: '',
    audio_file_id: '',
};

function vocabFormFrom(item) {
    return {
        tribe: item.tribe,
        category: item.category,
        foreign_word: item.foreign_word,
        chinese_gloss: item.chinese_gloss,
        audio_file_id: item.audio_file_id || '',
    };
}

function VocabPanel({ role }) {
    const [filters, setFilters] = useState({ tribe: '', category: '', status: '' });
    const [query, setQuery] = useState(filters);
    const [data, setData] = useState({
        results: [],
        count: 0,
        page: 1,
        page_size: 20,
    });
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [actionId, setActionId] = useState(null);
    const [error, setError] = useState('');
    const [rejectTarget, setRejectTarget] = useState(null);
    const [rejectReason, setRejectReason] = useState('');
    const [rejectingRevision, setRejectingRevision] = useState(false);
    const [editTarget, setEditTarget] = useState(null);
    const [form, setForm] = useState(EMPTY_VOCAB_FORM);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');

        try {
            const params = new URLSearchParams({
                page: String(page),
                page_size: '20',
            });
            Object.entries(query).forEach(([key, value]) => {
                if (value) params.set(key, value);
            });
            setData(await apiGet(`/adminapi/quiz-bank/vocab/?${params.toString()}`));
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [page, query]);

    useEffect(() => {
        load();
    }, [load]);

    const search = (event) => {
        event.preventDefault();
        setPage(1);
        setQuery(filters);
    };

    const runAction = async (item, action, body) => {
        setActionId(item.id);
        setError('');

        try {
            if (action === 'delete') {
                if (!window.confirm(`確定要刪除「${item.foreign_word}」嗎？`)) return;
                await apiDelete(`/adminapi/quiz-bank/vocab/${item.id}/`);
            } else {
                await apiPost(
                    `/adminapi/quiz-bank/vocab/${item.id}/${action}/`,
                    body,
                );
            }
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setActionId(null);
        }
    };

    const openReject = (item, revision = false) => {
        setRejectTarget(item);
        setRejectingRevision(revision);
        setRejectReason('');
    };

    const closeReject = () => {
        setRejectTarget(null);
        setRejectingRevision(false);
        setRejectReason('');
    };

    const submitReject = async () => {
        if (!rejectReason.trim() || !rejectTarget) return;

        await runAction(
            rejectTarget,
            rejectingRevision ? 'pending-revision/reject' : 'reject',
            { review_comment: rejectReason.trim() },
        );
        closeReject();
    };

    const openNew = () => {
        setForm(EMPTY_VOCAB_FORM);
        setEditTarget({});
    };

    const openEdit = async (item) => {
        setActionId(item.id);
        setError('');

        try {
            let values = item;

            if (item.status === 'published') {
                try {
                    const revision = await apiGet(
                        `/adminapi/quiz-bank/vocab/${item.id}/pending-revision/`,
                    );
                    values = { ...item, ...(revision.payload || {}) };
                } catch (err) {
                    if (err.status !== 404) throw err;
                }
            }

            setForm(vocabFormFrom(values));
            setEditTarget(item);
        } catch (err) {
            setError(err.message);
        } finally {
            setActionId(null);
        }
    };

    const saveForm = async (event) => {
        event.preventDefault();
        setActionId('form');
        setError('');

        try {
            if (editTarget.id) {
                if (editTarget.status === 'published') {
                    await apiPost(
                        `/adminapi/quiz-bank/vocab/${editTarget.id}/pending-revision/`,
                        form,
                    );
                } else {
                    await apiPatch(
                        `/adminapi/quiz-bank/vocab/${editTarget.id}/`,
                        form,
                    );
                }
            } else {
                await apiPost('/adminapi/quiz-bank/vocab/', form);
            }

            setEditTarget(null);
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setActionId(null);
        }
    };

    const actionsFor = (item) => {
        const busy = actionId === item.id;
        const buttons = [];
        const editable = (
            EDITABLE_STATUSES.includes(item.status)
            || item.status === 'published'
        );

        if (editable && CONTENT_EDITORS.includes(role)) {
            buttons.push(
                <Button
                    key="edit"
                    size="sm"
                    variant="outline-primary"
                    disabled={busy}
                    onClick={() => openEdit(item)}
                >
                    <Edit3 size={14} /> 編輯
                </Button>,
            );
        }

        if (
            EDITABLE_STATUSES.includes(item.status)
            && CONTENT_EDITORS.includes(role)
        ) {
            buttons.push(
                <Button
                    key="submit"
                    size="sm"
                    variant="outline-success"
                    disabled={busy}
                    onClick={() => runAction(item, 'submit')}
                >
                    <Send size={14} /> 送審
                </Button>,
            );
        }

        if (item.status === 'draft' && PUBLISHERS.includes(role)) {
            buttons.push(
                <Button
                    key="delete"
                    size="sm"
                    variant="outline-danger"
                    disabled={busy}
                    onClick={() => runAction(item, 'delete')}
                >
                    <Trash2 size={14} /> 刪除
                </Button>,
            );
        }

        if (
            item.status === 'pending_review'
            && CONTENT_EDITORS.includes(role)
        ) {
            buttons.push(
                <Button
                    key="withdraw"
                    size="sm"
                    variant="outline-secondary"
                    disabled={busy}
                    onClick={() => runAction(item, 'withdraw')}
                >
                    <Undo2 size={14} /> 撤回
                </Button>,
            );
        }

        if (
            item.status === 'pending_review'
            && CONTENT_APPROVERS.includes(role)
        ) {
            buttons.push(
                <Button
                    key="approve"
                    size="sm"
                    variant="outline-success"
                    disabled={busy}
                    onClick={() => runAction(
                        item,
                        'approve',
                        { review_comment: '' },
                    )}
                >
                    <Check size={14} /> 核准
                </Button>,
            );
            buttons.push(
                <Button
                    key="reject"
                    size="sm"
                    variant="outline-danger"
                    disabled={busy}
                    onClick={() => openReject(item)}
                >
                    <X size={14} /> 退件
                </Button>,
            );
        }

        if (
            item.status === 'published'
            && item.has_pending_revision
            && CONTENT_APPROVERS.includes(role)
        ) {
            buttons.push(
                <Button
                    key="approve-revision"
                    size="sm"
                    variant="outline-success"
                    disabled={busy}
                    onClick={() => runAction(
                        item,
                        'pending-revision/approve',
                        { review_comment: '' },
                    )}
                >
                    <Check size={14} /> 核准修改
                </Button>,
            );
            buttons.push(
                <Button
                    key="reject-revision"
                    size="sm"
                    variant="outline-danger"
                    disabled={busy}
                    onClick={() => openReject(item, true)}
                >
                    <X size={14} /> 退件修改
                </Button>,
            );
        }

        if (
            item.status === 'published'
            && CONTENT_APPROVERS.includes(role)
        ) {
            buttons.push(
                <Button
                    key="unpublish"
                    size="sm"
                    variant="outline-secondary"
                    disabled={busy}
                    onClick={() => runAction(item, 'unpublish')}
                >
                    <Archive size={14} /> 下架
                </Button>,
            );
        }

        return buttons;
    };

    const hasNext = data.page * data.page_size < data.count;

    return (
        <div className="quiz-bank-panel">
            {error && <Alert variant="danger">{error}</Alert>}

            <Form className="quiz-bank-filter-panel" onSubmit={search}>
                <Form.Select
                    aria-label="族語"
                    value={filters.tribe}
                    onChange={(event) => setFilters({
                        ...filters,
                        tribe: event.target.value,
                    })}
                >
                    <option value="">全部族語</option>
                    {Object.entries(TRIBES).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                    ))}
                </Form.Select>

                <Form.Select
                    aria-label="分類"
                    value={filters.category}
                    onChange={(event) => setFilters({
                        ...filters,
                        category: event.target.value,
                    })}
                >
                    <option value="">全部分類</option>
                    {Object.entries(CATEGORIES).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                    ))}
                </Form.Select>

                <Form.Select
                    aria-label="狀態"
                    value={filters.status}
                    onChange={(event) => setFilters({
                        ...filters,
                        status: event.target.value,
                    })}
                >
                    <option value="">全部狀態</option>
                    {Object.entries(STATUSES).map(([value, meta]) => (
                        <option key={value} value={value}>{meta.label}</option>
                    ))}
                </Form.Select>

                <Button type="submit">搜尋</Button>
            </Form>

            {CONTENT_EDITORS.includes(role) && (
                <div className="quiz-bank-heading-actions">
                    <Button onClick={openNew}>
                        <Plus size={18} /> 新增詞彙
                    </Button>
                </div>
            )}

            <div className="quiz-bank-table-card">
                {loading ? (
                    <div className="quiz-bank-loading">
                        <Spinner animation="border" />
                        <span>載入中…</span>
                    </div>
                ) : (
                    <Table responsive hover className="quiz-bank-table">
                        <thead>
                            <tr>
                                <th>族語</th>
                                <th>分類</th>
                                <th>族語詞彙</th>
                                <th>中文詞義</th>
                                <th>狀態</th>
                                <th>建立者</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.results.length ? data.results.map((item) => (
                                <tr key={item.id}>
                                    <td>{TRIBES[item.tribe] ?? item.tribe}</td>
                                    <td>{CATEGORIES[item.category] ?? item.category}</td>
                                    <td>{item.foreign_word}</td>
                                    <td>{item.chinese_gloss}</td>
                                    <td><StatusCell item={item} /></td>
                                    <td>{item.created_by || '—'}</td>
                                    <td>
                                        <div className="quiz-bank-row-actions">
                                            {actionsFor(item)}
                                        </div>
                                    </td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan="7" className="quiz-bank-empty">
                                        沒有符合條件的詞彙
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </Table>
                )}

                <div className="quiz-bank-pagination">
                    <span>共 {data.count} 筆</span>
                    <div>
                        <Button
                            variant="outline-secondary"
                            disabled={loading || page <= 1}
                            onClick={() => setPage((value) => value - 1)}
                        >
                            上一頁
                        </Button>
                        <span>第 {data.page} 頁</span>
                        <Button
                            variant="outline-secondary"
                            disabled={loading || !hasNext}
                            onClick={() => setPage((value) => value + 1)}
                        >
                            下一頁
                        </Button>
                    </div>
                </div>
            </div>

            <Modal
                show={Boolean(editTarget)}
                onHide={() => setEditTarget(null)}
                centered
            >
                <Form onSubmit={saveForm}>
                    <Modal.Header closeButton>
                        <Modal.Title>
                            {editTarget?.id ? '編輯詞彙' : '新增詞彙'}
                        </Modal.Title>
                    </Modal.Header>
                    <Modal.Body>
                        <div className="quiz-bank-form-grid">
                            <Form.Group controlId="quiz-vocab-tribe">
                                <Form.Label>族語</Form.Label>
                                <Form.Select
                                    value={form.tribe}
                                    onChange={(event) => setForm({
                                        ...form,
                                        tribe: event.target.value,
                                    })}
                                >
                                    {Object.entries(TRIBES).map(([value, label]) => (
                                        <option key={value} value={value}>{label}</option>
                                    ))}
                                </Form.Select>
                            </Form.Group>

                            <Form.Group controlId="quiz-vocab-category">
                                <Form.Label>分類</Form.Label>
                                <Form.Select
                                    value={form.category}
                                    onChange={(event) => setForm({
                                        ...form,
                                        category: event.target.value,
                                    })}
                                >
                                    {Object.entries(CATEGORIES).map(([value, label]) => (
                                        <option key={value} value={value}>{label}</option>
                                    ))}
                                </Form.Select>
                            </Form.Group>
                        </div>

                        <Form.Group
                            className="quiz-bank-field"
                            controlId="quiz-vocab-foreign"
                        >
                            <Form.Label>
                                族語詞彙 <span className="required-mark">*</span>
                            </Form.Label>
                            <Form.Control
                                required
                                value={form.foreign_word}
                                onChange={(event) => setForm({
                                    ...form,
                                    foreign_word: event.target.value,
                                })}
                            />
                        </Form.Group>

                        <Form.Group
                            className="quiz-bank-field"
                            controlId="quiz-vocab-gloss"
                        >
                            <Form.Label>
                                中文詞義 <span className="required-mark">*</span>
                            </Form.Label>
                            <Form.Control
                                required
                                value={form.chinese_gloss}
                                onChange={(event) => setForm({
                                    ...form,
                                    chinese_gloss: event.target.value,
                                })}
                            />
                        </Form.Group>

                        <Form.Group
                            className="quiz-bank-field"
                            controlId="quiz-vocab-audio"
                        >
                            <Form.Label>音檔代碼（選填）</Form.Label>
                            <Form.Control
                                value={form.audio_file_id}
                                onChange={(event) => setForm({
                                    ...form,
                                    audio_file_id: event.target.value,
                                })}
                            />
                        </Form.Group>
                    </Modal.Body>
                    <Modal.Footer>
                        <Button
                            variant="secondary"
                            onClick={() => setEditTarget(null)}
                        >
                            取消
                        </Button>
                        <Button
                            type="submit"
                            disabled={
                                !form.foreign_word.trim()
                                || !form.chinese_gloss.trim()
                                || actionId === 'form'
                            }
                        >
                            {actionId === 'form' && (
                                <Spinner animation="border" size="sm" />
                            )}{' '}
                            儲存
                        </Button>
                    </Modal.Footer>
                </Form>
            </Modal>

            <Modal
                show={Boolean(rejectTarget)}
                onHide={closeReject}
                centered
            >
                <Modal.Header closeButton>
                    <Modal.Title>
                        {rejectingRevision ? '退件修改原因' : '退件原因'}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form.Group controlId="quiz-vocab-reject-reason">
                        <Form.Label>請說明需要修改的內容</Form.Label>
                        <Form.Control
                            as="textarea"
                            rows={4}
                            required
                            value={rejectReason}
                            onChange={(event) => setRejectReason(event.target.value)}
                            isInvalid={Boolean(rejectTarget) && !rejectReason.trim()}
                        />
                        <Form.Control.Feedback type="invalid">
                            退件理由為必填
                        </Form.Control.Feedback>
                    </Form.Group>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={closeReject}>
                        取消
                    </Button>
                    <Button
                        variant="danger"
                        disabled={
                            !rejectReason.trim()
                            || actionId === rejectTarget?.id
                        }
                        onClick={submitReject}
                    >
                        {rejectingRevision ? '確認退件修改' : '確認退件'}
                    </Button>
                </Modal.Footer>
            </Modal>
        </div>
    );
}

// ---------------------------------------------------------------------------
// 克漏字短文
// ---------------------------------------------------------------------------

const emptyBlank = () => ({
    options: ['', '', '', ''],
    answer: 1,
    distractor_type: '',
    note: '',
});

const EMPTY_CLOZE_FORM = {
    tribe: 'tayal',
    passage_foreign: '',
    passage_chinese: '',
    blanks: { blank1: emptyBlank() },
};

function clozeFormFrom(item) {
    return {
        tribe: item.tribe,
        passage_foreign: item.passage_foreign,
        passage_chinese: item.passage_chinese,
        blanks: item.blanks,
    };
}

function ClozePanel({ role }) {
    const [filters, setFilters] = useState({ tribe: '', status: '' });
    const [query, setQuery] = useState(filters);
    const [data, setData] = useState({
        results: [],
        count: 0,
        page: 1,
        page_size: 20,
    });
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [actionId, setActionId] = useState(null);
    const [error, setError] = useState('');
    const [rejectTarget, setRejectTarget] = useState(null);
    const [rejectReason, setRejectReason] = useState('');
    const [rejectingRevision, setRejectingRevision] = useState(false);
    const [editTarget, setEditTarget] = useState(null);
    const [form, setForm] = useState(EMPTY_CLOZE_FORM);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');

        try {
            const params = new URLSearchParams({
                page: String(page),
                page_size: '20',
            });
            Object.entries(query).forEach(([key, value]) => {
                if (value) params.set(key, value);
            });
            setData(await apiGet(`/adminapi/quiz-bank/cloze/?${params.toString()}`));
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [page, query]);

    useEffect(() => {
        load();
    }, [load]);

    const search = (event) => {
        event.preventDefault();
        setPage(1);
        setQuery(filters);
    };

    const runAction = async (item, action, body) => {
        setActionId(item.id);
        setError('');

        try {
            if (action === 'delete') {
                if (!window.confirm('確定要刪除這篇短文嗎？')) return;
                await apiDelete(`/adminapi/quiz-bank/cloze/${item.id}/`);
            } else {
                await apiPost(
                    `/adminapi/quiz-bank/cloze/${item.id}/${action}/`,
                    body,
                );
            }
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setActionId(null);
        }
    };

    const openReject = (item, revision = false) => {
        setRejectTarget(item);
        setRejectingRevision(revision);
        setRejectReason('');
    };

    const closeReject = () => {
        setRejectTarget(null);
        setRejectingRevision(false);
        setRejectReason('');
    };

    const submitReject = async () => {
        if (!rejectReason.trim() || !rejectTarget) return;

        await runAction(
            rejectTarget,
            rejectingRevision ? 'pending-revision/reject' : 'reject',
            { review_comment: rejectReason.trim() },
        );
        closeReject();
    };

    const openNew = () => {
        setForm(EMPTY_CLOZE_FORM);
        setEditTarget({});
    };

    const openEdit = async (item) => {
        setActionId(item.id);
        setError('');

        try {
            let values = item;

            if (item.status === 'published') {
                try {
                    const revision = await apiGet(
                        `/adminapi/quiz-bank/cloze/${item.id}/pending-revision/`,
                    );
                    values = { ...item, ...(revision.payload || {}) };
                } catch (err) {
                    if (err.status !== 404) throw err;
                }
            }

            setForm(clozeFormFrom(values));
            setEditTarget(item);
        } catch (err) {
            setError(err.message);
        } finally {
            setActionId(null);
        }
    };

    const addBlank = () => {
        const nextIndex = Object.keys(form.blanks).length + 1;
        setForm({
            ...form,
            blanks: {
                ...form.blanks,
                [`blank${nextIndex}`]: emptyBlank(),
            },
        });
    };

    const removeBlank = (key) => {
        const rest = { ...form.blanks };
        delete rest[key];
        setForm({ ...form, blanks: rest });
    };

    const updateBlankOption = (key, index, value) => {
        const blank = form.blanks[key];
        const options = blank.options.map((option, optionIndex) => (
            optionIndex === index ? value : option
        ));
        setForm({
            ...form,
            blanks: {
                ...form.blanks,
                [key]: { ...blank, options },
            },
        });
    };

    const updateBlankAnswer = (key, answer) => {
        setForm({
            ...form,
            blanks: {
                ...form.blanks,
                [key]: {
                    ...form.blanks[key],
                    answer,
                },
            },
        });
    };

    const saveForm = async (event) => {
        event.preventDefault();
        setActionId('form');
        setError('');

        try {
            if (editTarget.id) {
                if (editTarget.status === 'published') {
                    await apiPost(
                        `/adminapi/quiz-bank/cloze/${editTarget.id}/pending-revision/`,
                        form,
                    );
                } else {
                    await apiPatch(
                        `/adminapi/quiz-bank/cloze/${editTarget.id}/`,
                        form,
                    );
                }
            } else {
                await apiPost('/adminapi/quiz-bank/cloze/', form);
            }

            setEditTarget(null);
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setActionId(null);
        }
    };

    const actionsFor = (item) => {
        const busy = actionId === item.id;
        const buttons = [];
        const editable = (
            EDITABLE_STATUSES.includes(item.status)
            || item.status === 'published'
        );

        if (editable && CONTENT_EDITORS.includes(role)) {
            buttons.push(
                <Button
                    key="edit"
                    size="sm"
                    variant="outline-primary"
                    disabled={busy}
                    onClick={() => openEdit(item)}
                >
                    <Edit3 size={14} /> 編輯
                </Button>,
            );
        }

        if (
            EDITABLE_STATUSES.includes(item.status)
            && CONTENT_EDITORS.includes(role)
        ) {
            buttons.push(
                <Button
                    key="submit"
                    size="sm"
                    variant="outline-success"
                    disabled={busy}
                    onClick={() => runAction(item, 'submit')}
                >
                    <Send size={14} /> 送審
                </Button>,
            );
        }

        if (item.status === 'draft' && PUBLISHERS.includes(role)) {
            buttons.push(
                <Button
                    key="delete"
                    size="sm"
                    variant="outline-danger"
                    disabled={busy}
                    onClick={() => runAction(item, 'delete')}
                >
                    <Trash2 size={14} /> 刪除
                </Button>,
            );
        }

        if (
            item.status === 'pending_review'
            && CONTENT_EDITORS.includes(role)
        ) {
            buttons.push(
                <Button
                    key="withdraw"
                    size="sm"
                    variant="outline-secondary"
                    disabled={busy}
                    onClick={() => runAction(item, 'withdraw')}
                >
                    <Undo2 size={14} /> 撤回
                </Button>,
            );
        }

        if (
            item.status === 'pending_review'
            && CONTENT_APPROVERS.includes(role)
        ) {
            buttons.push(
                <Button
                    key="approve"
                    size="sm"
                    variant="outline-success"
                    disabled={busy}
                    onClick={() => runAction(
                        item,
                        'approve',
                        { review_comment: '' },
                    )}
                >
                    <Check size={14} /> 核准
                </Button>,
            );
            buttons.push(
                <Button
                    key="reject"
                    size="sm"
                    variant="outline-danger"
                    disabled={busy}
                    onClick={() => openReject(item)}
                >
                    <X size={14} /> 退件
                </Button>,
            );
        }

        if (
            item.status === 'published'
            && item.has_pending_revision
            && CONTENT_APPROVERS.includes(role)
        ) {
            buttons.push(
                <Button
                    key="approve-revision"
                    size="sm"
                    variant="outline-success"
                    disabled={busy}
                    onClick={() => runAction(
                        item,
                        'pending-revision/approve',
                        { review_comment: '' },
                    )}
                >
                    <Check size={14} /> 核准修改
                </Button>,
            );
            buttons.push(
                <Button
                    key="reject-revision"
                    size="sm"
                    variant="outline-danger"
                    disabled={busy}
                    onClick={() => openReject(item, true)}
                >
                    <X size={14} /> 退件修改
                </Button>,
            );
        }

        if (
            item.status === 'published'
            && CONTENT_APPROVERS.includes(role)
        ) {
            buttons.push(
                <Button
                    key="unpublish"
                    size="sm"
                    variant="outline-secondary"
                    disabled={busy}
                    onClick={() => runAction(item, 'unpublish')}
                >
                    <Archive size={14} /> 下架
                </Button>,
            );
        }

        return buttons;
    };

    const hasNext = data.page * data.page_size < data.count;
    const canSaveCloze = (
        form.passage_foreign.trim()
        && form.passage_chinese.trim()
        && Object.values(form.blanks).every(
            (blank) => blank.options.every((option) => option.trim()),
        )
    );

    return (
        <div className="quiz-bank-panel">
            {error && <Alert variant="danger">{error}</Alert>}

            <Form className="quiz-bank-filter-panel" onSubmit={search}>
                <Form.Select
                    aria-label="族語"
                    value={filters.tribe}
                    onChange={(event) => setFilters({
                        ...filters,
                        tribe: event.target.value,
                    })}
                >
                    <option value="">全部族語</option>
                    {Object.entries(TRIBES).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                    ))}
                </Form.Select>

                <Form.Select
                    aria-label="狀態"
                    value={filters.status}
                    onChange={(event) => setFilters({
                        ...filters,
                        status: event.target.value,
                    })}
                >
                    <option value="">全部狀態</option>
                    {Object.entries(STATUSES).map(([value, meta]) => (
                        <option key={value} value={value}>{meta.label}</option>
                    ))}
                </Form.Select>

                <Button type="submit">搜尋</Button>
            </Form>

            {CONTENT_EDITORS.includes(role) && (
                <div className="quiz-bank-heading-actions">
                    <Button onClick={openNew}>
                        <Plus size={18} /> 新增短文
                    </Button>
                </div>
            )}

            <div className="quiz-bank-table-card">
                {loading ? (
                    <div className="quiz-bank-loading">
                        <Spinner animation="border" />
                        <span>載入中…</span>
                    </div>
                ) : (
                    <Table responsive hover className="quiz-bank-table">
                        <thead>
                            <tr>
                                <th>族語</th>
                                <th>短文開頭</th>
                                <th>空格數</th>
                                <th>狀態</th>
                                <th>建立者</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.results.length ? data.results.map((item) => (
                                <tr key={item.id}>
                                    <td>{TRIBES[item.tribe] ?? item.tribe}</td>
                                    <td className="quiz-bank-truncate-cell">
                                        {item.passage_foreign}
                                    </td>
                                    <td>{Object.keys(item.blanks || {}).length}</td>
                                    <td><StatusCell item={item} /></td>
                                    <td>{item.created_by || '—'}</td>
                                    <td>
                                        <div className="quiz-bank-row-actions">
                                            {actionsFor(item)}
                                        </div>
                                    </td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan="6" className="quiz-bank-empty">
                                        沒有符合條件的短文
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </Table>
                )}

                <div className="quiz-bank-pagination">
                    <span>共 {data.count} 筆</span>
                    <div>
                        <Button
                            variant="outline-secondary"
                            disabled={loading || page <= 1}
                            onClick={() => setPage((value) => value - 1)}
                        >
                            上一頁
                        </Button>
                        <span>第 {data.page} 頁</span>
                        <Button
                            variant="outline-secondary"
                            disabled={loading || !hasNext}
                            onClick={() => setPage((value) => value + 1)}
                        >
                            下一頁
                        </Button>
                    </div>
                </div>
            </div>

            <Modal
                show={Boolean(editTarget)}
                onHide={() => setEditTarget(null)}
                centered
                size="lg"
            >
                <Form onSubmit={saveForm}>
                    <Modal.Header closeButton>
                        <Modal.Title>
                            {editTarget?.id ? '編輯短文' : '新增短文'}
                        </Modal.Title>
                    </Modal.Header>
                    <Modal.Body>
                        <Form.Group
                            className="quiz-bank-field"
                            controlId="quiz-cloze-tribe"
                        >
                            <Form.Label>族語</Form.Label>
                            <Form.Select
                                value={form.tribe}
                                onChange={(event) => setForm({
                                    ...form,
                                    tribe: event.target.value,
                                })}
                            >
                                {Object.entries(TRIBES).map(([value, label]) => (
                                    <option key={value} value={value}>{label}</option>
                                ))}
                            </Form.Select>
                        </Form.Group>

                        <Form.Group
                            className="quiz-bank-field"
                            controlId="quiz-cloze-passage-foreign"
                        >
                            <Form.Label>
                                族語短文 <span className="required-mark">*</span>
                            </Form.Label>
                            <Form.Control
                                as="textarea"
                                rows={3}
                                required
                                value={form.passage_foreign}
                                onChange={(event) => setForm({
                                    ...form,
                                    passage_foreign: event.target.value,
                                })}
                                placeholder="用 {blank1}、{blank2}... 標記空格位置"
                            />
                            <Form.Text>
                                每個空格必須用 {'{blank1}'}、{'{blank2}'} 這種標記，
                                數量要跟下方空格數一致。
                            </Form.Text>
                        </Form.Group>

                        <Form.Group
                            className="quiz-bank-field"
                            controlId="quiz-cloze-passage-chinese"
                        >
                            <Form.Label>
                                中文翻譯 <span className="required-mark">*</span>
                            </Form.Label>
                            <Form.Control
                                as="textarea"
                                rows={3}
                                required
                                value={form.passage_chinese}
                                onChange={(event) => setForm({
                                    ...form,
                                    passage_chinese: event.target.value,
                                })}
                            />
                        </Form.Group>

                        {Object.entries(form.blanks).map(([key, blank]) => (
                            <div className="quiz-bank-blank-card" key={key}>
                                <div className="quiz-bank-blank-card-heading">
                                    <strong>{key}</strong>
                                    {Object.keys(form.blanks).length > 1 && (
                                        <Button
                                            size="sm"
                                            variant="outline-danger"
                                            onClick={() => removeBlank(key)}
                                        >
                                            <Minus size={14} /> 移除空格
                                        </Button>
                                    )}
                                </div>

                                <div className="quiz-bank-blank-options-grid">
                                    {blank.options.map((option, index) => (
                                        <div
                                            className="quiz-bank-option-row"
                                            key={index}
                                        >
                                            <Form.Check
                                                type="radio"
                                                name={`${key}-answer`}
                                                checked={blank.answer === index + 1}
                                                onChange={() => updateBlankAnswer(
                                                    key,
                                                    index + 1,
                                                )}
                                                aria-label={`${key} 選項 ${index + 1} 是否為正解`}
                                            />
                                            <Form.Control
                                                required
                                                value={option}
                                                onChange={(event) => updateBlankOption(
                                                    key,
                                                    index,
                                                    event.target.value,
                                                )}
                                                placeholder={`選項 ${index + 1}`}
                                            />
                                        </div>
                                    ))}
                                </div>

                                <Form.Text>
                                    點選圓形按鈕標記正解，4 個選項皆為必填。
                                </Form.Text>
                            </div>
                        ))}

                        <Button
                            variant="outline-primary"
                            size="sm"
                            onClick={addBlank}
                        >
                            <Plus size={14} /> 新增空格
                        </Button>
                    </Modal.Body>
                    <Modal.Footer>
                        <Button
                            variant="secondary"
                            onClick={() => setEditTarget(null)}
                        >
                            取消
                        </Button>
                        <Button
                            type="submit"
                            disabled={!canSaveCloze || actionId === 'form'}
                        >
                            {actionId === 'form' && (
                                <Spinner animation="border" size="sm" />
                            )}{' '}
                            儲存
                        </Button>
                    </Modal.Footer>
                </Form>
            </Modal>

            <Modal
                show={Boolean(rejectTarget)}
                onHide={closeReject}
                centered
            >
                <Modal.Header closeButton>
                    <Modal.Title>
                        {rejectingRevision ? '退件修改原因' : '退件原因'}
                    </Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <Form.Group controlId="quiz-cloze-reject-reason">
                        <Form.Label>請說明需要修改的內容</Form.Label>
                        <Form.Control
                            as="textarea"
                            rows={4}
                            required
                            value={rejectReason}
                            onChange={(event) => setRejectReason(event.target.value)}
                            isInvalid={Boolean(rejectTarget) && !rejectReason.trim()}
                        />
                        <Form.Control.Feedback type="invalid">
                            退件理由為必填
                        </Form.Control.Feedback>
                    </Form.Group>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={closeReject}>
                        取消
                    </Button>
                    <Button
                        variant="danger"
                        disabled={
                            !rejectReason.trim()
                            || actionId === rejectTarget?.id
                        }
                        onClick={submitReject}
                    >
                        {rejectingRevision ? '確認退件修改' : '確認退件'}
                    </Button>
                </Modal.Footer>
            </Modal>
        </div>
    );
}
