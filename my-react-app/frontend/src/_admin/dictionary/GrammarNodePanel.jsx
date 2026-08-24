import {
    useCallback,
    useEffect,
    useMemo,
    useState,
} from 'react';
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
import { REVISION_STATUS_META as STATUS_META, revisionFromSave } from './revisionMeta';
import { useActionLock } from '../hooks/useActionLock';

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

export default function GrammarNodePanel({
    tribeId,
    sectionId,
    taxonomies,
    onSaved = () => {},
}) {
    const { userData } = useAuth();
    const role = userData?.role;
    const isNew = sectionId === null;

    const {
        tree,
        reset,
        update,
        addChild,
        removeChild,
        moveChild,
        toPayload,
    } = useNestedForm(emptySection(tribeId));

    const [revision, setRevision] = useState(null);
    const [baseHash, setBaseHash] = useState('');
    const [loading, setLoading] = useState(true);
    const [pageError, setPageError] = useState('');
    const [success, setSuccess] = useState('');
    const [reviewComment, setReviewComment] = useState('');

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
    const editable = canEditRole && !isDeleteProposal && (
        (!revision && (isNew || Boolean(sectionId)))
        || revisionStatus === 'draft'
    );

    const handleRevisionChanged = useCallback(async (result, actionKey) => {
        setPageError('');

        if (actionKey === 'discard') {
            // discard 成功後後端只回 { detail: '已捨棄' }，沒有 id/status/
            // payload；沿用 revisionFromSave(result, current) 合併會把舊
            // revision 的欄位整個從 current 補回來，畫面就會繼續顯示一個
            // 後端已經不存在的提案。
            setSuccess('提案已捨棄');
            setRevision(null);

            if (isNew) {
                reset(emptySection(tribeId));
            } else {
                try {
                    const section = await getGrammarSection(sectionId);
                    setBaseHash(section.content_hash ?? '');
                    reset(normalizeSection(section, tribeId));
                } catch (err) {
                    setPageError(err.message);
                }
            }

            await onSaved();
            return;
        }

        setSuccess('提案狀態已更新');
        setRevision((current) => revisionFromSave(result, current));
        onSaved();
    }, [isNew, onSaved, reset, sectionId, tribeId]);

    const revisionActions = useRevisionActions(
        revision?.id ?? null,
        { onChanged: handleRevisionChanged, lock },
    );

    useEffect(() => {
        let active = true;

        (async () => {
            setLoading(true);
            setPageError('');
            setSuccess('');
            setRevision(null);
            setBaseHash('');

            try {
                if (isNew) {
                    reset(emptySection(tribeId));
                    return;
                }

                const section = await getGrammarSection(sectionId);
                if (!active) return;

                setBaseHash(section.content_hash ?? '');

                const pending = section.meta?.pending_revision;

                if (pending) {
                    const loadedRevision = await getRevision(pending.id);
                    if (!active) return;

                    setRevision({
                        ...pending,
                        ...loadedRevision,
                        id: loadedRevision.id ?? pending.id,
                    });
                    reset(normalizeSection(loadedRevision.payload ?? section, tribeId));
                } else {
                    setRevision(null);
                    reset(normalizeSection(section, tribeId));
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
    }, [isNew, reset, sectionId, tribeId]);

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
        setSuccess('');

        if (!tree.tribe_id) {
            setPageError('族語為必填');
            return Promise.resolve(null);
        }

        if (!tree.title.trim()) {
            setPageError('章節名稱為必填');
            return Promise.resolve(null);
        }

        return lock.runLocked('save', async () => {
            try {
                const payload = buildPayload();
                let result;

                if (revision?.id) {
                    if (revision.status !== 'draft') {
                        throw new Error('只有草稿提案可以修改內容');
                    }
                    result = await updateRevisionPayload(revision.id, payload);
                } else if (isNew) {
                    result = await createGrammarSectionProposal(payload);
                } else {
                    result = await proposeGrammarSectionUpdate(sectionId, {
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
                await onSaved();

                return nextRevision;
            } catch (err) {
                if (err.status === 409) {
                    setPageError(
                        `${err.message} 文法章節在編輯期間已被其他人修改，`
                        + '請重新載入最新內容後再建立提案。',
                    );
                } else {
                    setPageError(err.message);
                }
                return null;
            }
        });
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

    const createDeleteProposal = () => {
        if (!window.confirm('確定要刪除這個文法章節嗎？此操作無法復原。')) {
            return Promise.resolve();
        }

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
                setSuccess('刪除提案草稿已建立');
                // 刪除提案建立後章節仍存在（要核准後才真的移除），這裡只刷新
                // 父層清單讓 pending_revision 徽章更新，不清除目前的選取。
                await onSaved();
            } catch (err) {
                setPageError(err.message);
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
                    <h2>{isNew ? '新增文法章節' : '文法章節詳情'}</h2>
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
                    {!isDeleteProposal && revisionStatus === 'pending_review' && '此章節提案正在送審，欄位為唯讀；編輯者可先撤回提案再修改。'}
                    {!isDeleteProposal && revisionStatus === 'approved' && '此章節提案已核准，內容為唯讀。'}
                    {!isDeleteProposal && revisionStatus === 'rejected' && '此章節提案已退件，內容為唯讀。'}
                    {!canEditRole && '目前角色沒有文法章節編輯權限。'}
                </Alert>
            )}

            {pageError && <Alert variant="danger">{pageError}</Alert>}
            {revisionActions.error && <Alert variant="danger">{revisionActions.error}</Alert>}
            {success && <Alert variant="success">{success}</Alert>}

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
                            onChange={(event) => update([], { section_key: event.target.value })}
                        />
                    </Form.Group>

                    <Form.Group className="dictionary-field" controlId="grammar-section-title">
                        <Form.Label>
                            章節名稱 <span className="required-mark">*</span>
                        </Form.Label>
                        <Form.Control
                            required
                            disabled={!editable}
                            value={tree.title}
                            onChange={(event) => update([], { title: event.target.value })}
                        />
                    </Form.Group>

                    <Form.Group className="dictionary-field" controlId="grammar-section-description">
                        <Form.Label>章節說明</Form.Label>
                        <Form.Control
                            as="textarea"
                            rows={3}
                            disabled={!editable}
                            value={tree.description}
                            onChange={(event) => update([], { description: event.target.value })}
                        />
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

                    {revisionStatus === 'draft' && canEditRole && (
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
                                onClick={() => runRevisionAction(revisionActions.discard)}
                            >
                                <Trash2 size={17} />
                                捨棄草稿
                            </Button>
                        </>
                    )}

                    {revisionStatus === 'pending_review' && canEditRole && (
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
                                () => revisionActions.approve({ reviewComment: reviewComment.trim() }),
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
