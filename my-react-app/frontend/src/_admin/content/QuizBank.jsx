import { Alert, Badge, Button, Form, Modal, Spinner, Table, Tab, Tabs } from 'react-bootstrap';
import { Minus, Plus } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { TRIBE_FULL_NAME_BY_SLUG } from '../../constants/tribes';
import RejectReasonModal from '../reviewWorkflow/RejectReasonModal';
import ReviewActions from '../reviewWorkflow/ReviewActions';
import ReviewPagination from '../reviewWorkflow/ReviewPagination';
import { useReviewableContentCrud } from '../reviewWorkflow/useReviewableContentCrud';
import '../../../static/css/_admin/quiz-bank.css';

const CONTENT_EDITORS = ['owner', 'admin', 'editor'];
// 核准／退件／下架用 approvers（含 reviewer），而不是 AnnouncementList
// 用的 publishers——族語老師（reviewer）必須能核准題庫內容，這是整個審定
// 流程存在的意義，不能照抄公告管理的角色門檻。
const QUIZ_BANK_ROLES = {
    editors: CONTENT_EDITORS,
    approvers: ['owner', 'admin', 'reviewer'],
    publishers: ['owner', 'admin'],
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
    const {
        items, data, loading, error, hasNext, page, setPage,
        filters, setFilters, search,
        actionId, handleAction, reject, editor,
    } = useReviewableContentCrud({
        endpoint: '/adminapi/quiz-bank/vocab/',
        initialFilters: { tribe: '', category: '', status: '' },
        emptyForm: EMPTY_VOCAB_FORM,
        formFrom: vocabFormFrom,
        deleteConfirmMessage: (item) => `確定要刪除「${item.foreign_word}」嗎？`,
    });

    const { target: editTarget, form, setForm } = editor;

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
                    {Object.entries(TRIBE_FULL_NAME_BY_SLUG).map(([value, label]) => (
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
                    <Button onClick={editor.openNew}>
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
                            {items.length ? items.map((item) => (
                                <tr key={item.id}>
                                    <td>{TRIBE_FULL_NAME_BY_SLUG[item.tribe] ?? item.tribe}</td>
                                    <td>{CATEGORIES[item.category] ?? item.category}</td>
                                    <td>{item.foreign_word}</td>
                                    <td>{item.chinese_gloss}</td>
                                    <td><StatusCell item={item} /></td>
                                    <td>{item.created_by || '—'}</td>
                                    <td>
                                        <div className="quiz-bank-row-actions">
                                            <ReviewActions
                                                item={item}
                                                role={role}
                                                roles={QUIZ_BANK_ROLES}
                                                busy={actionId === item.id}
                                                onAction={handleAction}
                                            />
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
                onHide={editor.close}
                centered
            >
                <Form onSubmit={editor.save}>
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
                                    {Object.entries(TRIBE_FULL_NAME_BY_SLUG).map(([value, label]) => (
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
                        <Button variant="secondary" onClick={editor.close}>
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

            <RejectReasonModal
                reject={reject}
                actionId={actionId}
                controlId="quiz-vocab-reject-reason"
            />
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
    const {
        items, data, loading, error, hasNext, page, setPage,
        filters, setFilters, search,
        actionId, handleAction, reject, editor,
    } = useReviewableContentCrud({
        endpoint: '/adminapi/quiz-bank/cloze/',
        initialFilters: { tribe: '', status: '' },
        emptyForm: EMPTY_CLOZE_FORM,
        formFrom: clozeFormFrom,
        deleteConfirmMessage: () => '確定要刪除這篇短文嗎？',
    });

    const { target: editTarget, form, setForm } = editor;

    const addBlank = () => {
        // 用「目前存在的 blankN 最大序號 + 1」推導新 key，不能用
        // Object.keys(...).length + 1——刪除中間一個空格後（例如剩下
        // blank1、blank3），用數量推導出來的下一個 key 會撞到既有的
        // blank3，新增空格會直接覆蓋掉它原本的選項/答案/備註，使用者的
        // 資料在畫面上就這樣悄悄不見了（獨立審查找到的問題）。
        const existingIndexes = Object.keys(form.blanks)
            .map((key) => parseInt(key.replace('blank', ''), 10))
            .filter((n) => !Number.isNaN(n));
        const nextIndex = existingIndexes.length > 0 ? Math.max(...existingIndexes) + 1 : 1;
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
                            {items.length ? items.map((item) => (
                                <tr key={item.id}>
                                    <td>{TRIBE_FULL_NAME_BY_SLUG[item.tribe] ?? item.tribe}</td>
                                    <td className="quiz-bank-truncate-cell">
                                        {item.passage_foreign}
                                    </td>
                                    <td>{Object.keys(item.blanks || {}).length}</td>
                                    <td><StatusCell item={item} /></td>
                                    <td>{item.created_by || '—'}</td>
                                    <td>
                                        <div className="quiz-bank-row-actions">
                                            <ReviewActions
                                                item={item}
                                                role={role}
                                                roles={QUIZ_BANK_ROLES}
                                                busy={actionId === item.id}
                                                onAction={handleAction}
                                            />
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
                onHide={editor.close}
                centered
                size="lg"
            >
                <Form onSubmit={editor.save}>
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
                                {Object.entries(TRIBE_FULL_NAME_BY_SLUG).map(([value, label]) => (
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
                        <Button variant="secondary" onClick={editor.close}>
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

            <RejectReasonModal
                reject={reject}
                actionId={actionId}
                controlId="quiz-cloze-reject-reason"
            />
        </div>
    );
}
