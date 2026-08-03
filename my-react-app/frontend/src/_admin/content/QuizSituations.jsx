import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Form, Modal, Spinner, Table } from 'react-bootstrap';
import { Check, Edit3, Plus, Send, Trash2, Undo2, X, Archive } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { apiDelete, apiGet, apiPatch, apiPost } from '../../../utils/apiClient';
import '../../../static/css/_admin/quiz-bank.css';

const CONTENT_EDITORS = ['owner', 'admin', 'editor'];
// 跟 QuizBank.jsx 同一個理由：核准／退件／下架用 CONTENT_APPROVERS（含
// reviewer），不是公告管理用的 PUBLISHERS。
const CONTENT_APPROVERS = ['owner', 'admin', 'reviewer'];
const PUBLISHERS = ['owner', 'admin'];
const EDITABLE_STATUSES = ['draft', 'rejected'];

const TRIBES = { tayal: '泰雅語', amis: '阿美語', bunun: '布農語', kavalan: '噶瑪蘭語', paiwan: '排灣語' };
const STATUSES = {
    draft: { label: '草稿', bg: 'secondary' },
    pending_review: { label: '待審核', bg: 'warning' },
    rejected: { label: '已退件', bg: 'danger' },
    published: { label: '已啟用', bg: 'success' },
};

const emptyOption = () => ({ foreign: '', chinese: '' });
const EMPTY_FORM = { tribe: 'tayal', scenario_chinese: '', options: [emptyOption(), emptyOption(), emptyOption(), emptyOption()], answer: 1 };

export default function QuizSituations() {
    const { userData } = useAuth();
    const role = userData?.role;
    const [filters, setFilters] = useState({ tribe: '', status: '' });
    const [query, setQuery] = useState(filters);
    const [data, setData] = useState({ results: [], count: 0, page: 1, page_size: 20 });
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(true);
    const [actionId, setActionId] = useState(null);
    const [error, setError] = useState('');
    const [rejectTarget, setRejectTarget] = useState(null);
    const [rejectReason, setRejectReason] = useState('');
    const [editTarget, setEditTarget] = useState(null);
    const [form, setForm] = useState(EMPTY_FORM);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const params = new URLSearchParams({ page: String(page), page_size: '20' });
            Object.entries(query).forEach(([key, value]) => value && params.set(key, value));
            setData(await apiGet(`/adminapi/quiz-bank/situations/?${params.toString()}`));
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [page, query]);

    useEffect(() => { load(); }, [load]);

    const search = (event) => { event.preventDefault(); setPage(1); setQuery(filters); };

    const runAction = async (item, action, body) => {
        setActionId(item.id);
        setError('');
        try {
            if (action === 'delete') {
                if (!window.confirm('確定要刪除這則情境題嗎？')) return;
                await apiDelete(`/adminapi/quiz-bank/situations/${item.id}/`);
            } else {
                await apiPost(`/adminapi/quiz-bank/situations/${item.id}/${action}/`, body);
            }
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setActionId(null);
        }
    };

    const submitReject = async () => {
        if (!rejectReason.trim()) return;
        await runAction(rejectTarget, 'reject', { review_comment: rejectReason.trim() });
        setRejectTarget(null);
        setRejectReason('');
    };

    const openNew = () => { setForm(EMPTY_FORM); setEditTarget({}); };
    const openEdit = (item) => {
        setForm({ tribe: item.tribe, scenario_chinese: item.scenario_chinese, options: item.options, answer: item.answer });
        setEditTarget(item);
    };

    const updateOption = (index, field, value) => {
        const options = form.options.map((option, i) => (i === index ? { ...option, [field]: value } : option));
        setForm({ ...form, options });
    };

    const saveForm = async (event) => {
        event.preventDefault();
        setActionId('form');
        setError('');
        try {
            const payload = { ...form, answer: Number(form.answer) };
            if (editTarget.id) {
                await apiPatch(`/adminapi/quiz-bank/situations/${editTarget.id}/`, payload);
            } else {
                await apiPost('/adminapi/quiz-bank/situations/', payload);
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
        if (EDITABLE_STATUSES.includes(item.status) && CONTENT_EDITORS.includes(role)) {
            buttons.push(<Button key="edit" size="sm" variant="outline-primary" disabled={busy} onClick={() => openEdit(item)}><Edit3 size={14} /> 編輯</Button>);
            buttons.push(<Button key="submit" size="sm" variant="outline-success" disabled={busy} onClick={() => runAction(item, 'submit')}><Send size={14} /> 送審</Button>);
        }
        if (item.status === 'draft' && PUBLISHERS.includes(role)) {
            buttons.push(<Button key="delete" size="sm" variant="outline-danger" disabled={busy} onClick={() => runAction(item, 'delete')}><Trash2 size={14} /> 刪除</Button>);
        }
        if (item.status === 'pending_review' && CONTENT_EDITORS.includes(role)) {
            buttons.push(<Button key="withdraw" size="sm" variant="outline-secondary" disabled={busy} onClick={() => runAction(item, 'withdraw')}><Undo2 size={14} /> 撤回</Button>);
        }
        if (item.status === 'pending_review' && CONTENT_APPROVERS.includes(role)) {
            buttons.push(<Button key="approve" size="sm" variant="outline-success" disabled={busy} onClick={() => runAction(item, 'approve', { review_comment: '' })}><Check size={14} /> 核准</Button>);
            buttons.push(<Button key="reject" size="sm" variant="outline-danger" disabled={busy} onClick={() => { setRejectTarget(item); setRejectReason(''); }}><X size={14} /> 退件</Button>);
        }
        if (item.status === 'published' && CONTENT_APPROVERS.includes(role)) {
            buttons.push(<Button key="unpublish" size="sm" variant="outline-secondary" disabled={busy} onClick={() => runAction(item, 'unpublish')}><Archive size={14} /> 下架</Button>);
        }
        return buttons;
    };

    const hasNext = data.page * data.page_size < data.count;
    const canSave = form.scenario_chinese.trim() && form.options.every((option) => option.foreign.trim());

    return (
        <main className="quiz-bank-admin-page">
            <div className="quiz-bank-page-heading">
                <div><h1>情境題</h1><p>情境式對話練習——獨立的族語對話入口，不掛在官方認證等級系統裡</p></div>
            </div>
            {error && <Alert variant="danger">{error}</Alert>}
            <Form className="quiz-bank-filter-panel" onSubmit={search}>
                <Form.Select aria-label="族語" value={filters.tribe} onChange={(e) => setFilters({ ...filters, tribe: e.target.value })}>
                    <option value="">全部族語</option>{Object.entries(TRIBES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Form.Select>
                <Form.Select aria-label="狀態" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
                    <option value="">全部狀態</option>{Object.entries(STATUSES).map(([value, meta]) => <option key={value} value={value}>{meta.label}</option>)}
                </Form.Select>
                <Button type="submit">搜尋</Button>
            </Form>
            {CONTENT_EDITORS.includes(role) && <div className="quiz-bank-heading-actions"><Button onClick={openNew}><Plus size={18} /> 新增情境題</Button></div>}

            <div className="quiz-bank-table-card">
                {loading ? <div className="quiz-bank-loading"><Spinner animation="border" /><span>載入中…</span></div> : (
                    <Table responsive hover className="quiz-bank-table">
                        <thead><tr><th>族語</th><th>情境描述</th><th>狀態</th><th>建立者</th><th>操作</th></tr></thead>
                        <tbody>{data.results.length ? data.results.map((item) => (
                            <tr key={item.id}>
                                <td>{TRIBES[item.tribe] ?? item.tribe}</td>
                                <td className="quiz-bank-truncate-cell">{item.scenario_chinese}</td>
                                <td><Badge bg={STATUSES[item.status]?.bg ?? 'secondary'}>{STATUSES[item.status]?.label ?? item.status}</Badge></td>
                                <td>{item.created_by || '—'}</td>
                                <td><div className="quiz-bank-row-actions">{actionsFor(item)}</div></td>
                            </tr>
                        )) : <tr><td colSpan="5" className="quiz-bank-empty">沒有符合條件的情境題</td></tr>}</tbody>
                    </Table>
                )}
                <div className="quiz-bank-pagination"><span>共 {data.count} 筆</span><div><Button variant="outline-secondary" disabled={loading || page <= 1} onClick={() => setPage((value) => value - 1)}>上一頁</Button><span>第 {data.page} 頁</span><Button variant="outline-secondary" disabled={loading || !hasNext} onClick={() => setPage((value) => value + 1)}>下一頁</Button></div></div>
            </div>

            <Modal show={Boolean(editTarget)} onHide={() => setEditTarget(null)} centered size="lg">
                <Form onSubmit={saveForm}>
                    <Modal.Header closeButton><Modal.Title>{editTarget?.id ? '編輯情境題' : '新增情境題'}</Modal.Title></Modal.Header>
                    <Modal.Body>
                        <Form.Group className="quiz-bank-field" controlId="quiz-situation-tribe"><Form.Label>族語</Form.Label><Form.Select value={form.tribe} onChange={(e) => setForm({ ...form, tribe: e.target.value })}>{Object.entries(TRIBES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Form.Select></Form.Group>
                        <Form.Group className="quiz-bank-field" controlId="quiz-situation-scenario"><Form.Label>情境描述 <span className="required-mark">*</span></Form.Label><Form.Control as="textarea" rows={3} required value={form.scenario_chinese} onChange={(e) => setForm({ ...form, scenario_chinese: e.target.value })} placeholder="例如：長輩遞給你食物，你要怎麼用族語回應？" /></Form.Group>
                        {form.options.map((option, index) => (
                            <div className="quiz-bank-option-row" key={index}>
                                <Form.Check type="radio" name="quiz-situation-answer" checked={form.answer === index + 1} onChange={() => setForm({ ...form, answer: index + 1 })} aria-label={`選項 ${index + 1} 是否為正解`} />
                                <Form.Control required value={option.foreign} onChange={(e) => updateOption(index, 'foreign', e.target.value)} placeholder={`選項 ${index + 1}：族語對話`} />
                                <Form.Control value={option.chinese} onChange={(e) => updateOption(index, 'chinese', e.target.value)} placeholder="中文翻譯（選填）" />
                            </div>
                        ))}
                        <Form.Text>點選圓形按鈕標記正解，4 個選項的族語對話皆為必填、中文翻譯選填。</Form.Text>
                    </Modal.Body>
                    <Modal.Footer><Button variant="secondary" onClick={() => setEditTarget(null)}>取消</Button><Button type="submit" disabled={!canSave || actionId === 'form'}>{actionId === 'form' && <Spinner animation="border" size="sm" />} 儲存</Button></Modal.Footer>
                </Form>
            </Modal>

            <Modal show={Boolean(rejectTarget)} onHide={() => setRejectTarget(null)} centered>
                <Modal.Header closeButton><Modal.Title>退件原因</Modal.Title></Modal.Header>
                <Modal.Body><Form.Group controlId="quiz-situation-reject-reason"><Form.Label>請說明需要修改的內容</Form.Label><Form.Control as="textarea" rows={4} required value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} isInvalid={Boolean(rejectTarget) && !rejectReason.trim()} /><Form.Control.Feedback type="invalid">退件理由為必填</Form.Control.Feedback></Form.Group></Modal.Body>
                <Modal.Footer><Button variant="secondary" onClick={() => setRejectTarget(null)}>取消</Button><Button variant="danger" disabled={!rejectReason.trim() || actionId === rejectTarget?.id} onClick={submitReject}>確認退件</Button></Modal.Footer>
            </Modal>
        </main>
    );
}
