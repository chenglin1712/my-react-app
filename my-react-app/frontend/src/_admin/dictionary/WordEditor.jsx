import {
    useCallback, useEffect, useMemo, useState,
} from 'react';
import {
    Link,
    useLocation,
    useNavigate,
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
import { useNestedForm } from './useNestedForm';
import { useWordEditorData } from './useWordEditorData';
import {
    canApproveDictionaryChanges,
    canProposeDictionaryChanges,
} from './useRevisionActions';
import {
    REVISION_STATUS_META as STATUS_META, canManageRevision, pendingReviewNotice, revisionActorLabel, revisionFromSave,
} from './revisionMeta';
import { clearFieldError } from './fieldErrors';
import MediaUploadField from './MediaUploadField';
import WordBasicFields from './WordBasicFields';
import WordEditorExplanation, {
    emptySentence,
} from './WordEditorExplanation';
import '../../../static/css/_admin/dictionary.css';
import { SuccessNotice } from '../components/AdminToast';
import { confirmAction } from '@components/ui/ConfirmDialog';
import RevisionDetails from './RevisionDetails';
import { diffTrees, WORD_DIFF_SPEC } from './revisionDiff';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';
import { MediaUploadTrackerContext, useMediaUploadCounter } from './mediaUploadTracker';

// 稽核 FE7a-07：「核准刪除時一併解除所有引用」只有 owner／admin 能提出（後端同樣限制）。
// WP-8 追加：核准不再限制，reviewer 也能核准這種提案（審核畫面會明示核准後會解除引用）。
const UNLINK_ROLES = ['owner', 'admin'];

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

/**
 * revisionId：從 /admin/dictionary/revisions/:id 進來的「新建詞條提案」（見 DictionaryRevisionRoute），
 * 稽核 FE7a-02。這種提案還沒有 word_id，所以 isNew 仍為 true，但內容從提案載入。
 */
export default function WordEditor({ revisionId = null, initialRevision = null }) {
    const params = useParams();
    // 提案路由的 :id 是提案編號，不是詞條 id
    const id = revisionId ? undefined : params.id;
    const location = useLocation();
    const navigate = useNavigate();
    const { userData } = useAuth();
    const role = userData?.role;
    const isNew = !id;
    // P5.2 搜尋分析的「建立詞條草稿」按鈕從查無結果的查詢字串導過來，帶
    // 這個 state 預填詞形——只在新建當下讀一次（見下面 reset(EMPTY_WORD) 的
    // 呼叫點），不是持續綁定，使用者可以照常修改/清空這個欄位。
    const prefillName = location.state?.prefillName ?? '';

    const {
        tree,
        reset: resetTree,
        update,
        addChild,
        removeChild,
        moveChild,
        toPayload,
    } = useNestedForm(EMPTY_WORD);

    // 稽核 FE7a-04：記下最後一次載入／儲存時的表單內容，跟目前內容比對算出有沒有未儲存的變更
    const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(EMPTY_WORD));
    const reset = useCallback((nextTree) => {
        setSavedSnapshot(JSON.stringify(nextTree));
        resetTree(nextTree);
    }, [resetTree]);

    const {
        taxonomies, revision, currentWord, loading, saving,
        pageError, setPageError, fieldErrors, setFieldErrors, success, setSuccess,
        revisionActions, saveDraft: saveDraftWithPayload, runRevisionAction,
        conflict, deletion,
    } = useWordEditorData({
        id,
        revisionId,
        // DictionaryRevisionRoute 已經讀過這筆提案，直接沿用，省一次重複請求
        initialRevision,
        isNew,
        prefillName,
        reset,
        // 衝突時「改回我的版本」只換表單內容，不更新快照，讓未儲存保護仍然生效
        replaceForm: resetTree,
        emptyWord: EMPTY_WORD,
        emptyTaxonomies: EMPTY_TAXONOMIES,
        normalizeWord,
        revisionFromSave,
        // 第一次存檔後換到提案專屬網址，重新整理或離開後才找得回來（稽核 FE7a-02）
        // 這三個導頁都發生在存檔／核准／捨棄成功之後，dirty 要等下一次 render 才會更新，
        // 先 allowNextNavigation() 免得被下面自己的未儲存保護攔下（它在下方才宣告，
        // 但這些 callback 只會在之後的非同步動作裡被呼叫，那時早已宣告完成）。
        onCreated: (newRevisionId) => {
            allowNextNavigation();
            navigate(`/admin/dictionary/revisions/${newRevisionId}`, {
                replace: true,
                // 換網址會重新掛載編輯器，把成功訊息帶過去
                state: { flash: '草稿已儲存' },
            });
        },
        onCreateApproved: (wordId) => {
            allowNextNavigation();
            navigate(`/admin/dictionary/words/${wordId}`, { replace: true });
        },
        onNewDiscarded: () => {
            allowNextNavigation();
            navigate('/admin/dictionary/words', { replace: true });
        },
    });

    // 稽核 FE7a-08：任何一個媒體欄位上傳中，都不能儲存或送審
    const { uploadingCount, tracker: uploadTracker } = useMediaUploadCounter();
    const uploading = uploadingCount > 0;

    // 新建詞條第一次存檔後會換到提案專屬網址（重新掛載），由 route state 帶回成功訊息
    const flash = location.state?.flash;
    useEffect(() => {
        if (!flash) return;
        setSuccess(flash);
        // 顯示後就清掉 route state，避免重新整理時再出現一次
        navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    }, [flash, location.pathname, location.search, navigate, setSuccess]);

    // 退件意見只在這一頁的核准區塊用到，是純粹的表單欄位，留在元件裡。
    const [reviewComment, setReviewComment] = useState('');

    const revisionStatus = revision?.status ?? null;
    const canEditRole = canProposeDictionaryChanges(role);
    const canApprove = canApproveDictionaryChanges(role);
    // 刪除提案（operation === 'delete'）狀態雖然也是 draft，但它的內容
    // payload 是 null——語意上是「要刪除這個詞條」，不是可以繼續編輯的一般
    // 草稿。沒有排除的話，建立刪除提案後整份表單仍然可以編輯，「儲存草稿」
    // 還會把一般內容 payload 寫進這筆刪除提案裡。
    const isDeleteProposal = revision?.operation === 'delete';
    // 別人建立的草稿：唯讀，也不能送審、捨棄、撤回（後端同樣會擋）
    const canManage = canManageRevision(revision, { uid: userData?.uid, role });
    const foreignRevision = Boolean(revision) && !canManage;
    const editable = canEditRole && canManage && !isDeleteProposal && (
        (!revision && (isNew || Boolean(id)))
        || revisionStatus === 'draft'
    );

    const dirty = editable && !loading && JSON.stringify(toPayload()) !== savedSnapshot;
    const { allowNextNavigation } = useUnsavedChangesGuard(dirty);

    // 稽核 FE7a-13：更新提案與目前生效版本的差異（審核者不用逐欄自己比）
    const changes = useMemo(() => {
        if (!currentWord || revision?.operation !== 'update') return null;
        return diffTrees(currentWord, normalizeWord(toPayload()), WORD_DIFF_SPEC);
    }, [currentWord, revision?.operation, toPayload]);

    // WP-8 追加：取代原本的 unlinkBlocksApproval——不再擋核准，只提醒審核者核准會一併解除引用
    const approvalUnlinksReferences = isDeleteProposal
        && revision?.payload?.unlink_references === true;

    const statusLabel = useMemo(() => {
        if (revisionStatus) {
            return STATUS_META[revisionStatus]?.label ?? revisionStatus;
        }
        return isNew ? '尚未儲存' : '目前生效版本';
    }, [isNew, revisionStatus]);

    const updateRoot = (field, value) => {
        update([], { [field]: value });
        // 稽核 FE7a-05 殘留：改了欄位就拿掉它的錯誤標示
        setFieldErrors((current) => clearFieldError(current, field));
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

    // 必填檢查留在元件這一層：它問的是「這份表單填好了沒」，屬於表單的事，
    // 不是遠端流程的事（useWordEditorData 只負責送出與錯誤處理）。
    const saveDraft = async () => {
        setPageError('');
        setFieldErrors({});
        setSuccess('');

        if (!tree.tribe_id) {
            setPageError('族語為必填');
            setFieldErrors({ tribe_id: '族語為必填' });
            return null;
        }

        if (!tree.name.trim()) {
            setPageError('詞形為必填');
            setFieldErrors({ name: '詞形為必填' });
            return null;
        }

        const snapshot = JSON.stringify(toPayload());
        const saved = await saveDraftWithPayload(buildPayload);
        if (saved) setSavedSnapshot(snapshot);
        return saved;
    };

    // 稽核 FE7a-09：捨棄草稿不可復原，先確認
    const discardDraft = async () => {
        const confirmed = await confirmAction({
            title: '捨棄草稿',
            message: isDeleteProposal
                ? '確定要捨棄這個刪除提案嗎？詞條本身不受影響。'
                : '確定要捨棄這份草稿嗎？草稿中的所有修改都會消失，無法復原。',
            confirmLabel: '捨棄草稿',
        });
        if (!confirmed) return;
        await runRevisionAction(revisionActions.discard);
    };

    const {
        references, loadingReferences, showDeletePanel, setShowDeletePanel,
        unlinkReferences, setUnlinkReferences, hasReferences,
        open: openDeletePanel, create: createDeleteProposal,
    } = deletion;


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
                    {isDeleteProposal
                        && '此詞條已建立刪除提案，內容為唯讀；可以送審或捨棄這個提案。'}
                    {!isDeleteProposal && revisionStatus === 'pending_review'
                        && pendingReviewNotice(revision, { canWithdraw: canEditRole && canManage })}
                    {!isDeleteProposal && revisionStatus === 'approved'
                        && '此提案已核准，內容為唯讀。'}
                    {!isDeleteProposal && revisionStatus === 'rejected'
                        && '此提案已退件，內容為唯讀。'}
                    {!canEditRole
                        && '目前角色沒有詞條編輯權限。'}
                    {canEditRole && foreignRevision && revisionStatus === 'draft'
                        && `這是 ${revisionActorLabel(revision, 'created')} 建立的草稿，你無法修改。`}
                </Alert>
            )}

            {pageError && <Alert variant="danger">{pageError}</Alert>}
            {conflict.active && (
                <div className="dictionary-editor-actions">
                    <Button type="button" variant="outline-primary" onClick={conflict.reloadLatest}>
                        載入最新內容
                    </Button>
                    {conflict.latestLoaded && (
                        <Button type="button" variant="outline-secondary" onClick={conflict.restoreMine}>
                            改回我的版本
                        </Button>
                    )}
                </div>
            )}
            {revisionActions.error && (
                <Alert variant="danger">
                    {revisionActions.error}
                </Alert>
            )}
            <SuccessNotice message={success} />

            <RevisionDetails revision={revision} entityLabel="詞條" changes={changes} />
            {uploading && (
                <Alert variant="info" role="status">
                    檔案上傳中，完成後才能儲存草稿或送審。
                </Alert>
            )}

            <MediaUploadTrackerContext.Provider value={uploadTracker}>
            <Form
                className="dictionary-editor-card"
                onSubmit={(event) => {
                    event.preventDefault();
                    if (uploading) return;
                    saveDraft();
                }}
            >
                <WordBasicFields
                    tree={tree}
                    updateRoot={updateRoot}
                    editable={editable}
                    taxonomies={taxonomies}
                    toggleSource={toggleSource}
                    fieldErrors={fieldErrors}
                />

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
                            disabled={saving || revisionActions.pending || uploading}
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
                        && canEditRole && canManage && (
                        <>
                            <Button
                                type="button"
                                variant="success"
                                disabled={
                                    saving || revisionActions.pending || uploading
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
                                onClick={discardDraft}
                            >
                                <Trash2 size={17} />
                                捨棄草稿
                            </Button>
                        </>
                    )}

                    {revisionStatus === 'pending_review'
                        && canEditRole && canManage && (
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
            </MediaUploadTrackerContext.Provider>

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

                    {approvalUnlinksReferences && (
                        <Alert variant="warning">
                            此刪除提案設定了「一併解除引用」：核准後除了刪除詞條，其他詞條與文法例句中對它的引用也會被清除連結，請確認後再核准。
                        </Alert>
                    )}

                    <div className="dictionary-editor-actions">
                        <Button
                            type="button"
                            variant="success"
                            disabled={revisionActions.pending}
                            onClick={() => runRevisionAction(
                                () => revisionActions.approve({
                                    reviewComment: reviewComment.trim(),
                                    // 稽核 BE1-03：核准的是審核者載入時看到的那一版
                                    baseUpdatedAt: revision?.updated_at,
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
                                        && UNLINK_ROLES.includes(role)
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
                                            disabled={saving || revisionActions.pending}
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
