import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { Link } from 'react-router-dom';
import {
    Alert,
    Badge,
    Button,
    Form,
    Spinner,
} from 'react-bootstrap';
import {
    ArrowDown,
    ArrowUp,
    Check,
    Plus,
    Save,
    Send,
    Trash2,
    Undo2,
    X,
} from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import {
    createGrammarSectionProposal,
    getGrammarSection,
    getRevision,
    isEditConflict,
    proposeGrammarSectionDelete,
    proposeGrammarSectionUpdate,
    updateRevisionPayload,
} from './dictionaryApi';
import WordPicker from './WordPicker';
import { useNestedForm } from './useNestedForm';
import {
    canApproveDictionaryChanges,
    canProposeDictionaryChanges,
    useRevisionActions,
} from './useRevisionActions';
import {
    REVISION_STATUS_META as STATUS_META, canManageRevision, pendingReviewNotice, revisionActorLabel, revisionFromSave,
} from './revisionMeta';
import { SECTION_FIELD_KEYS, clearFieldError, extractFieldErrors } from './fieldErrors';
import { useActionLock } from '../hooks/useActionLock';
import { confirmAction } from '@components/ui/ConfirmDialog';
import { SuccessNotice } from '../components/AdminToast';
import { formatApiError } from '../apiErrors';
import RevisionDetails from './RevisionDetails';
import { diffTrees, SECTION_DIFF_SPEC } from './revisionDiff';
import { useUnsavedChangesGuard } from '../hooks/useUnsavedChangesGuard';

const emptySection = (tribeId = '') => ({
    tribe_id: tribeId,
    section_key: '',
    title: '',
    description: '',
    rules: [],
});

const emptyRule = () => ({
    id: null,
    rule_key: '',
    title: '',
    structure: '',
    function: '',
    notes: '',
    affix_ids: [],
    examples: [],
});

const emptyExample = () => ({
    id: null,
    tribe_text: '',
    chinese_text: '',
    analysis: '',
    linked_words: [],
});

const emptyLinkedWord = () => ({
    word_id: null,
    word_name: null,
});

function normalizeSection(source, fallbackTribeId) {
    return {
        id: source.id ?? null,
        tribe_id: source.tribe_id ?? fallbackTribeId,
        section_key: source.section_key ?? '',
        title: source.title ?? '',
        description: source.description ?? '',
        rules: (source.rules ?? []).map((rule) => ({
            id: rule.id ?? null,
            rule_key: rule.rule_key ?? '',
            title: rule.title ?? '',
            structure: rule.structure ?? '',
            function: rule.function ?? '',
            notes: rule.notes ?? '',
            affix_ids: rule.affix_ids ?? [],
            examples: (rule.examples ?? []).map((example) => ({
                id: example.id ?? null,
                tribe_text: example.tribe_text ?? '',
                chinese_text: example.chinese_text ?? '',
                analysis: example.analysis ?? '',
                linked_words: (example.linked_words ?? []).map((word) => ({
                    word_id: word.word_id ?? null,
                    word_name: word.word_name ?? null,
                })),
            })),
        })),
    };
}

function AffixChecks({
    rule, path, options, disabled, update,
}) {
    const toggle = (affixId) => {
        update(path, {
            affix_ids: rule.affix_ids.includes(affixId)
                ? rule.affix_ids.filter((id) => id !== affixId)
                : [...rule.affix_ids, affixId],
        });
    };

    return (
        <fieldset className="dictionary-taxonomy-field" disabled={disabled}>
            <legend>詞綴</legend>
            <div className="dictionary-checkbox-grid">
                {options.length > 0 ? options.map((affix) => (
                    <Form.Check
                        key={affix.id}
                        id={`grammar-affix-${rule._key}-${affix.id}`}
                        type="checkbox"
                        label={affix.affix}
                        checked={rule.affix_ids.includes(affix.id)}
                        onChange={() => toggle(affix.id)}
                    />
                )) : (
                    <span className="dictionary-muted">此族語沒有可用詞綴</span>
                )}
            </div>
        </fieldset>
    );
}

function ExampleEditor({
    example,
    exampleIndex,
    exampleCount,
    rulePath,
    tribeId,
    disabled,
    update,
    addChild,
    removeChild,
    moveChild,
}) {
    const examplePath = [
        ...rulePath,
        { field: 'examples', key: example._key },
    ];

    return (
        <section className="dictionary-nested-card">
            <div className="dictionary-nested-heading">
                <h4>例句 {exampleIndex + 1}</h4>

                {!disabled && (
                    <div className="dictionary-row-actions">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline-secondary"
                            aria-label={`上移例句 ${exampleIndex + 1}`}
                            disabled={exampleIndex === 0}
                            onClick={() => moveChild(rulePath, 'examples', example._key, -1)}
                        >
                            <ArrowUp size={15} />
                        </Button>

                        <Button
                            type="button"
                            size="sm"
                            variant="outline-secondary"
                            aria-label={`下移例句 ${exampleIndex + 1}`}
                            disabled={exampleIndex === exampleCount - 1}
                            onClick={() => moveChild(rulePath, 'examples', example._key, 1)}
                        >
                            <ArrowDown size={15} />
                        </Button>

                        <Button
                            type="button"
                            size="sm"
                            variant="outline-danger"
                            onClick={() => removeChild(rulePath, 'examples', example._key)}
                        >
                            <Trash2 size={15} />
                            刪除例句
                        </Button>
                    </div>
                )}
            </div>

            <div className="dictionary-form-grid">
                <Form.Group className="dictionary-field" controlId={`grammar-example-tribe-${example._key}`}>
                    <Form.Label>族語例句</Form.Label>
                    <Form.Control
                        as="textarea"
                        rows={2}
                        disabled={disabled}
                        value={example.tribe_text}
                        onChange={(event) => update(examplePath, { tribe_text: event.target.value })}
                    />
                </Form.Group>

                <Form.Group className="dictionary-field" controlId={`grammar-example-chinese-${example._key}`}>
                    <Form.Label>中文翻譯</Form.Label>
                    <Form.Control
                        as="textarea"
                        rows={2}
                        disabled={disabled}
                        value={example.chinese_text}
                        onChange={(event) => update(examplePath, { chinese_text: event.target.value })}
                    />
                </Form.Group>

                <Form.Group className="dictionary-field" controlId={`grammar-example-analysis-${example._key}`}>
                    <Form.Label>分析</Form.Label>
                    <Form.Control
                        as="textarea"
                        rows={2}
                        disabled={disabled}
                        value={example.analysis}
                        onChange={(event) => update(examplePath, { analysis: event.target.value })}
                    />
                </Form.Group>
            </div>

            <div className="dictionary-child-section">
                <div className="dictionary-child-heading">
                    <h5>連結詞條</h5>

                    {!disabled && (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline-primary"
                            onClick={() => addChild(examplePath, 'linked_words', emptyLinkedWord)}
                        >
                            <Plus size={15} />
                            新增連結
                        </Button>
                    )}
                </div>

                {example.linked_words.length === 0 && (
                    <p className="dictionary-empty-note">尚未連結詞條。</p>
                )}

                {example.linked_words.map((linkedWord, wordIndex) => {
                    const linkedWordPath = [
                        ...examplePath,
                        { field: 'linked_words', key: linkedWord._key },
                    ];

                    return (
                        <div key={linkedWord._key} className="dictionary-anaphora-item">
                            <WordPicker
                                tribeId={tribeId}
                                wordId={linkedWord.word_id}
                                wordName={linkedWord.word_name ?? ''}
                                disabled={disabled}
                                label={`連結詞條 ${wordIndex + 1}`}
                                onSelect={(selection) => update(linkedWordPath, selection)}
                            />

                            {!disabled && (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline-danger"
                                    aria-label={`移除連結詞條 ${wordIndex + 1}`}
                                    onClick={() => removeChild(examplePath, 'linked_words', linkedWord._key)}
                                >
                                    <Trash2 size={15} />
                                    移除連結
                                </Button>
                            )}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

function RuleEditor({
    rule,
    ruleIndex,
    ruleCount,
    affixes,
    tribeId,
    disabled,
    update,
    addChild,
    removeChild,
    moveChild,
}) {
    const rulePath = [{ field: 'rules', key: rule._key }];

    return (
        <section className="dictionary-nested-card">
            <div className="dictionary-nested-heading">
                <h3>規則 {ruleIndex + 1}</h3>

                {!disabled && (
                    <div className="dictionary-row-actions">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline-secondary"
                            aria-label={`上移規則 ${ruleIndex + 1}`}
                            disabled={ruleIndex === 0}
                            onClick={() => moveChild([], 'rules', rule._key, -1)}
                        >
                            <ArrowUp size={15} />
                        </Button>

                        <Button
                            type="button"
                            size="sm"
                            variant="outline-secondary"
                            aria-label={`下移規則 ${ruleIndex + 1}`}
                            disabled={ruleIndex === ruleCount - 1}
                            onClick={() => moveChild([], 'rules', rule._key, 1)}
                        >
                            <ArrowDown size={15} />
                        </Button>

                        <Button
                            type="button"
                            size="sm"
                            variant="outline-danger"
                            onClick={() => removeChild([], 'rules', rule._key)}
                        >
                            <Trash2 size={15} />
                            刪除規則
                        </Button>
                    </div>
                )}
            </div>

            <div className="dictionary-form-grid">
                <Form.Group className="dictionary-field" controlId={`grammar-rule-key-${rule._key}`}>
                    <Form.Label>規則代碼</Form.Label>
                    <Form.Control
                        disabled={disabled}
                        value={rule.rule_key}
                        onChange={(event) => update(rulePath, { rule_key: event.target.value })}
                    />
                </Form.Group>

                <Form.Group className="dictionary-field" controlId={`grammar-rule-title-${rule._key}`}>
                    <Form.Label>規則名稱</Form.Label>
                    <Form.Control
                        disabled={disabled}
                        value={rule.title}
                        onChange={(event) => update(rulePath, { title: event.target.value })}
                    />
                </Form.Group>

                <Form.Group className="dictionary-field" controlId={`grammar-rule-structure-${rule._key}`}>
                    <Form.Label>結構</Form.Label>
                    <Form.Control
                        as="textarea"
                        rows={2}
                        disabled={disabled}
                        value={rule.structure}
                        onChange={(event) => update(rulePath, { structure: event.target.value })}
                    />
                </Form.Group>

                <Form.Group className="dictionary-field" controlId={`grammar-rule-function-${rule._key}`}>
                    <Form.Label>功能</Form.Label>
                    <Form.Control
                        as="textarea"
                        rows={2}
                        disabled={disabled}
                        value={rule.function}
                        onChange={(event) => update(rulePath, { function: event.target.value })}
                    />
                </Form.Group>

                <Form.Group className="dictionary-field" controlId={`grammar-rule-notes-${rule._key}`}>
                    <Form.Label>備註</Form.Label>
                    <Form.Control
                        as="textarea"
                        rows={2}
                        disabled={disabled}
                        value={rule.notes}
                        onChange={(event) => update(rulePath, { notes: event.target.value })}
                    />
                </Form.Group>
            </div>

            <AffixChecks rule={rule} path={rulePath} options={affixes} disabled={disabled} update={update} />

            <div className="dictionary-child-section">
                <div className="dictionary-child-heading">
                    <h4>例句</h4>

                    {!disabled && (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline-primary"
                            onClick={() => addChild(rulePath, 'examples', emptyExample)}
                        >
                            <Plus size={15} />
                            新增例句
                        </Button>
                    )}
                </div>

                {rule.examples.length === 0 && (
                    <p className="dictionary-empty-note">尚未新增例句。</p>
                )}

                {rule.examples.map((example, exampleIndex) => (
                    <ExampleEditor
                        key={example._key}
                        example={example}
                        exampleIndex={exampleIndex}
                        exampleCount={rule.examples.length}
                        rulePath={rulePath}
                        tribeId={tribeId}
                        disabled={disabled}
                        update={update}
                        addChild={addChild}
                        removeChild={removeChild}
                        moveChild={moveChild}
                    />
                ))}
            </div>
        </section>
    );
}

/**
 * revisionId：從 /admin/dictionary/revisions/:id 進來的「新建章節提案」（稽核 FE7a-02），
 * sectionId 此時為 null。onDirtyChange：把有沒有未儲存變更回報給 GrammarTree，
 * 切換章節／族語前先確認（稽核 FE7a-04）。focusOnLoad：載入完成後把焦點移到面板標題（稽核 FE7a-16）。
 */
export default function GrammarNodePanel({
    tribeId,
    sectionId,
    taxonomies,
    onSaved = () => {},
    revisionId = null,
    onDirtyChange,
    focusOnLoad = false,
    onCreateApproved,
    onNewDiscarded,
    onCreated,
    initialRevision = null,
    flashMessage = '',
}) {
    const { userData } = useAuth();
    const role = userData?.role;
    const isNew = sectionId === null;

    const {
        tree,
        reset: resetTree,
        update,
        addChild,
        removeChild,
        moveChild,
        toPayload,
    } = useNestedForm(emptySection(tribeId));

    // 稽核 FE7a-04：最後一次載入／儲存時的內容，用來判斷有沒有未儲存變更
    const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(emptySection(tribeId)));
    const reset = useCallback((nextTree) => {
        setSavedSnapshot(JSON.stringify(nextTree));
        resetTree(nextTree);
    }, [resetTree]);

    const [revision, setRevision] = useState(null);
    const [baseHash, setBaseHash] = useState('');
    // 目前生效的章節內容：刪除提案用它填表單（FE7a-03）、更新提案用它算變更摘要（FE7a-13）
    const [currentSection, setCurrentSection] = useState(null);
    // 稽核 FE7a-06：草稿 PUT 衝突時保留自己的版本
    const [conflict, setConflict] = useState(null);
    const headingRef = useRef(null);
    const [loading, setLoading] = useState(true);
    const [pageError, setPageError] = useState('');
    // 稽核 FE7a-05 殘留（WP-8 追加）：能對應到章節頂層欄位的驗證錯誤，給欄位顯示 isInvalid
    const [fieldErrors, setFieldErrors] = useState({});
    const [success, setSuccess] = useState('');
    const [reviewComment, setReviewComment] = useState('');
    const updateSectionField = (field, value) => {
        update([], { [field]: value });
        setFieldErrors((current) => clearFieldError(current, field));
    };

    // 儲存草稿、送審類動作（submit/withdraw/approve/reject/discard）、建立
    // 刪除提案彼此都應該互斥，共用同一把鎖——而不是像原本那樣各自用一個
    // state 當忙碌旗標（那樣擋不住「儲存」跟「送審」在同一個 tick 內各自
    // 被觸發一次）。
    const lock = useActionLock();
    const saving = lock.pendingKey === 'save' || lock.pendingKey === 'delete';

    const revisionStatus = revision?.status ?? null;
    const canEditRole = canProposeDictionaryChanges(role);
    const canApprove = canApproveDictionaryChanges(role);
    // 刪除提案（operation === 'delete'）也是 draft 狀態，但它的內容是
    // null——語意上是「要刪除這個章節」，不是可以繼續編輯的一般草稿。
    const isDeleteProposal = revision?.operation === 'delete';
    // 別人建立的草稿：唯讀，也不能送審、捨棄、撤回（後端同樣會擋）
    const canManage = canManageRevision(revision, { uid: userData?.uid, role });
    const foreignRevision = Boolean(revision) && !canManage;
    const editable = canEditRole && canManage && !isDeleteProposal && (
        (!revision && (isNew || Boolean(sectionId)))
        || revisionStatus === 'draft'
    );

    const dirty = editable && !loading && JSON.stringify(toPayload()) !== savedSnapshot;
    // 存檔／核准／捨棄成功後的 onCreated、onCreateApproved、onNewDiscarded 會由上層導頁，
    // 先 allowNextNavigation()，不然 dirty 還沒更新，會被這裡的未儲存保護自己攔下
    const { allowNextNavigation } = useUnsavedChangesGuard(dirty);
    useEffect(() => {
        onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);
    // 面板卸載時（換章節、離開頁面）清掉回報，避免父層以為還有未儲存內容
    useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

    const changes = useMemo(() => {
        if (!currentSection || revision?.operation !== 'update') return null;
        return diffTrees(currentSection, normalizeSection(toPayload(), tribeId), SECTION_DIFF_SPEC);
    }, [currentSection, revision?.operation, toPayload, tribeId]);

    const handleRevisionChanged = useCallback(async (result, actionKey) => {
        setPageError('');

        if (actionKey === 'discard') {
            // discard 成功後後端只回 { detail: '已捨棄' }，沒有 id/status/
            // payload；沿用 revisionFromSave(result, current) 合併會把舊
            // revision 的欄位整個從 current 補回來，畫面就會繼續顯示一個
            // 後端已經不存在的提案。
            setSuccess('提案已捨棄');
            setRevision(null);
            setConflict(null);

            if (isNew) {
                if (revisionId) {
                    allowNextNavigation();
                    onNewDiscarded?.();
                    return;
                }
                reset(emptySection(tribeId));
            } else {
                try {
                    const section = await getGrammarSection(sectionId);
                    setBaseHash(section.content_hash ?? '');
                    const current = normalizeSection(section, tribeId);
                    setCurrentSection(current);
                    reset(current);
                } catch (err) {
                    setPageError(formatApiError(err));
                }
            }

            await onSaved();
            return;
        }

        if (actionKey === 'approve' && isNew && result?.target_id) {
            allowNextNavigation();
            onCreateApproved?.(result.target_id);
        }

        setSuccess('提案狀態已更新');
        setRevision((current) => revisionFromSave(result, current));
        onSaved();
    }, [allowNextNavigation, isNew, onCreateApproved, onNewDiscarded, onSaved, reset, revisionId, sectionId, tribeId]);

    const revisionActions = useRevisionActions(
        revision?.id ?? null,
        { onChanged: handleRevisionChanged, lock },
    );

    useEffect(() => {
        let active = true;

        (async () => {
            setLoading(true);
            setPageError('');
            setFieldErrors({});
            setSuccess('');
            setRevision(null);
            setBaseHash('');
            setCurrentSection(null);
            setConflict(null);

            try {
                if (revisionId) {
                    // 提案頁（DictionaryRevisionRoute）已經讀過這筆提案，直接沿用
                    const loadedRevision = (
                        initialRevision && String(initialRevision.id) === String(revisionId)
                    ) ? initialRevision : await getRevision(revisionId);
                    if (!active) return;
                    if (loadedRevision.target_kind && loadedRevision.target_kind !== 'grammar_section') {
                        setPageError('這筆提案不是文法章節提案');
                        return;
                    }
                    setRevision(loadedRevision);
                    reset(normalizeSection(loadedRevision.payload ?? {}, tribeId));
                    return;
                }

                if (isNew) {
                    reset(emptySection(tribeId));
                    return;
                }

                const section = await getGrammarSection(sectionId);
                if (!active) return;

                setBaseHash(section.content_hash ?? '');
                const current = normalizeSection(section, tribeId);
                setCurrentSection(current);

                // 稽核 FE7a-01：open_revision 含草稿與送審中的提案；舊版後端只有 pending_revision 時退回用它
                const open = section.meta?.open_revision ?? section.meta?.pending_revision;

                if (open) {
                    const loadedRevision = await getRevision(open.id);
                    if (!active) return;

                    setRevision({
                        ...open,
                        ...loadedRevision,
                        id: loadedRevision.id ?? open.id,
                    });
                    // 稽核 FE7a-03：刪除提案表單顯示目前生效內容
                    reset(loadedRevision.operation === 'delete'
                        ? current
                        : normalizeSection(loadedRevision.payload ?? section, tribeId));
                } else {
                    setRevision(null);
                    reset(current);
                }
            } catch (err) {
                if (active) setPageError(formatApiError(err));
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => {
            active = false;
        };
    }, [initialRevision, isNew, reset, revisionId, sectionId, tribeId]);

    // 新建章節第一次存檔換到提案頁時，由呼叫端帶入成功訊息（載入流程會先清空 success，所以放在它後面）
    useEffect(() => {
        if (flashMessage) setSuccess(flashMessage);
    }, [flashMessage]);

    // 稽核 FE7a-16：手機寬度時面板在長清單下方，點章節後畫面看起來沒反應；載入完成後把焦點與視窗移到面板標題
    useEffect(() => {
        if (loading || !focusOnLoad || !headingRef.current) return;
        headingRef.current.focus({ preventScroll: true });
        headingRef.current.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    }, [focusOnLoad, loading]);

    const affixes = useMemo(
        () => (taxonomies.grammar_affix ?? []).filter(
            (affix) => String(affix.tribe_id) === String(tree.tribe_id),
        ),
        [taxonomies.grammar_affix, tree.tribe_id],
    );

    const statusLabel = revisionStatus
        ? STATUS_META[revisionStatus]?.label ?? revisionStatus
        : (isNew ? '尚未儲存' : '目前生效版本');

    const buildPayload = () => {
        const payload = toPayload();

        return {
            ...payload,
            tribe_id: payload.tribe_id,
            section_key: payload.section_key.trim(),
            title: payload.title.trim(),
            description: payload.description,
        };
    };

    const saveDraft = () => {
        setPageError('');
        setFieldErrors({});
        setSuccess('');

        if (!tree.tribe_id) {
            setPageError('族語為必填');
            return Promise.resolve(null);
        }

        if (!tree.title.trim()) {
            setPageError('章節名稱為必填');
            setFieldErrors({ title: '章節名稱為必填' });
            return Promise.resolve(null);
        }

        const snapshot = JSON.stringify(toPayload());

        return lock.runLocked('save', async () => {
            const payload = buildPayload();
            try {
                let result;

                if (revision?.id) {
                    if (revision.status !== 'draft') {
                        throw new Error('只有草稿提案可以修改內容');
                    }
                    result = await updateRevisionPayload(revision.id, payload, {
                        baseUpdatedAt: revision.updated_at,
                    });
                } else if (isNew) {
                    result = await createGrammarSectionProposal(payload);
                } else {
                    result = await proposeGrammarSectionUpdate(sectionId, {
                        ...payload,
                        base_hash: baseHash,
                    });
                }

                let nextRevision = revisionFromSave(result, {
                    ...revision,
                    operation: isNew ? 'create' : 'update',
                    status: 'draft',
                    payload,
                });
                if (!result?.updated_at && nextRevision.id) {
                    // 文法章節的建立／propose 端點不回 updated_at，補查一次，下次 PUT 才能帶樂觀鎖
                    try {
                        const loaded = await getRevision(nextRevision.id);
                        nextRevision = { ...nextRevision, updated_at: loaded.updated_at };
                    } catch {
                        // 補查失敗只是少了這次的版本檢查，不影響已存好的草稿
                    }
                }

                setRevision(nextRevision);
                setConflict(null);
                setSavedSnapshot(snapshot);
                setSuccess('草稿已儲存');
                await onSaved();

                if (isNew && !revision?.id && !revisionId && nextRevision.id) {
                    // 稽核 FE7a-02：新建章節第一次存檔後換到提案專屬網址，離開後才找得回來
                    allowNextNavigation();
                    onCreated?.(nextRevision.id);
                }

                return nextRevision;
            } catch (err) {
                if (isEditConflict(err)) {
                    // WP-8 追加：propose 撞到別人的草稿時，頁面原本沒有 revision，靠 409 附的 revision_id 載入
                    setConflict({ payload, latestLoaded: false, revisionId: err?.data?.revision_id });
                    setPageError(
                        '這份草稿在你編輯期間已被修改（可能是其他人，或你在另一個分頁存過）。'
                        + '可以先載入最新內容比對，再決定是否改回你的版本後重新儲存。',
                    );
                } else if (err.status === 409) {
                    setPageError(`${formatApiError(err)} 請重新載入最新內容後再建立提案。`);
                } else {
                    setPageError(formatApiError(err));
                    setFieldErrors(extractFieldErrors(err, SECTION_FIELD_KEYS));
                }
                return null;
            }
        });
    };

    const reloadLatestRevision = async () => {
        const targetId = revision?.id ?? conflict?.revisionId;
        if (!targetId) return;
        setPageError('');
        try {
            const loadedRevision = await getRevision(targetId);
            setRevision((current) => ({ ...current, ...loadedRevision }));
            reset(normalizeSection(loadedRevision.payload ?? {}, tribeId));
            setConflict((current) => (current ? { ...current, latestLoaded: true } : current));
            setSuccess('已載入最新內容；你的版本仍保留，可選擇「改回我的版本」');
        } catch (err) {
            setPageError(formatApiError(err));
        }
    };

    const restoreMyVersion = () => {
        if (!conflict) return;
        // 只換表單、不更新快照：快照仍是伺服器最新版，未儲存保護才會繼續生效
        resetTree(normalizeSection(conflict.payload, tribeId));
        setConflict(null);
        setSuccess('');
    };

    // 稽核 FE7a-09：捨棄草稿不可復原，先確認
    const discardDraft = async () => {
        const confirmed = await confirmAction({
            title: '捨棄草稿',
            message: isDeleteProposal
                ? '確定要捨棄這個刪除提案嗎？章節本身不受影響。'
                : '確定要捨棄這份草稿嗎？草稿中的所有修改都會消失，無法復原。',
            confirmLabel: '捨棄草稿',
        });
        if (!confirmed) return;
        await runRevisionAction(revisionActions.discard);
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

    const createDeleteProposal = async () => {
        // 稽核 FE7a-17：這一步只是建立提案（核准前可捨棄），原本寫「無法復原」會誤導
        const confirmed = await confirmAction({
            title: '建立刪除提案',
            message: (
                <p className="mb-0">
                    將建立刪除提案，送審核准後才會移除這個文法章節；核准前可捨棄。
                </p>
            ),
            confirmLabel: '建立刪除提案',
        });
        if (!confirmed) return undefined;

        return lock.runLocked('delete', async () => {
            setPageError('');
            setSuccess('');

            try {
                const result = await proposeGrammarSectionDelete(sectionId);
                setRevision(revisionFromSave(result, {
                    status: 'draft',
                    operation: 'delete',
                    payload: null,
                }));
                if (currentSection) reset(currentSection);
                setSuccess('刪除提案草稿已建立');
                // 刪除提案建立後章節仍存在（要核准後才真的移除），這裡只刷新
                // 父層清單讓 pending_revision 徽章更新，不清除目前的選取。
                await onSaved();
            } catch (err) {
                setPageError(formatApiError(err));
            }
        });
    };

    if (loading) {
        return (
            <div className="dictionary-loading">
                <Spinner animation="border" />
                <span>載入文法章節中…</span>
            </div>
        );
    }

    return (
        <div className="dictionary-editor-page">
            <div className="dictionary-page-heading">
                <div>
                    <h2 ref={headingRef} tabIndex={-1} className="dictionary-panel-heading">
                        {isNew ? '新增文法章節' : '文法章節詳情'}
                    </h2>
                    <p>
                        狀態：
                        <Badge
                            className="ms-2"
                            bg={STATUS_META[revisionStatus]?.bg ?? (revisionStatus ? 'secondary' : 'info')}
                            text={STATUS_META[revisionStatus]?.text}
                        >
                            {statusLabel}
                        </Badge>
                    </p>
                </div>
            </div>

            {!editable && (
                <Alert variant="warning">
                    {isDeleteProposal && '此章節已建立刪除提案，內容為唯讀；可以送審或捨棄這個提案。'}
                    {!isDeleteProposal && revisionStatus === 'pending_review'
                        && pendingReviewNotice(revision, { canWithdraw: canEditRole && canManage, entityLabel: '章節' })}
                    {!isDeleteProposal && revisionStatus === 'approved' && '此章節提案已核准，內容為唯讀。'}
                    {!isDeleteProposal && revisionStatus === 'rejected' && '此章節提案已退件，內容為唯讀。'}
                    {!canEditRole && '目前角色沒有文法章節編輯權限。'}
                    {canEditRole && foreignRevision && revisionStatus === 'draft'
                        && `這是 ${revisionActorLabel(revision, 'created')} 建立的草稿，你無法修改。`}
                </Alert>
            )}

            {pageError && <Alert variant="danger">{pageError}</Alert>}
            {conflict && (
                <div className="dictionary-editor-actions">
                    <Button type="button" variant="outline-primary" onClick={reloadLatestRevision}>
                        載入最新內容
                    </Button>
                    {conflict.latestLoaded && (
                        <Button type="button" variant="outline-secondary" onClick={restoreMyVersion}>
                            改回我的版本
                        </Button>
                    )}
                </div>
            )}
            {revisionActions.error && <Alert variant="danger">{revisionActions.error}</Alert>}
            <SuccessNotice message={success} />

            <RevisionDetails revision={revision} entityLabel="文法章節" changes={changes} />
            {isNew && !revisionId && !onCreated && revision?.id && (
                // 稽核 FE7a-02：新建章節的提案沒有章節 id，左側清單不會出現；給一個回得來的網址
                <Alert variant="info">
                    這個新章節的提案可以從
                    {' '}
                    <Link to={`/admin/dictionary/revisions/${revision.id}`}>提案專屬頁面</Link>
                    {' '}
                    再次開啟（離開本頁後請由此返回或從送審佇列開啟）。
                </Alert>
            )}

            <Form
                className="dictionary-editor-card"
                onSubmit={(event) => {
                    event.preventDefault();
                    saveDraft();
                }}
            >
                <div className="dictionary-form-grid">
                    <Form.Group className="dictionary-field" controlId="grammar-section-key">
                        <Form.Label>章節代碼</Form.Label>
                        <Form.Control
                            disabled={!editable}
                            value={tree.section_key}
                            isInvalid={Boolean(fieldErrors.section_key)}
                            onChange={(event) => updateSectionField('section_key', event.target.value)}
                        />
                        <Form.Control.Feedback type="invalid">{fieldErrors.section_key}</Form.Control.Feedback>
                    </Form.Group>

                    <Form.Group className="dictionary-field" controlId="grammar-section-title">
                        <Form.Label>
                            章節名稱 <span className="required-mark">*</span>
                        </Form.Label>
                        <Form.Control
                            required
                            disabled={!editable}
                            value={tree.title}
                            isInvalid={Boolean(fieldErrors.title)}
                            onChange={(event) => updateSectionField('title', event.target.value)}
                        />
                        <Form.Control.Feedback type="invalid">{fieldErrors.title}</Form.Control.Feedback>
                    </Form.Group>

                    <Form.Group className="dictionary-field" controlId="grammar-section-description">
                        <Form.Label>章節說明</Form.Label>
                        <Form.Control
                            as="textarea"
                            rows={3}
                            disabled={!editable}
                            value={tree.description}
                            isInvalid={Boolean(fieldErrors.description)}
                            onChange={(event) => updateSectionField('description', event.target.value)}
                        />
                        <Form.Control.Feedback type="invalid">{fieldErrors.description}</Form.Control.Feedback>
                    </Form.Group>
                </div>

                <div className="dictionary-child-section">
                    <div className="dictionary-child-heading">
                        <h3>文法規則</h3>

                        {editable && (
                            <Button
                                type="button"
                                size="sm"
                                variant="outline-primary"
                                onClick={() => addChild([], 'rules', emptyRule)}
                            >
                                <Plus size={15} />
                                新增規則
                            </Button>
                        )}
                    </div>

                    {tree.rules.length === 0 && (
                        <p className="dictionary-empty-note">尚未新增文法規則。</p>
                    )}

                    {tree.rules.map((rule, ruleIndex) => (
                        <RuleEditor
                            key={rule._key}
                            rule={rule}
                            ruleIndex={ruleIndex}
                            ruleCount={tree.rules.length}
                            affixes={affixes}
                            tribeId={tree.tribe_id}
                            disabled={!editable}
                            update={update}
                            addChild={addChild}
                            removeChild={removeChild}
                            moveChild={moveChild}
                        />
                    ))}
                </div>

                <div className="dictionary-editor-actions">
                    {editable && (
                        <Button type="submit" variant="outline-primary" disabled={saving || revisionActions.pending}>
                            {saving ? <Spinner animation="border" size="sm" /> : <Save size={17} />}
                            儲存草稿
                        </Button>
                    )}

                    {revisionStatus === 'draft' && canEditRole && canManage && (
                        <>
                            <Button
                                type="button"
                                variant="success"
                                disabled={saving || revisionActions.pending}
                                onClick={() => runRevisionAction(revisionActions.submit)}
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

                    {revisionStatus === 'pending_review' && canEditRole && canManage && (
                        <Button
                            type="button"
                            variant="outline-secondary"
                            disabled={revisionActions.pending}
                            onClick={() => runRevisionAction(revisionActions.withdraw)}
                        >
                            <Undo2 size={17} />
                            撤回
                        </Button>
                    )}
                </div>
            </Form>

            {revisionStatus === 'pending_review' && canApprove && (
                <section className="dictionary-review-card">
                    <h3>審核提案</h3>

                    <Form.Group controlId="grammar-review-comment">
                        <Form.Label>審核意見</Form.Label>
                        <Form.Control
                            as="textarea"
                            rows={3}
                            value={reviewComment}
                            onChange={(event) => setReviewComment(event.target.value)}
                        />
                    </Form.Group>

                    <div className="dictionary-editor-actions">
                        <Button
                            type="button"
                            variant="success"
                            disabled={revisionActions.pending}
                            onClick={() => runRevisionAction(
                                // 稽核 BE1-03：核准的是審核者載入時看到的那一版
                                () => revisionActions.approve({
                                    reviewComment: reviewComment.trim(),
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
                            disabled={revisionActions.pending || !reviewComment.trim()}
                            onClick={() => runRevisionAction(() => revisionActions.reject(reviewComment.trim()))}
                        >
                            <X size={17} />
                            退件
                        </Button>
                    </div>
                </section>
            )}

            {!isNew && !revision && canEditRole && (
                <section className="dictionary-danger-card">
                    <h3>刪除文法章節</h3>
                    <p>刪除會先建立提案，核准後才會從正式文法內容移除。</p>

                    <Button
                        type="button"
                        variant="outline-danger"
                        disabled={saving}
                        onClick={createDeleteProposal}
                    >
                        <Trash2 size={17} />
                        建立刪除提案
                    </Button>
                </section>
            )}
        </div>
    );
}
