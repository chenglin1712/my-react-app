import { useEffect, useState } from 'react';
import {
    Alert, Button, Form, Nav, Spinner, Table,
} from 'react-bootstrap';
import {
    Pencil, Plus, Save, Trash2, X,
} from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import {
    apiDelete, apiGet, apiPatch, apiPost,
} from '../../../utils/apiClient';
import '../../../static/css/_admin/quiz-bank.css';
import '../../../static/css/_admin/dictionary.css';

const PUBLISHERS = ['owner', 'admin'];
const STAFF_ROLES = ['owner', 'admin', 'editor', 'reviewer', 'analyst'];

const EMPTY_CONFIG = {
    listening_questions_per_round: 0,
    listening_options_per_question: 0,
    sentence_questions_per_round: 0,
    sentence_options_per_question: 0,
    pronunciation_max_audio_mb: 0,
    pronunciation_excellent_threshold: 0,
    pronunciation_good_threshold: 0,
    pronunciation_fair_threshold: 0,
    pronunciation_pass_threshold: 0,
    crossword_grid_size: 0,
    crossword_min_word_length: 0,
    crossword_max_word_length: 0,
    crossword_words_per_round: 0,
    crossword_compute_time_limit_seconds: 0,
};

const EMPTY_WORD = {
    word: '',
    meaning: '',
    sort_order: 0,
};

const CONFIG_SECTIONS = [
    {
        title: '聽力',
        fields: [
            ['listening_questions_per_round', '每輪題數'],
            ['listening_options_per_question', '每題選項數'],
        ],
    },
    {
        title: '句型',
        fields: [
            ['sentence_questions_per_round', '每輪題數'],
            ['sentence_options_per_question', '每題選項數'],
        ],
    },
    {
        title: '發音',
        fields: [
            ['pronunciation_max_audio_mb', '錄音檔大小上限 MB'],
            ['pronunciation_excellent_threshold', '「優秀」門檻分數'],
            ['pronunciation_good_threshold', '「不錯」門檻分數'],
            ['pronunciation_fair_threshold', '「繼續加油」門檻分數'],
            ['pronunciation_pass_threshold', '後端判定 passed 的門檻分數'],
        ],
    },
    {
        title: '填字',
        fields: [
            ['crossword_grid_size', '網格大小（正方形邊長）'],
            ['crossword_min_word_length', '候選詞最短長度'],
            ['crossword_max_word_length', '候選詞最長長度'],
            ['crossword_words_per_round', '每輪最多候選詞數'],
            ['crossword_compute_time_limit_seconds', '運算時限秒數'],
        ],
    },
];

const configFromResponse = (item) => Object.fromEntries(
    Object.keys(EMPTY_CONFIG).map((key) => [key, item[key] ?? EMPTY_CONFIG[key]]),
);

export default function GameSettings() {
    const { userData } = useAuth();
    const role = userData?.role;
    const editable = PUBLISHERS.includes(role);
    const canView = STAFF_ROLES.includes(role);

    const [activeTab, setActiveTab] = useState('config');
    const [config, setConfig] = useState(EMPTY_CONFIG);
    const [metadata, setMetadata] = useState({ updated_by: '', updated_at: '' });
    const [words, setWords] = useState([]);
    const [newWord, setNewWord] = useState(EMPTY_WORD);
    const [editingId, setEditingId] = useState(null);
    const [editDraft, setEditDraft] = useState(null);

    const [loading, setLoading] = useState(true);
    const [savingConfig, setSavingConfig] = useState(false);
    const [creating, setCreating] = useState(false);
    const [savingEdit, setSavingEdit] = useState(false);
    const [deletingId, setDeletingId] = useState(null);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        let active = true;

        (async () => {
            try {
                const [configResponse, wordsResponse] = await Promise.all([
                    apiGet('/adminapi/game-config/'),
                    apiGet('/adminapi/crossword-tayal-words/'),
                ]);
                if (!active) return;

                setConfig(configFromResponse(configResponse));
                setMetadata({
                    updated_by: configResponse.updated_by ?? '',
                    updated_at: configResponse.updated_at ?? '',
                });
                setWords(wordsResponse.results ?? []);
            } catch (err) {
                if (active) setError(err.message);
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => {
            active = false;
        };
    }, []);

    const selectTab = (key) => {
        if (!key) return;
        setActiveTab(key);
        setError('');
        setSuccess('');
        setEditingId(null);
        setEditDraft(null);
    };

    const updateConfig = (field, value) => {
        setConfig((current) => ({ ...current, [field]: value }));
    };

    const saveConfig = async (event) => {
        event.preventDefault();
        setError('');
        setSuccess('');
        setSavingConfig(true);

        try {
            const payload = Object.fromEntries(
                Object.entries(config).map(([key, value]) => [key, parseInt(value, 10)]),
            );
            const saved = await apiPatch('/adminapi/game-config/', payload);
            setConfig(configFromResponse(saved));
            setMetadata({
                updated_by: saved.updated_by ?? '',
                updated_at: saved.updated_at ?? '',
            });
            setSuccess('遊戲參數已儲存');
        } catch (err) {
            setError(err.message);
        } finally {
            setSavingConfig(false);
        }
    };

    const createWord = async (event) => {
        event.preventDefault();
        setError('');
        setSuccess('');
        setCreating(true);

        try {
            const payload = {
                word: newWord.word.trim(),
                meaning: newWord.meaning.trim(),
                sort_order: parseInt(newWord.sort_order, 10),
            };
            const created = await apiPost('/adminapi/crossword-tayal-words/', payload);
            setWords((current) => [...current, created]);
            setNewWord(EMPTY_WORD);
            setSuccess(`已新增「${created.word}」`);
        } catch (err) {
            setError(err.message);
        } finally {
            setCreating(false);
        }
    };

    const startEdit = (row) => {
        setEditingId(row.id);
        setEditDraft({
            word: row.word,
            meaning: row.meaning,
            sort_order: row.sort_order,
        });
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditDraft(null);
    };

    const saveWord = async (row) => {
        setError('');
        setSuccess('');
        setSavingEdit(true);

        try {
            const payload = {
                word: editDraft.word.trim(),
                meaning: editDraft.meaning.trim(),
                sort_order: parseInt(editDraft.sort_order, 10),
            };
            const saved = await apiPatch(
                `/adminapi/crossword-tayal-words/${row.id}/`,
                payload,
            );
            setWords((current) => current.map((item) => (
                item.id === row.id ? saved : item
            )));
            cancelEdit();
            setSuccess(`已更新「${saved.word}」`);
        } catch (err) {
            setError(err.message);
        } finally {
            setSavingEdit(false);
        }
    };

    const removeWord = async (row) => {
        if (!window.confirm(`確定要刪除「${row.word}」嗎？此操作無法復原。`)) return;

        setError('');
        setSuccess('');
        setDeletingId(row.id);

        try {
            await apiDelete(`/adminapi/crossword-tayal-words/${row.id}/`);
            setWords((current) => current.filter((item) => item.id !== row.id));
            setSuccess(`已刪除「${row.word}」`);
        } catch (err) {
            setError(err.message);
        } finally {
            setDeletingId(null);
        }
    };

    if (loading) {
        return (
            <div className="quiz-bank-loading">
                <Spinner animation="border" />
                <span>載入中…</span>
            </div>
        );
    }

    return (
        <main className="quiz-bank-admin-page">
            <div className="quiz-bank-page-heading">
                <div>
                    <h1>遊戲參數設定</h1>
                    <p>聽力／句型／發音／填字四個遊戲的可調參數，以及填字遊戲泰雅語內建詞庫</p>
                </div>
            </div>

            {!canView && (
                <Alert variant="danger">你的角色沒有權限檢視這項設定。</Alert>
            )}
            {!editable && canView && (
                <Alert variant="warning">
                    你可以檢視目前的遊戲參數與填字詞庫；只有擁有者或管理員可以變更。
                </Alert>
            )}
            {error && <Alert variant="danger">{error}</Alert>}
            {success && <Alert variant="success">{success}</Alert>}

            <Nav
                variant="tabs"
                className="dictionary-taxonomy-tabs"
                activeKey={activeTab}
                onSelect={selectTab}
            >
                <Nav.Item>
                    <Nav.Link eventKey="config">遊戲參數設定</Nav.Link>
                </Nav.Item>
                <Nav.Item>
                    <Nav.Link eventKey="words">填字詞庫（泰雅語）</Nav.Link>
                </Nav.Item>
            </Nav>

            {activeTab === 'config' ? (
                <Form
                    className="quiz-bank-config-card dictionary-taxonomy-card"
                    onSubmit={saveConfig}
                >
                    {CONFIG_SECTIONS.map((section) => (
                        <section className="quiz-bank-config-section" key={section.title}>
                            <div className="quiz-bank-config-section-heading">
                                <h2>{section.title}</h2>
                            </div>
                            <div className="quiz-bank-config-grid">
                                {section.fields.map(([field, label]) => (
                                    <Form.Group
                                        controlId={`game-config-${field}`}
                                        key={field}
                                    >
                                        <Form.Label>{`${section.title}：${label}`}</Form.Label>
                                        <Form.Control
                                            type="number"
                                            step="1"
                                            disabled={!editable}
                                            value={config[field]}
                                            onChange={(event) => updateConfig(
                                                field,
                                                event.target.value,
                                            )}
                                        />
                                    </Form.Group>
                                ))}
                            </div>
                        </section>
                    ))}

                    <div className="quiz-bank-config-footer">
                        <span>
                            最後更新：
                            {metadata.updated_by || '尚無紀錄'}
                            {metadata.updated_at ? `・${metadata.updated_at}` : ''}
                        </span>
                        {editable && (
                            <Button type="submit" disabled={savingConfig}>
                                {savingConfig
                                    ? <Spinner animation="border" size="sm" />
                                    : <Save size={17} />}
                                {savingConfig ? '儲存中…' : '儲存設定'}
                            </Button>
                        )}
                    </div>
                </Form>
            ) : (
                <div className="dictionary-table-card dictionary-taxonomy-card">
                    {editable && (
                        <Form
                            className="dictionary-taxonomy-create-form"
                            onSubmit={createWord}
                        >
                            <div className="game-word-create-grid">
                                <Form.Group controlId="crossword-new-sort-order">
                                    <Form.Label>排序</Form.Label>
                                    <Form.Control
                                        type="number"
                                        step="1"
                                        value={newWord.sort_order}
                                        onChange={(event) => setNewWord((current) => ({
                                            ...current,
                                            sort_order: event.target.value,
                                        }))}
                                    />
                                </Form.Group>
                                <Form.Group controlId="crossword-new-word">
                                    <Form.Label>單字</Form.Label>
                                    <Form.Control
                                        required
                                        value={newWord.word}
                                        onChange={(event) => setNewWord((current) => ({
                                            ...current,
                                            word: event.target.value,
                                        }))}
                                    />
                                </Form.Group>
                                <Form.Group controlId="crossword-new-meaning">
                                    <Form.Label>中文提示</Form.Label>
                                    <Form.Control
                                        required
                                        value={newWord.meaning}
                                        onChange={(event) => setNewWord((current) => ({
                                            ...current,
                                            meaning: event.target.value,
                                        }))}
                                    />
                                </Form.Group>
                                <Button
                                    type="submit"
                                    disabled={
                                        creating
                                        || !newWord.word.trim()
                                        || !newWord.meaning.trim()
                                    }
                                >
                                    {creating
                                        ? <Spinner animation="border" size="sm" />
                                        : <Plus size={16} />}
                                    新增
                                </Button>
                            </div>
                        </Form>
                    )}

                    <Table responsive hover className="dictionary-table">
                        <thead>
                            <tr>
                                <th>排序</th>
                                <th>單字</th>
                                <th>中文提示</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {words.length > 0 ? words.map((row) => {
                                const isEditing = editingId === row.id;

                                return (
                                    <tr key={row.id}>
                                        <td>
                                            {isEditing ? (
                                                <Form.Control
                                                    size="sm"
                                                    type="number"
                                                    step="1"
                                                    aria-label={`${row.word} 排序`}
                                                    value={editDraft.sort_order}
                                                    onChange={(event) => setEditDraft(
                                                        (current) => ({
                                                            ...current,
                                                            sort_order: event.target.value,
                                                        }),
                                                    )}
                                                />
                                            ) : row.sort_order}
                                        </td>
                                        <td>
                                            {isEditing ? (
                                                <Form.Control
                                                    size="sm"
                                                    aria-label={`${row.word} 單字`}
                                                    value={editDraft.word}
                                                    onChange={(event) => setEditDraft(
                                                        (current) => ({
                                                            ...current,
                                                            word: event.target.value,
                                                        }),
                                                    )}
                                                />
                                            ) : (
                                                <span className="dictionary-word-name">
                                                    {row.word}
                                                </span>
                                            )}
                                        </td>
                                        <td>
                                            {isEditing ? (
                                                <Form.Control
                                                    size="sm"
                                                    aria-label={`${row.word} 中文提示`}
                                                    value={editDraft.meaning}
                                                    onChange={(event) => setEditDraft(
                                                        (current) => ({
                                                            ...current,
                                                            meaning: event.target.value,
                                                        }),
                                                    )}
                                                />
                                            ) : row.meaning}
                                        </td>
                                        <td>
                                            <div className="dictionary-row-actions">
                                                {isEditing ? (
                                                    <>
                                                        <Button
                                                            size="sm"
                                                            variant="outline-primary"
                                                            disabled={
                                                                savingEdit
                                                                || !editDraft.word.trim()
                                                                || !editDraft.meaning.trim()
                                                            }
                                                            onClick={() => saveWord(row)}
                                                        >
                                                            {savingEdit
                                                                ? (
                                                                    <Spinner
                                                                        animation="border"
                                                                        size="sm"
                                                                    />
                                                                )
                                                                : <Save size={14} />}
                                                            儲存
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="outline-secondary"
                                                            disabled={savingEdit}
                                                            onClick={cancelEdit}
                                                        >
                                                            <X size={14} />
                                                            取消
                                                        </Button>
                                                    </>
                                                ) : editable && (
                                                    <>
                                                        <Button
                                                            size="sm"
                                                            variant="outline-secondary"
                                                            onClick={() => startEdit(row)}
                                                        >
                                                            <Pencil size={14} />
                                                            編輯
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="outline-danger"
                                                            disabled={deletingId === row.id}
                                                            onClick={() => removeWord(row)}
                                                        >
                                                            {deletingId === row.id
                                                                ? (
                                                                    <Spinner
                                                                        animation="border"
                                                                        size="sm"
                                                                    />
                                                                )
                                                                : <Trash2 size={14} />}
                                                            刪除
                                                        </Button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            }) : (
                                <tr>
                                    <td colSpan="4" className="dictionary-empty">
                                        尚無填字詞庫資料
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </Table>
                </div>
            )}
        </main>
    );
}
