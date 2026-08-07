import {
    useCallback,
    useEffect,
    useMemo,
    useState,
} from 'react';
import {
    Link,
    useLocation,
    useParams,
} from 'react-router-dom';
import {
    Alert,
    Badge,
    Button,
    Form,
    Spinner,
} from 'react-bootstrap';
import {
    ArrowLeft,
    Check,
    FileAudio,
    Plus,
    Save,
    Send,
    Trash2,
    Undo2,
    X,
} from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import {
    createWordProposal,
    getRevision,
    getWord,
    getWordReferences,
    listTaxonomies,
    proposeWordDelete,
    proposeWordUpdate,
    updateRevisionPayload,
} from './dictionaryApi';
import { useNestedForm } from './useNestedForm';
import {
    canApproveDictionaryChanges,
    canProposeDictionaryChanges,
    useRevisionActions,
} from './useRevisionActions';
import MediaUploadField from './MediaUploadField';
import WordEditorExplanation, {
    emptySentence,
} from './WordEditorExplanation';
import '../../../static/css/_admin/dictionary.css';

const EMPTY_TAXONOMIES = {
    tribes: [],
    source: [],
    category: [],
    part_of_speech: [],
    focus: [],
};

const emptyAudio = () => ({
    id: null,
    external_id: '',
    file_id: '',
    audio_class: '',
});

const emptyExplanation = () => ({
    id: null,
    external_id: '',
    chinese_explanation: '',
    english_explanation: '',
    category_ids: [],
    pos_ids: [],
    focus_ids: [],
    images: [],
    sentences: [],
});

const EMPTY_WORD = {
    tribe_id: '',
    dialect: '',
    name: '',
    pinyin: '',
    variant: '',
    formation_word: '',
    derivative_root: '',
    frequency: 0,
    hit: 0,
    dictionary_note: '',
    word_img: '',
    is_derivative_root: false,
    is_image: false,
    is_zuzucidian: false,
    is_other_dialect: false,
    source_ids: [],
    audios: [],
    explanations: [],
};

const STATUS_META = {
    draft: {
        label: '草稿',
        bg: 'secondary',
    },
    pending_review: {
        label: '送審中',
        bg: 'warning',
        text: 'dark',
    },
    approved: {
        label: '已核准',
        bg: 'success',
    },
    rejected: {
        label: '已退件',
        bg: 'danger',
    },
};

const WORD_FIELDS = Object.keys(EMPTY_WORD);

function normalizeAudio(audio = {}) {
    return {
        id: audio.id ?? null,
        external_id: audio.external_id ?? '',
        file_id: audio.file_id ?? '',
        audio_class: audio.audio_class ?? '',
    };
}

function normalizeImage(image = {}) {
    return {
        id: image.id ?? null,
        image_url: image.image_url ?? '',
    };
}

function normalizeItem(item = {}) {
    return {
        id: item.id ?? null,
        name: item.name ?? '',
        word_id: item.word_id ?? null,
        word_name: item.word_name ?? null,
    };
}

function normalizeAnaphora(anaphora = {}) {
    return {
        id: anaphora.id ?? null,
        is_highlight: Boolean(anaphora.is_highlight),
        is_symbol: Boolean(anaphora.is_symbol),
        items: (anaphora.items ?? []).map(normalizeItem),
    };
}

function normalizeSentence(sentence = {}) {
    return {
        ...emptySentence(),
        id: sentence.id ?? null,
        external_id: sentence.external_id ?? '',
        original_sentence: sentence.original_sentence ?? '',
        chinese_sentence: sentence.chinese_sentence ?? '',
        english_sentence: sentence.english_sentence ?? '',
        audios: (sentence.audios ?? []).map(normalizeAudio),
        anaphoras: (sentence.anaphoras ?? []).map(normalizeAnaphora),
    };
}

function normalizeExplanation(explanation = {}) {
    return {
        ...emptyExplanation(),
        id: explanation.id ?? null,
        external_id: explanation.external_id ?? '',
        chinese_explanation: explanation.chinese_explanation ?? '',
        english_explanation: explanation.english_explanation ?? '',
        category_ids: explanation.category_ids ?? [],
        pos_ids: explanation.pos_ids ?? [],
        focus_ids: explanation.focus_ids ?? [],
        images: (explanation.images ?? []).map(normalizeImage),
        sentences: (explanation.sentences ?? []).map(normalizeSentence),
    };
}

function normalizeWord(source = {}) {
    const word = {};

    WORD_FIELDS.forEach((field) => {
        word[field] = source[field] ?? EMPTY_WORD[field];
    });

    return {
        ...word,
        frequency: Number(source.frequency ?? 0),
        hit: Number(source.hit ?? 0),
        is_derivative_root: Boolean(source.is_derivative_root),
        is_image: Boolean(source.is_image),
        is_zuzucidian: Boolean(source.is_zuzucidian),
        is_other_dialect: Boolean(source.is_other_dialect),
        source_ids: source.source_ids ?? [],
        audios: (source.audios ?? []).map(normalizeAudio),
        explanations: (source.explanations ?? []).map(
            normalizeExplanation,
        ),
    };
}

function revisionFromSave(result, fallback) {
    const revisionId = result?.revision_id ?? result?.id ?? fallback?.id;

    return {
        ...fallback,
        ...result,
        id: revisionId,
        status: result?.status ?? fallback?.status ?? 'draft',
        operation: result?.operation ?? fallback?.operation,
        payload: result?.payload ?? fallback?.payload,
    };
}

export default function WordEditor() {
    const { id } = useParams();
    const location = useLocation();
    const { userData } = useAuth();
    const role = userData?.role;
    const isNew = !id;
    // P5.2 搜尋分析的「建立詞條草稿」按鈕從查無結果的查詢字串導過來，帶
    // 這個 state 預填詞形——只在新建當下讀一次（見下面 reset(EMPTY_WORD) 的
    // 呼叫點），不是持續綁定，使用者可以照常修改/清空這個欄位。
    const prefillName = location.state?.prefillName ?? '';

    const {
        tree,
        reset,
        update,
        addChild,
        removeChild,
        moveChild,
        toPayload,
    } = useNestedForm(EMPTY_WORD);

    const [taxonomies, setTaxonomies] = useState(EMPTY_TAXONOMIES);
    const [revision, setRevision] = useState(null);
    const [baseHash, setBaseHash] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [pageError, setPageError] = useState('');
    const [success, setSuccess] = useState('');
    const [reviewComment, setReviewComment] = useState('');
    const [references, setReferences] = useState(null);
    const [loadingReferences, setLoadingReferences] = useState(false);
    const [showDeletePanel, setShowDeletePanel] = useState(false);
    const [unlinkReferences, setUnlinkReferences] = useState(false);

    const revisionStatus = revision?.status ?? null;
    const canEditRole = canProposeDictionaryChanges(role);
    const canApprove = canApproveDictionaryChanges(role);
    const editable = canEditRole && (
        (!revision && (isNew || Boolean(id)))
        || revisionStatus === 'draft'
    );

    const handleRevisionChanged = useCallback((result) => {
        setPageError('');
        setSuccess('提案狀態已更新');
        setRevision((current) => revisionFromSave(result, current));
    }, []);

    const revisionActions = useRevisionActions(
        revision?.id ?? null,
        { onChanged: handleRevisionChanged },
    );

    useEffect(() => {
        let active = true;

        (async () => {
            setLoading(true);
            setPageError('');

            try {
                const taxonomyResult = await listTaxonomies();
                if (!active) return;
                setTaxonomies({
                    ...EMPTY_TAXONOMIES,
                    ...taxonomyResult,
                });

                if (isNew) {
                    reset(prefillName ? { ...EMPTY_WORD, name: prefillName } : EMPTY_WORD);
                    return;
                }

                const word = await getWord(id);
                if (!active) return;

                setBaseHash(word.content_hash ?? '');

                const pending = word.meta?.pending_revision;

                if (pending) {
                    const loadedRevision = await getRevision(pending.id);
                    if (!active) return;

                    setRevision({
                        ...pending,
                        ...loadedRevision,
                        id: loadedRevision.id ?? pending.id,
                    });
                    reset(normalizeWord(
                        loadedRevision.payload ?? word,
                    ));
                } else {
                    setRevision(null);
                    reset(normalizeWord(word));
                }
            } catch (err) {
                if (active) setPageError(err.message);
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => {
            active = false;
        };
    }, [id, isNew, reset, prefillName]);

    const statusLabel = useMemo(() => {
        if (revisionStatus) {
            return STATUS_META[revisionStatus]?.label ?? revisionStatus;
        }
        return isNew ? '尚未儲存' : '目前生效版本';
    }, [isNew, revisionStatus]);

    const updateRoot = (field, value) => {
        update([], { [field]: value });
    };

    const toggleSource = (sourceId) => {
        updateRoot(
            'source_ids',
            tree.source_ids.includes(sourceId)
                ? tree.source_ids.filter((idValue) => idValue !== sourceId)
                : [...tree.source_ids, sourceId],
        );
    };

    const buildPayload = () => {
        const payload = toPayload();

        return {
            ...payload,
            name: payload.name.trim(),
            dialect: payload.dialect.trim(),
            pinyin: payload.pinyin.trim(),
            variant: payload.variant.trim(),
            formation_word: payload.formation_word.trim(),
            derivative_root: payload.derivative_root.trim(),
            frequency: Number(payload.frequency) || 0,
            hit: Number(payload.hit) || 0,
            dictionary_note: payload.dictionary_note,
        };
    };

    const saveDraft = async () => {
        setPageError('');
        setSuccess('');

        if (!tree.tribe_id) {
            setPageError('族語為必填');
            return null;
        }

        if (!tree.name.trim()) {
            setPageError('詞形為必填');
            return null;
        }

        setSaving(true);

        try {
            const payload = buildPayload();
            let result;

            if (revision?.id) {
                if (revision.status !== 'draft') {
                    throw new Error('只有草稿提案可以修改內容');
                }

                result = await updateRevisionPayload(
                    revision.id,
                    payload,
                );
            } else if (isNew) {
                result = await createWordProposal(payload);
            } else {
                result = await proposeWordUpdate(id, {
                    ...payload,
                    base_hash: baseHash,
                });
            }

            const nextRevision = revisionFromSave(result, {
                ...revision,
                operation: isNew ? 'create' : 'update',
                status: 'draft',
                payload,
            });

            setRevision(nextRevision);
            setSuccess('草稿已儲存');

            return nextRevision;
        } catch (err) {
            if (err.status === 409) {
                setPageError(
                    `${err.message} 詞條在編輯期間已被其他人修改，`
                    + '請重新整理頁面取得最新內容後再建立提案。',
                );
            } else {
                setPageError(err.message);
            }
            return null;
        } finally {
            setSaving(false);
        }
    };

    const runRevisionAction = async (action) => {
        setPageError('');
        setSuccess('');

        try {
            await action();
        } catch {
            // useRevisionActions 已保存 err.message，畫面統一顯示。
        }
    };

    const openDeletePanel = async () => {
        setPageError('');
        setShowDeletePanel(true);
        setLoadingReferences(true);

        try {
            setReferences(await getWordReferences(id));
        } catch (err) {
            setPageError(err.message);
        } finally {
            setLoadingReferences(false);
        }
    };

    const createDeleteProposal = async () => {
        setSaving(true);
        setPageError('');
        setSuccess('');

        try {
            const result = await proposeWordDelete(
                id,
                unlinkReferences,
            );
            setRevision(revisionFromSave(result, {
                status: 'draft',
                operation: 'delete',
                payload: null,
            }));
            setShowDeletePanel(false);
            setSuccess('刪除提案草稿已建立');
        } catch (err) {
            setPageError(err.message);
        } finally {
            setSaving(false);
        }
    };

    const hasReferences = (
        (references?.counts?.anaphora_items ?? 0)
        + (references?.counts?.grammar_example_words ?? 0)
    ) > 0;

    if (loading) {
        return (
            <div className="dictionary-loading">
                <Spinner animation="border" />
                <span>載入詞條中…</span>
            </div>
        );
    }

    return (
        <main className="dictionary-admin-page dictionary-editor-page">
            <Button
                as={Link}
                variant="link"
                className="dictionary-back-link"
                to="/admin/dictionary/words"
            >
                <ArrowLeft size={17} />
                返回詞條列表
            </Button>

            <div className="dictionary-page-heading">
                <div>
                    <h1>{isNew ? '新增詞條' : '詞條詳情'}</h1>
                    <p>
                        狀態：
                        <Badge
                            className="ms-2"
                            bg={
                                STATUS_META[revisionStatus]?.bg
                                ?? (revisionStatus ? 'secondary' : 'info')
                            }
                            text={STATUS_META[revisionStatus]?.text}
                        >
                            {statusLabel}
                        </Badge>
                    </p>
                </div>
            </div>

            {!editable && (
                <Alert variant="warning">
                    {revisionStatus === 'pending_review'
                        && '此提案正在送審，欄位為唯讀；編輯者可先撤回提案再修改。'}
                    {revisionStatus === 'approved'
                        && '此提案已核准，內容為唯讀。'}
                    {revisionStatus === 'rejected'
                        && '此提案已退件，內容為唯讀。'}
                    {!canEditRole
                        && '目前角色沒有詞條編輯權限。'}
                </Alert>
            )}

            {pageError && <Alert variant="danger">{pageError}</Alert>}
            {revisionActions.error && (
                <Alert variant="danger">
                    {revisionActions.error}
                </Alert>
            )}
            {success && <Alert variant="success">{success}</Alert>}

            <Form
                className="dictionary-editor-card"
                onSubmit={(event) => {
                    event.preventDefault();
                    saveDraft();
                }}
            >
                <div className="dictionary-form-grid">
                    <Form.Group
                        className="dictionary-field"
                        controlId="dictionary-word-tribe"
                    >
                        <Form.Label>
                            族語 <span className="required-mark">*</span>
                        </Form.Label>
                        <Form.Select
                            required
                            disabled={!editable}
                            value={tree.tribe_id}
                            onChange={(event) => updateRoot(
                                'tribe_id',
                                event.target.value,
                            )}
                        >
                            <option value="">請選擇族語</option>
                            {taxonomies.tribes.map((tribe) => (
                                <option key={tribe.id} value={tribe.id}>
                                    {tribe.name}
                                </option>
                            ))}
                        </Form.Select>
                    </Form.Group>

                    <Form.Group
                        className="dictionary-field"
                        controlId="dictionary-word-name"
                    >
                        <Form.Label>
                            詞形 <span className="required-mark">*</span>
                        </Form.Label>
                        <Form.Control
                            required
                            disabled={!editable}
                            value={tree.name}
                            onChange={(event) => updateRoot(
                                'name',
                                event.target.value,
                            )}
                        />
                    </Form.Group>

                    <Form.Group
                        className="dictionary-field"
                        controlId="dictionary-word-dialect"
                    >
                        <Form.Label>方言別</Form.Label>
                        <Form.Control
                            disabled={!editable}
                            value={tree.dialect}
                            onChange={(event) => updateRoot(
                                'dialect',
                                event.target.value,
                            )}
                        />
                    </Form.Group>

                    <Form.Group
                        className="dictionary-field"
                        controlId="dictionary-word-pinyin"
                    >
                        <Form.Label>拼音</Form.Label>
                        <Form.Control
                            disabled={!editable}
                            value={tree.pinyin}
                            onChange={(event) => updateRoot(
                                'pinyin',
                                event.target.value,
                            )}
                        />
                    </Form.Group>

                    <Form.Group
                        className="dictionary-field"
                        controlId="dictionary-word-variant"
                    >
                        <Form.Label>變體</Form.Label>
                        <Form.Control
                            disabled={!editable}
                            value={tree.variant}
                            onChange={(event) => updateRoot(
                                'variant',
                                event.target.value,
                            )}
                        />
                    </Form.Group>

                    <Form.Group
                        className="dictionary-field"
                        controlId="dictionary-word-formation"
                    >
                        <Form.Label>構詞</Form.Label>
                        <Form.Control
                            disabled={!editable}
                            value={tree.formation_word}
                            onChange={(event) => updateRoot(
                                'formation_word',
                                event.target.value,
                            )}
                        />
                    </Form.Group>

                    <Form.Group
                        className="dictionary-field"
                        controlId="dictionary-word-derivative-root"
                    >
                        <Form.Label>衍生詞根</Form.Label>
                        <Form.Control
                            disabled={!editable}
                            value={tree.derivative_root}
                            onChange={(event) => updateRoot(
                                'derivative_root',
                                event.target.value,
                            )}
                        />
                    </Form.Group>

                    <Form.Group
                        className="dictionary-field"
                        controlId="dictionary-word-frequency"
                    >
                        <Form.Label>詞頻</Form.Label>
                        <Form.Control
                            type="number"
                            min="0"
                            disabled={!editable}
                            value={tree.frequency}
                            onChange={(event) => updateRoot(
                                'frequency',
                                event.target.value,
                            )}
                        />
                    </Form.Group>
                </div>

                <Form.Group
                    className="dictionary-field"
                    controlId="dictionary-word-note"
                >
                    <Form.Label>辭典備註</Form.Label>
                    <Form.Control
                        as="textarea"
                        rows={4}
                        disabled={!editable}
                        value={tree.dictionary_note}
                        onChange={(event) => updateRoot(
                            'dictionary_note',
                            event.target.value,
                        )}
                    />
                </Form.Group>

                <MediaUploadField
                    kind="image"
                    label="詞條圖片"
                    value={tree.word_img}
                    disabled={!editable}
                    onChange={(wordImg) => updateRoot(
                        'word_img',
                        wordImg,
                    )}
                />

                <fieldset
                    className="dictionary-field"
                    disabled={!editable}
                >
                    <legend>詞條屬性</legend>
                    <div className="dictionary-inline-checks">
                        <Form.Check
                            id="dictionary-is-derivative-root"
                            type="checkbox"
                            label="衍生詞根"
                            checked={tree.is_derivative_root}
                            onChange={(event) => updateRoot(
                                'is_derivative_root',
                                event.target.checked,
                            )}
                        />
                        <Form.Check
                            id="dictionary-is-image"
                            type="checkbox"
                            label="圖像詞條"
                            checked={tree.is_image}
                            onChange={(event) => updateRoot(
                                'is_image',
                                event.target.checked,
                            )}
                        />
                        <Form.Check
                            id="dictionary-is-zuzucidian"
                            type="checkbox"
                            label="族語辭典詞條"
                            checked={tree.is_zuzucidian}
                            onChange={(event) => updateRoot(
                                'is_zuzucidian',
                                event.target.checked,
                            )}
                        />
                        <Form.Check
                            id="dictionary-is-other-dialect"
                            type="checkbox"
                            label="其他方言"
                            checked={tree.is_other_dialect}
                            onChange={(event) => updateRoot(
                                'is_other_dialect',
                                event.target.checked,
                            )}
                        />
                    </div>
                </fieldset>

                <fieldset
                    className="dictionary-taxonomy-field"
                    disabled={!editable}
                >
                    <legend>資料來源</legend>
                    <div className="dictionary-checkbox-grid">
                        {taxonomies.source.map((source) => (
                            <Form.Check
                                key={source.id}
                                id={`dictionary-source-${source.id}`}
                                type="checkbox"
                                label={source.name}
                                checked={tree.source_ids.includes(source.id)}
                                onChange={() => toggleSource(source.id)}
                            />
                        ))}
                    </div>
                </fieldset>

                <div className="dictionary-child-section">
                    <div className="dictionary-child-heading">
                        <h2>詞條音檔</h2>
                        {editable && (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline-primary"
                                onClick={() => addChild(
                                    [],
                                    'audios',
                                    emptyAudio,
                                )}
                            >
                                <FileAudio size={15} />
                                新增詞條音檔
                            </Button>
                        )}
                    </div>

                    {tree.audios.length === 0 && (
                        <p className="dictionary-empty-note">
                            尚未新增詞條音檔。
                        </p>
                    )}

                    {tree.audios.map((audio, audioIndex) => {
                        const audioPath = [{
                            field: 'audios',
                            key: audio._key,
                        }];

                        return (
                            <div
                                className="dictionary-media-row"
                                key={audio._key}
                            >
                                <MediaUploadField
                                    kind="audio"
                                    label={`詞條音檔 ${audioIndex + 1}`}
                                    value={audio.file_id}
                                    disabled={!editable}
                                    onChange={(fileId) => update(audioPath, {
                                        file_id: fileId,
                                    })}
                                />

                                <Form.Group
                                    className="dictionary-field"
                                    controlId={`word-audio-class-${audio._key}`}
                                >
                                    <Form.Label>音檔分類</Form.Label>
                                    <Form.Control
                                        disabled={!editable}
                                        value={audio.audio_class}
                                        onChange={(event) => update(audioPath, {
                                            audio_class: event.target.value,
                                        })}
                                    />
                                </Form.Group>

                                {editable && (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline-danger"
                                        onClick={() => removeChild(
                                            [],
                                            'audios',
                                            audio._key,
                                        )}
                                    >
                                        <Trash2 size={15} />
                                        刪除音檔
                                    </Button>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="dictionary-child-section">
                    <div className="dictionary-child-heading">
                        <h2>解釋</h2>
                        {editable && (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline-primary"
                                onClick={() => addChild(
                                    [],
                                    'explanations',
                                    emptyExplanation,
                                )}
                            >
                                <Plus size={15} />
                                新增解釋
                            </Button>
                        )}
                    </div>

                    {tree.explanations.length === 0 && (
                        <p className="dictionary-empty-note">
                            尚未新增解釋。
                        </p>
                    )}

                    {tree.explanations.map((
                        explanation,
                        explanationIndex,
                    ) => (
                        <WordEditorExplanation
                            key={explanation._key}
                            explanation={explanation}
                            path={[]}
                            index={explanationIndex}
                            count={tree.explanations.length}
                            tribeId={tree.tribe_id}
                            taxonomies={taxonomies}
                            disabled={!editable}
                            update={update}
                            addChild={addChild}
                            removeChild={removeChild}
                            moveChild={moveChild}
                        />
                    ))}
                </div>

                <div className="dictionary-editor-actions">
                    <Button
                        as={Link}
                        variant="outline-secondary"
                        to="/admin/dictionary/words"
                    >
                        取消
                    </Button>

                    {editable && (
                        <Button
                            type="submit"
                            variant="outline-primary"
                            disabled={saving || revisionActions.pending}
                        >
                            {saving ? (
                                <Spinner animation="border" size="sm" />
                            ) : (
                                <Save size={17} />
                            )}
                            儲存草稿
                        </Button>
                    )}

                    {revisionStatus === 'draft'
                        && canEditRole && (
                        <>
                            <Button
                                type="button"
                                variant="success"
                                disabled={
                                    saving || revisionActions.pending
                                }
                                onClick={() => runRevisionAction(
                                    revisionActions.submit,
                                )}
                            >
                                <Send size={17} />
                                送審
                            </Button>

                            <Button
                                type="button"
                                variant="outline-danger"
                                disabled={revisionActions.pending}
                                onClick={() => runRevisionAction(
                                    revisionActions.discard,
                                )}
                            >
                                <Trash2 size={17} />
                                捨棄草稿
                            </Button>
                        </>
                    )}

                    {revisionStatus === 'pending_review'
                        && canEditRole && (
                        <Button
                            type="button"
                            variant="outline-secondary"
                            disabled={revisionActions.pending}
                            onClick={() => runRevisionAction(
                                revisionActions.withdraw,
                            )}
                        >
                            <Undo2 size={17} />
                            撤回
                        </Button>
                    )}
                </div>
            </Form>

            {revisionStatus === 'pending_review' && canApprove && (
                <section className="dictionary-review-card">
                    <h2>審核提案</h2>

                    <Form.Group controlId="dictionary-review-comment">
                        <Form.Label>審核意見</Form.Label>
                        <Form.Control
                            as="textarea"
                            rows={3}
                            value={reviewComment}
                            onChange={(event) => setReviewComment(
                                event.target.value,
                            )}
                        />
                    </Form.Group>

                    <div className="dictionary-editor-actions">
                        <Button
                            type="button"
                            variant="success"
                            disabled={revisionActions.pending}
                            onClick={() => runRevisionAction(
                                () => revisionActions.approve({
                                    reviewComment: reviewComment.trim(),
                                }),
                            )}
                        >
                            <Check size={17} />
                            核准
                        </Button>

                        <Button
                            type="button"
                            variant="danger"
                            disabled={
                                revisionActions.pending
                                || !reviewComment.trim()
                            }
                            onClick={() => runRevisionAction(
                                () => revisionActions.reject(
                                    reviewComment.trim(),
                                ),
                            )}
                        >
                            <X size={17} />
                            退件
                        </Button>
                    </div>
                </section>
            )}

            {!isNew && !revision && canEditRole && (
                <section className="dictionary-danger-card">
                    <h2>刪除詞條</h2>
                    <p>
                        刪除也會先建立提案，核准後才會從正式辭典移除。
                    </p>

                    {!showDeletePanel ? (
                        <Button
                            type="button"
                            variant="outline-danger"
                            onClick={openDeletePanel}
                        >
                            <Trash2 size={17} />
                            建立刪除提案
                        </Button>
                    ) : (
                        <>
                            {loadingReferences ? (
                                <div className="dictionary-loading">
                                    <Spinner animation="border" size="sm" />
                                    <span>檢查引用中…</span>
                                </div>
                            ) : references && (
                                <div className="dictionary-reference-summary">
                                    <p>
                                        標註引用：
                                        {references.counts?.anaphora_items ?? 0}
                                        {'；'}
                                        文法例句引用：
                                        {
                                            references.counts
                                                ?.grammar_example_words ?? 0
                                        }
                                    </p>

                                    {hasReferences && (
                                        <Alert variant="warning">
                                            此詞條仍被其他內容引用。若不解除引用，
                                            刪除提案在核准時會失敗。
                                        </Alert>
                                    )}

                                    {references.sample?.length > 0 && (
                                        <ul>
                                            {references.sample.map((
                                                sample,
                                                index,
                                            ) => (
                                                <li
                                                    key={
                                                        `${sample.word_id}-`
                                                        + `${index}`
                                                    }
                                                >
                                                    {sample.word_name || '—'}
                                                    {sample.sentence
                                                        ? `：${sample.sentence}`
                                                        : ''}
                                                </li>
                                            ))}
                                        </ul>
                                    )}

                                    {hasReferences
                                        && ['owner', 'admin'].includes(role)
                                        && (
                                        <Form.Check
                                            id="dictionary-unlink-references"
                                            type="checkbox"
                                            label="核准刪除時一併解除所有引用"
                                            checked={unlinkReferences}
                                            onChange={(event) => (
                                                setUnlinkReferences(
                                                    event.target.checked,
                                                )
                                            )}
                                        />
                                    )}

                                    <div className="dictionary-editor-actions">
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            onClick={() => {
                                                setShowDeletePanel(false);
                                                setUnlinkReferences(false);
                                            }}
                                        >
                                            取消刪除
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="danger"
                                            disabled={saving}
                                            onClick={createDeleteProposal}
                                        >
                                            確認建立刪除提案
                                        </Button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </section>
            )}
        </main>
    );
}
