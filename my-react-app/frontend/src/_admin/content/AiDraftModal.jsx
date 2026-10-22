import { useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Form, Modal, Spinner } from 'react-bootstrap';
import { Sparkles, X } from 'lucide-react';
import { apiPost } from '../../../utils/apiClient';
import { TRIBE_FULL_NAME_BY_SLUG, TRIBE_ID_BY_SLUG } from '../../constants/tribes';
import WordPicker from '../dictionary/WordPicker';

export const AI_DRAFT_ENDPOINT = '/adminapi/quiz-bank/situations/ai-draft/';
const MAX_WORDS = 5;

// 只依狀態碼與後端固定代碼對應說明，不顯示後端或模型的原始訊息
function errorText(err) {
    const code = err?.data?.code;
    if (code === 'ai_quiz_draft_disabled') return '「AI 產生題目」尚未開放，請到「功能開關」開啟 ai_quiz_draft_enabled。';
    if (err?.status === 429) return '產生太頻繁了，請稍候一分鐘再試。';
    if (err?.status === 403) return 'AI 助手目前暫停使用（可能已達本月預算上限）。';
    if (err?.status === 422) return '這次沒有產生出可用的題目，請換幾個詞條再試一次。';
    return '產生失敗，請稍後再試。';
}

/**
 * 後台「AI 產生情境題草稿」。挑 1~5 個辭典詞條，產生的題目一律是草稿，
 * 送審後要由其他審核者核可才會上線。辭典查無的族語詞會標示在結果上，提醒審核者重點檢查。
 */
export default function AiDraftModal({ show, onHide, onCreated }) {
    const [tribe, setTribe] = useState('tayal');
    const [words, setWords] = useState([]);
    const [count, setCount] = useState(1);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [created, setCreated] = useState([]);
    const [pickerKey, setPickerKey] = useState(0);
    const resultRef = useRef(null);
    const alive = useRef(true);

    useEffect(() => () => { alive.current = false; }, []);
    useEffect(() => {
        if (show) {
            setWords([]);
            setCreated([]);
            setError('');
            setCount(1);
        }
    }, [show]);
    useEffect(() => {
        if (created.length) resultRef.current?.focus();
    }, [created]);

    const addWord = ({ word_id: id, word_name: name }) => {
        if (!id || words.some((w) => w.id === id) || words.length >= MAX_WORDS) return;
        setWords([...words, { id, name }]);
        setPickerKey((k) => k + 1);                    // 清空搜尋框，方便接著挑下一個
    };

    const changeTribe = (value) => {
        setTribe(value);
        setWords([]);                                  // 詞條屬於特定族語，換族語就要重挑
        setPickerKey((k) => k + 1);
    };

    const generate = async (event) => {
        event.preventDefault();
        if (busy || !words.length) return;
        setBusy(true);
        setError('');
        setCreated([]);
        try {
            const result = await apiPost(AI_DRAFT_ENDPOINT, {
                tribe, word_ids: words.map((w) => w.id), count: Number(count),
            });
            if (!alive.current) return;
            setCreated(result.items ?? []);
            onCreated?.();
        } catch (err) {
            if (alive.current) setError(errorText(err));
        } finally {
            if (alive.current) setBusy(false);
        }
    };

    return (
        <Modal
            show={show}
            onHide={busy ? undefined : onHide}
            centered
            size="lg"
            backdrop={busy ? 'static' : true}
            keyboard={!busy}
        >
            <Form onSubmit={generate}>
                <Modal.Header closeButton={!busy}>
                    <Modal.Title>AI 產生情境題草稿</Modal.Title>
                </Modal.Header>
                <Modal.Body>
                    <p className="quiz-bank-ai-note">
                        AI 只會用你挑的辭典詞條出題，產生的題目是「草稿」，
                        要送審並由其他審核者確認族語正確後才會上線。
                    </p>

                    <Form.Group className="quiz-bank-field" controlId="quiz-ai-draft-tribe">
                        <Form.Label>族語</Form.Label>
                        <Form.Select
                            value={tribe}
                            disabled={busy}
                            onChange={(event) => changeTribe(event.target.value)}
                        >
                            {Object.entries(TRIBE_FULL_NAME_BY_SLUG).map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                            ))}
                        </Form.Select>
                    </Form.Group>

                    <div className="quiz-bank-field">
                        <WordPicker
                            key={pickerKey}
                            tribeId={TRIBE_ID_BY_SLUG[tribe]}
                            disabled={busy || words.length >= MAX_WORDS}
                            onSelect={addWord}
                            label={`出題詞條（最多 ${MAX_WORDS} 個）`}
                        />
                        {words.length > 0 && (
                            <ul className="quiz-bank-ai-words" aria-label="已挑選的詞條">
                                {words.map((word) => (
                                    <li key={word.id}>
                                        <span lang="und">{word.name}</span>
                                        <button
                                            type="button"
                                            className="quiz-bank-ai-remove"
                                            disabled={busy}
                                            aria-label={`移除 ${word.name}`}
                                            onClick={() => setWords(words.filter((w) => w.id !== word.id))}
                                        >
                                            <X size={14} aria-hidden="true" />
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <Form.Group className="quiz-bank-field" controlId="quiz-ai-draft-count">
                        <Form.Label>題數</Form.Label>
                        <Form.Select
                            value={count}
                            disabled={busy}
                            onChange={(event) => setCount(event.target.value)}
                        >
                            {[1, 2, 3].map((n) => <option key={n} value={n}>{n} 題</option>)}
                        </Form.Select>
                    </Form.Group>

                    {error && <Alert variant="danger" role="alert">{error}</Alert>}

                    <div
                        ref={resultRef}
                        tabIndex={-1}
                        className="quiz-bank-ai-result"
                        role="status"
                        aria-live="polite"
                    >
                        {busy && '正在產生題目，通常需要十幾秒…'}
                        {!busy && created.length > 0 && (
                            <>
                                <strong>已建立 {created.length} 則草稿</strong>
                                <ul>
                                    {created.map((item) => (
                                        <li key={item.id}>
                                            {item.scenario_chinese}
                                            {item.ai_draft?.unverified_words?.length > 0 && (
                                                <Badge bg="warning" text="dark" className="ms-2">
                                                    辭典查無：{item.ai_draft.unverified_words.join('、')}
                                                </Badge>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                                <p>請在列表中檢查內容後送審。</p>
                            </>
                        )}
                    </div>
                </Modal.Body>
                <Modal.Footer>
                    <Button type="button" variant="secondary" disabled={busy} onClick={onHide}>
                        {created.length ? '關閉' : '取消'}
                    </Button>
                    <Button
                        type="submit"
                        className="quiz-bank-ai-submit"
                        aria-disabled={busy || !words.length}
                    >
                        {busy
                            ? <Spinner animation="border" size="sm" />
                            : <Sparkles size={16} aria-hidden="true" />}
                        {' '}產生草稿
                    </Button>
                </Modal.Footer>
            </Form>
        </Modal>
    );
}
