import { Alert, Button, Form, Modal, Spinner, Table } from 'react-bootstrap';
import { Plus } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { TRIBE_FULL_NAME_BY_SLUG } from '../../constants/tribes';
import RejectReasonModal from '../reviewWorkflow/RejectReasonModal';
import ReviewActions from '../reviewWorkflow/ReviewActions';
import ReviewPagination from '../reviewWorkflow/ReviewPagination';
import { useReviewableContentCrud } from '../reviewWorkflow/useReviewableContentCrud';
import {
    QUIZ_BANK_EDITORS as CONTENT_EDITORS,
    QUIZ_BANK_ROLES,
    QUIZ_BANK_STATUSES as STATUSES,
    QuizStatusBadge,
} from './quizBankReviewMeta';
import '../../../static/css/_admin/quiz-bank.css';

const emptyOption = () => ({ foreign: '', chinese: '' });

const EMPTY_FORM = {
    tribe: 'tayal',
    scenario_chinese: '',
    options: [
        emptyOption(),
        emptyOption(),
        emptyOption(),
        emptyOption(),
    ],
    answer: 1,
};

function formFrom(item) {
    return {
        tribe: item.tribe,
        scenario_chinese: item.scenario_chinese,
        options: item.options,
        answer: Number(item.answer) || 1,
    };
}

export default function QuizSituations() {
    const { userData } = useAuth();
    const role = userData?.role;
    const {
        items, data, loading, error, hasNext, page, setPage,
        filters, setFilters, search,
        actionId, handleAction, reject, editor,
    } = useReviewableContentCrud({
        endpoint: '/adminapi/quiz-bank/situations/',
        initialFilters: { tribe: '', status: '' },
        emptyForm: EMPTY_FORM,
        formFrom,
        deleteConfirmMessage: () => '確定要刪除這則情境題嗎？',
    });

    const { target: editTarget, form, setForm } = editor;

    const updateOption = (index, field, value) => {
        const options = form.options.map((option, optionIndex) => (
            optionIndex === index
                ? { ...option, [field]: value }
                : option
        ));
        setForm({ ...form, options });
    };

    const saveForm = async (event) => {
        event.preventDefault();
        // answer 要轉成數字才送出，是情境題特有的；其餘流程共用
        // useReviewableContentCrud 的 save（FE-2）。
        await editor.save(null, { ...form, answer: Number(form.answer) });
    };


    const canSave = (
        form.scenario_chinese.trim()
        && form.options.every((option) => option.foreign.trim())
    );
    const formSubmitting = actionId === 'form';

    return (
        <main className="quiz-bank-admin-page">
            <div className="quiz-bank-page-heading">
                <div>
                    <h1>情境題</h1>
                    <p>情境式對話練習——獨立的族語對話入口，不掛在官方認證等級系統裡</p>
                </div>
            </div>

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
                    {Object.entries(TRIBE_FULL_NAME_BY_SLUG).map(([value, label]) => (
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
                    <Button onClick={editor.openNew}>
                        <Plus size={18} /> 新增情境題
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
                                <th>情境描述</th>
                                <th>狀態</th>
                                <th>建立者</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.length ? items.map((item) => (
                                <tr key={item.id}>
                                    <td>{TRIBE_FULL_NAME_BY_SLUG[item.tribe] ?? item.tribe}</td>
                                    <td className="quiz-bank-truncate-cell">
                                        {item.scenario_chinese}
                                    </td>
                                    <td>
                                        <QuizStatusBadge item={item} />
                                    </td>
                                    <td>{item.created_by || '—'}</td>
                                    <td>
                                        <div className="quiz-bank-row-actions">
                                            <ReviewActions
                                                item={item}
                                                role={role}
                                                roles={QUIZ_BANK_ROLES}
                                                busy={actionId === item.id}
                                                disabled={Boolean(actionId) && actionId !== item.id}
                                                onAction={handleAction}
                                            />
                                        </div>
                                    </td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan="5" className="quiz-bank-empty">
                                        沒有符合條件的情境題
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </Table>
                )}

                <ReviewPagination
                    data={data}
                    page={page}
                    setPage={setPage}
                    loading={loading}
                    hasNext={hasNext}
                />
            </div>

            <Modal
                show={Boolean(editTarget)}
                onHide={formSubmitting ? undefined : editor.close}
                centered
                size="lg"
                backdrop={formSubmitting ? 'static' : true}
                keyboard={!formSubmitting}
            >
                <Form onSubmit={saveForm}>
                    <Modal.Header closeButton={!formSubmitting}>
                        <Modal.Title>
                            {editTarget?.id ? '編輯情境題' : '新增情境題'}
                        </Modal.Title>
                    </Modal.Header>
                    <Modal.Body>
                        <Form.Group
                            className="quiz-bank-field"
                            controlId="quiz-situation-tribe"
                        >
                            <Form.Label>族語</Form.Label>
                            <Form.Select
                                value={form.tribe}
                                onChange={(event) => setForm({
                                    ...form,
                                    tribe: event.target.value,
                                })}
                            >
                                {Object.entries(TRIBE_FULL_NAME_BY_SLUG).map(([value, label]) => (
                                    <option key={value} value={value}>
                                        {label}
                                    </option>
                                ))}
                            </Form.Select>
                        </Form.Group>

                        <Form.Group
                            className="quiz-bank-field"
                            controlId="quiz-situation-scenario"
                        >
                            <Form.Label>
                                情境描述 <span className="required-mark">*</span>
                            </Form.Label>
                            <Form.Control
                                as="textarea"
                                rows={3}
                                required
                                value={form.scenario_chinese}
                                onChange={(event) => setForm({
                                    ...form,
                                    scenario_chinese: event.target.value,
                                })}
                                placeholder="例如：長輩遞給你食物，你要怎麼用族語回應？"
                            />
                        </Form.Group>

                        {form.options.map((option, index) => (
                            <div className="quiz-bank-option-row" key={index}>
                                <Form.Check
                                    type="radio"
                                    name="quiz-situation-answer"
                                    checked={form.answer === index + 1}
                                    onChange={() => setForm({
                                        ...form,
                                        answer: index + 1,
                                    })}
                                    aria-label={`選項 ${index + 1} 是否為正解`}
                                />
                                <Form.Control
                                    required
                                    value={option.foreign}
                                    onChange={(event) => updateOption(
                                        index,
                                        'foreign',
                                        event.target.value,
                                    )}
                                    placeholder={`選項 ${index + 1}：族語對話`}
                                />
                                <Form.Control
                                    value={option.chinese}
                                    onChange={(event) => updateOption(
                                        index,
                                        'chinese',
                                        event.target.value,
                                    )}
                                    placeholder="中文翻譯（選填）"
                                />
                            </div>
                        ))}

                        <Form.Text>
                            點選圓形按鈕標記正解，4 個選項的族語對話皆為必填、
                            中文翻譯選填。
                        </Form.Text>
                    </Modal.Body>
                    <Modal.Footer>
                        <Button
                            type="button"
                            variant="secondary"
                            disabled={formSubmitting}
                            onClick={editor.close}
                        >
                            取消
                        </Button>
                        <Button
                            type="submit"
                            disabled={!canSave || formSubmitting}
                        >
                            {formSubmitting && (
                                <Spinner animation="border" size="sm" />
                            )}{' '}
                            儲存
                        </Button>
                    </Modal.Footer>
                </Form>
            </Modal>

            <RejectReasonModal
                reject={reject}
                actionId={actionId}
                controlId="quiz-situation-reject-reason"
            />
        </main>
    );
}
