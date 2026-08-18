import { useCallback, useEffect, useState } from 'react';

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
import { useRevisionActions } from './useRevisionActions';

/**
 * 詞條編輯頁的遠端資料與提案流程（FE-7）。
 *
 * WordEditor.jsx 原本是 1144 行。它有一個很好的既有實踐：normalize*() 那批
 * 純函式早就抽到 module 層級了；但元件本體仍然有約 920 行，把「載入詞條與
 * 主檔」「儲存草稿提案」「送審／核准／退件」「刪除提案」四種遠端流程，
 * 跟整份表單的 JSX 全部混在一起。
 *
 * 這個 hook 只接手前者。表單樹本身仍然由既有的 useNestedForm 管理（那支
 * hook 已經有自己的測試，不動它），呼叫端把它回傳的 reset 傳進來，讓載入
 * 完成時能把資料灌進表單。
 */
export function useWordEditorData({
    id,
    isNew,
    prefillName,
    reset,
    emptyWord,
    emptyTaxonomies,
    normalizeWord,
    revisionFromSave,
}) {
    const [taxonomies, setTaxonomies] = useState(emptyTaxonomies);
    const [revision, setRevision] = useState(null);
    const [baseHash, setBaseHash] = useState('');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [pageError, setPageError] = useState('');
    const [success, setSuccess] = useState('');

    const [references, setReferences] = useState(null);
    const [loadingReferences, setLoadingReferences] = useState(false);
    const [showDeletePanel, setShowDeletePanel] = useState(false);
    const [unlinkReferences, setUnlinkReferences] = useState(false);

    const handleRevisionChanged = useCallback((result) => {
        setPageError('');
        setSuccess('提案狀態已更新');
        setRevision((current) => revisionFromSave(result, current));
    }, [revisionFromSave]);

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
                setTaxonomies({ ...emptyTaxonomies, ...taxonomyResult });

                if (isNew) {
                    reset(prefillName ? { ...emptyWord, name: prefillName } : emptyWord);
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
                    reset(normalizeWord(loadedRevision.payload ?? word));
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
        // emptyWord／emptyTaxonomies／normalizeWord 都是 module 層級的常數與純
        // 函式（見 WordEditor.jsx），identity 不會變動，不需要列進相依陣列。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, isNew, reset, prefillName]);

    const saveDraft = async (buildPayload) => {
        setPageError('');
        setSuccess('');
        setSaving(true);

        try {
            const payload = buildPayload();
            let result;

            if (revision?.id) {
                if (revision.status !== 'draft') {
                    throw new Error('只有草稿提案可以修改內容');
                }

                result = await updateRevisionPayload(revision.id, payload);
            } else if (isNew) {
                result = await createWordProposal(payload);
            } else {
                result = await proposeWordUpdate(id, { ...payload, base_hash: baseHash });
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
            const result = await proposeWordDelete(id, unlinkReferences);
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

    return {
        taxonomies,
        revision,
        setRevision,
        baseHash,
        loading,
        saving,
        pageError,
        setPageError,
        success,
        setSuccess,
        revisionActions,
        saveDraft,
        runRevisionAction,
        deletion: {
            references,
            loadingReferences,
            showDeletePanel,
            setShowDeletePanel,
            unlinkReferences,
            setUnlinkReferences,
            hasReferences,
            open: openDeletePanel,
            create: createDeleteProposal,
        },
    };
}

export default useWordEditorData;
