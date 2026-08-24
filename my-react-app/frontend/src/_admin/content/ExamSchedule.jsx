import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Form, Modal, Spinner, Table } from 'react-bootstrap';
import { Edit3, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { apiDelete, apiGet, apiPost, apiPut } from '../../../utils/apiClient';
import { useActionLock } from '../hooks/useActionLock';
import { formatDateTime } from '../adminFormat';
import '../../../static/css/_admin/exam-schedule.css';

const CONTENT_EDITORS = ['owner', 'admin', 'editor'];

const EMPTY_DATA = {
    crawled: { available: false, session: '', phases: [] },
    effective_phases: [],
    overrides: [],
    status: {},
};

const formatDate = (value) => (value ? value.replaceAll('-', '/') : '—');

export default function ExamSchedule() {
    const { userData } = useAuth();
    const role = userData?.role;
    const [data, setData] = useState(EMPTY_DATA);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [editTarget, setEditTarget] = useState(null);
    const [newPhase, setNewPhase] = useState('');
    const [form, setForm] = useState({
        label: '', start_date: '', end_date: '', is_active: true,
    });

    // 重新爬取／儲存覆寫／清除覆寫彼此都應該互斥，共用同一把鎖——而不是
    // 像原本那樣用 refreshing／actionPhase 兩個各自獨立的 state 當忙碌
    // 旗標，那樣既擋不住同一個 tick 內的重複觸發，也擋不住「重新爬取」跟
    // 「儲存某個覆寫」同時執行（兩者都會呼叫 loadSchedule() 整份重新
    // 載入，同時執行沒有意義）。
    const lock = useActionLock();
    const refreshing = lock.pendingKey === 'refresh';
    const actionPhase = typeof lock.pendingKey === 'string' && lock.pendingKey.startsWith('phase:')
        ? lock.pendingKey.slice('phase:'.length)
        : '';

    // 只有「目前最新的那一次查詢」可以寫回狀態：連續重新整理或操作後的
    // reload，較舊的查詢若比較新的查詢晚回來，不能覆蓋新查詢的結果。
    const loadRequestRef = useRef(0);

    const loadSchedule = useCallback(async () => {
        const requestId = loadRequestRef.current + 1;
        loadRequestRef.current = requestId;
        const isStale = () => loadRequestRef.current !== requestId;

        setLoading(true);
        setError('');
        try {
            const result = await apiGet('/adminapi/exam-schedule/');
            if (isStale()) return;
            setData(result);
        } catch (err) {
            if (isStale()) return;
            setError(err.message);
        } finally {
            if (!isStale()) setLoading(false);
        }
    }, []);

    useEffect(() => { loadSchedule(); }, [loadSchedule]);

    const refreshSchedule = () => lock.runLocked('refresh', async () => {
        setError('');
        try {
            await apiPost('/adminapi/exam-schedule/');
            await loadSchedule();
        } catch (err) {
            setError(err.message);
        }
    });

    const overrideFor = (phase) => data.overrides.find((item) => item.phase === phase);

    const openEditor = (phase) => {
        const override = overrideFor(phase.phase);
        setEditTarget(phase);
        setForm({
            label: override?.label || phase.label || '',
            start_date: override?.start_date || phase.start_date || '',
            end_date: override?.end_date || phase.end_date || '',
            is_active: override?.is_active ?? true,
        });
    };

    const openNewOverride = () => {
        setNewPhase('');
        setEditTarget({ phase: '', isNew: true });
        setForm({
            label: '', start_date: '', end_date: '', is_active: true,
        });
    };

    const closeEditor = () => setEditTarget(null);

    const saveOverride = (event) => {
        event.preventDefault();
        if (!form.start_date) return undefined;
        const phase = editTarget.isNew ? newPhase.trim() : editTarget.phase;
        if (!phase) return undefined;

        return lock.runLocked(`phase:${phase}`, async () => {
            setError('');
            try {
                await apiPut(`/adminapi/exam-schedule/overrides/${encodeURIComponent(phase)}/`, {
                    label: form.label.trim(),
                    start_date: form.start_date,
                    end_date: form.end_date || null,
                    is_active: form.is_active,
                });
                setEditTarget(null);
                await loadSchedule();
            } catch (err) {
                setError(err.message);
            }
        });
    };

    const clearOverride = (phase) => {
        if (!window.confirm(`確定要清除「${phase}」的覆寫嗎？`)) return Promise.resolve();

        return lock.runLocked(`phase:${phase}`, async () => {
            setError('');
            try {
                await apiDelete(`/adminapi/exam-schedule/overrides/${encodeURIComponent(phase)}/`);
                await loadSchedule();
            } catch (err) {
                setError(err.message);
            }
        });
    };

    const renderRows = (phases, effective = false) => phases.map((phase) => {
        const override = overrideFor(phase.phase);
        const isOverridden = effective && override?.is_active;
        const busy = actionPhase === phase.phase;
        const disabled = Boolean(lock.pendingKey) && !busy;

        return (
            <tr key={phase.phase}>
                <td>
                    <strong>{phase.phase}</strong>
                    {isOverridden && <Badge bg="warning" text="dark">覆寫中</Badge>}
                </td>
                <td>{phase.label || '—'}</td>
                <td>{formatDate(phase.start_date)}</td>
                <td>{formatDate(phase.end_date)}</td>
                {effective && CONTENT_EDITORS.includes(role) && (
                    <td>
                        <div className="exam-schedule-row-actions">
                            <Button
                                type="button"
                                size="sm"
                                variant="outline-primary"
                                disabled={busy || disabled}
                                onClick={() => openEditor(phase)}
                            >
                                <Edit3 size={14} /> 編輯覆寫
                            </Button>
                            {isOverridden && (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline-danger"
                                    disabled={busy || disabled}
                                    onClick={() => clearOverride(phase.phase)}
                                >
                                    <Trash2 size={14} /> 清除覆寫
                                </Button>
                            )}
                        </div>
                    </td>
                )}
            </tr>
        );
    });

    const failures = data.status?.consecutive_failures || 0;
    // Modal 開著時背景表格會被 backdrop 擋住點擊，所以 Modal 開著期間唯一
    // 可能持有這把鎖的操作就是這個 Modal 自己的送出——不需要比對 phase
    // 字串本身是否相符（新增覆寫時 newPhase 在送出後使用者仍可能繼續打字，
    // 比對字串反而不可靠）。
    const formSubmitting = Boolean(editTarget) && Boolean(actionPhase);

    return (
        <main className="exam-schedule-admin-page">
            <div className="exam-schedule-page-heading">
                <div>
                    <h1>考試時程管理</h1>
                    <p>比較爬蟲原始結果與後台實際生效資料</p>
                </div>
                {CONTENT_EDITORS.includes(role) && (
                    <div className="exam-schedule-heading-actions">
                        <Button
                            type="button"
                            variant="outline-primary"
                            disabled={loading || Boolean(lock.pendingKey)}
                            onClick={openNewOverride}
                        >
                            <Plus size={18} /> 新增覆寫
                        </Button>
                        <Button
                            type="button"
                            disabled={refreshing || loading || Boolean(lock.pendingKey)}
                            onClick={refreshSchedule}
                        >
                            {refreshing ? <Spinner animation="border" size="sm" /> : <RefreshCw size={18} />} 重新爬取
                        </Button>
                    </div>
                )}
            </div>

            {error && <Alert variant="danger">{error}</Alert>}
            {failures >= 3 && (
                <Alert variant="danger">
                    爬蟲已連續失敗 {failures} 次，生效資料可能完全依賴手動覆寫。
                </Alert>
            )}

            <section className="exam-schedule-status-card">
                <div>
                    <span>測驗場次</span>
                    <strong>{data.crawled?.session || '尚無場次資料'}</strong>
                </div>
                <div>
                    <span>爬蟲狀態</span>
                    <Badge bg={data.crawled?.available ? 'success' : 'danger'}>
                        {data.crawled?.available ? '可用' : '無法取得'}
                    </Badge>
                </div>
                <div>
                    <span>最後成功</span>
                    <strong>{formatDateTime(data.status?.last_success_at)}</strong>
                </div>
                <div>
                    <span>最後失敗</span>
                    <strong>{formatDateTime(data.status?.last_failure_at)}</strong>
                </div>
                {data.status?.last_failure_reason && (
                    <div className="exam-schedule-failure-reason">
                        <span>失敗原因</span>
                        <strong>{data.status.last_failure_reason}</strong>
                    </div>
                )}
            </section>

            {loading ? (
                <div className="exam-schedule-loading">
                    <Spinner animation="border" />
                    <span>載入考試時程中…</span>
                </div>
            ) : !error && (
                <div className="exam-schedule-comparison">
                    <section className="exam-schedule-table-card">
                        <header>
                            <h2>爬蟲原始結果</h2>
                            <p>未套用任何後台覆寫的來源資料</p>
                        </header>
                        {data.crawled?.available === false && !data.crawled?.phases?.length ? (
                            <div className="exam-schedule-empty">爬蟲目前無法取得資料</div>
                        ) : (
                            <Table responsive hover className="exam-schedule-table">
                                <thead>
                                    <tr>
                                        <th>階段</th>
                                        <th>名稱</th>
                                        <th>開始日期</th>
                                        <th>結束日期</th>
                                    </tr>
                                </thead>
                                <tbody>{renderRows(data.crawled?.phases || [])}</tbody>
                            </Table>
                        )}
                    </section>
                    <section className="exam-schedule-table-card">
                        <header>
                            <h2>後台生效值</h2>
                            <p>目前實際對外提供的時程資料</p>
                        </header>
                        {!data.effective_phases?.length ? (
                            <div className="exam-schedule-empty">目前沒有任何生效中的時程資料</div>
                        ) : (
                            <Table responsive hover className="exam-schedule-table">
                                <thead>
                                    <tr>
                                        <th>階段</th>
                                        <th>名稱</th>
                                        <th>開始日期</th>
                                        <th>結束日期</th>
                                        {CONTENT_EDITORS.includes(role) && <th>操作</th>}
                                    </tr>
                                </thead>
                                <tbody>{renderRows(data.effective_phases, true)}</tbody>
                            </Table>
                        )}
                    </section>
                </div>
            )}

            <Modal
                show={Boolean(editTarget)}
                onHide={formSubmitting ? undefined : closeEditor}
                centered
                backdrop={formSubmitting ? 'static' : true}
                keyboard={!formSubmitting}
            >
                <Form onSubmit={saveOverride}>
                    <Modal.Header closeButton={!formSubmitting}>
                        <Modal.Title>
                            {editTarget?.isNew ? '新增時程覆寫' : `編輯「${editTarget?.phase}」覆寫`}
                        </Modal.Title>
                    </Modal.Header>
                    <Modal.Body>
                        {editTarget?.isNew && (
                            <Form.Group className="exam-schedule-field" controlId="exam-schedule-phase">
                                <Form.Label>
                                    階段代碼 <span className="required-mark">*</span>
                                </Form.Label>
                                <Form.Control
                                    required
                                    value={newPhase}
                                    onChange={(e) => setNewPhase(e.target.value)}
                                    placeholder="例如：證書"
                                />
                            </Form.Group>
                        )}
                        <Form.Group className="exam-schedule-field" controlId="exam-schedule-label">
                            <Form.Label>名稱（選填）</Form.Label>
                            <Form.Control
                                value={form.label}
                                onChange={(e) => setForm({ ...form, label: e.target.value })}
                            />
                        </Form.Group>
                        <div className="exam-schedule-form-grid">
                            <Form.Group controlId="exam-schedule-start-date">
                                <Form.Label>
                                    開始日期 <span className="required-mark">*</span>
                                </Form.Label>
                                <Form.Control
                                    type="date"
                                    required
                                    value={form.start_date}
                                    onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                                />
                            </Form.Group>
                            <Form.Group controlId="exam-schedule-end-date">
                                <Form.Label>結束日期（選填）</Form.Label>
                                <Form.Control
                                    type="date"
                                    value={form.end_date}
                                    onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                                />
                            </Form.Group>
                        </div>
                        <Form.Check
                            type="switch"
                            id="exam-schedule-active"
                            label="啟用此覆寫"
                            checked={form.is_active}
                            onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                        />
                    </Modal.Body>
                    <Modal.Footer>
                        <Button type="button" variant="secondary" disabled={formSubmitting} onClick={closeEditor}>
                            取消
                        </Button>
                        <Button
                            type="submit"
                            disabled={
                                !form.start_date
                                || (editTarget?.isNew && !newPhase.trim())
                                || formSubmitting
                            }
                        >
                            {formSubmitting && <Spinner animation="border" size="sm" />} 儲存覆寫
                        </Button>
                    </Modal.Footer>
                </Form>
            </Modal>
        </main>
    );
}
