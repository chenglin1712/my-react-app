import { useCallback, useEffect, useRef, useState } from 'react';

import {
    createWordProposal,
    getRevision,
    getWord,
    getWordReferences,
    isEditConflict,
    listTaxonomies,
    proposeWordDelete,
    proposeWordUpdate,
    updateRevisionPayload,
} from './dictionaryApi';
import { useRevisionActions } from './useRevisionActions';
import { useActionLock } from '../hooks/useActionLock';
import { formatApiError } from '../apiErrors';
import { WORD_FIELD_KEYS, extractFieldErrors } from './fieldErrors';

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
 *
 * 三種進入方式（稽核 FE7a-01／02）：
 *   - id：既有詞條。載入時一併載入它的草稿或送審中提案（meta.open_revision），
 *     不再只看送審中的，否則重新整理後看不見自己的草稿、再存檔就會無聲覆蓋。
 *   - revisionId：新建詞條的提案（/admin/dictionary/revisions/:id）。新建提案沒有
 *     word_id，以前離開頁面就找不回來，審核者也打不開。
 *   - 兩者皆無：全新的詞條。第一次存檔後由 onCreated 導到提案專屬網址。
 */
export function useWordEditorData({
    id,
    revisionId = null,
    initialRevision = null,
    isNew,
    prefillName,
    reset,
    replaceForm,
    emptyWord,
    emptyTaxonomies,
    normalizeWord,
    revisionFromSave,
    onCreated,
    onCreateApproved,
    onNewDiscarded,
}) {
    const [taxonomies, setTaxonomies] = useState(emptyTaxonomies);
    const [revision, setRevision] = useState(null);
    const [baseHash, setBaseHash] = useState('');
    // 目前生效的詞條內容（已 normalize）：刪除提案用它填表單（稽核 FE7a-03），
    // 更新提案用它算變更摘要（稽核 FE7a-13）。新建提案沒有現行內容，為 null。
    const [currentWord, setCurrentWord] = useState(null);
    const [loading, setLoading] = useState(true);
    const [pageError, setPageError] = useState('');
    // 稽核 FE7a-05 殘留（WP-8 追加）：後端能對應到頂層欄位的驗證錯誤，給欄位顯示 isInvalid
    const [fieldErrors, setFieldErrors] = useState({});
    const [success, setSuccess] = useState('');
    // 稽核 FE7a-06：草稿在編輯期間被改過（409 edit_conflict）時，保留使用者自己的版本，
    // 讓他可以先載入最新內容比對，再決定要不要改回自己的版本，而不是只能重整丟掉編輯。
    const [conflict, setConflict] = useState(null);

    const [references, setReferences] = useState(null);
    const [loadingReferences, setLoadingReferences] = useState(false);
    const [showDeletePanel, setShowDeletePanel] = useState(false);
    const [unlinkReferences, setUnlinkReferences] = useState(false);

    // 儲存草稿、送審類動作（submit/withdraw/approve/reject/discard）、建立
    // 刪除提案彼此都應該互斥，因此共用同一把鎖——而不是像原本那樣各自用一個
    // state 當忙碌旗標。單純的 state 只能靠下一次 render 才反映到 disabled
    // 屬性上，擋不住「儲存」跟「送審」在同一個 tick 內各自被觸發一次。
    const lock = useActionLock();
    const saving = lock.pendingKey === 'save' || lock.pendingKey === 'delete';

    // 讀取詞條引用資料（用於刪除提案面板）是查詢，不是異動，不應該被上面
    // 那把 mutation 鎖擋住；但它自己需要一個 generation guard，避免同一個
    // tick 重複點開面板送出兩次請求，或是切換到另一筆詞條之後，上一筆的
    // 回應才回來、寫進新詞條的刪除面板裡。
    const referencesGenerationRef = useRef(0);

    const handleRevisionChanged = useCallback(async (result, actionKey) => {
        setPageError('');
        setConflict(null);

        if (actionKey === 'discard') {
            // discard 成功後後端只回 { detail: '已捨棄' }，沒有 id/status/
            // payload。原本的寫法一律用 revisionFromSave(result, current)
            // 合併，等於把舊 revision 的欄位整個從 current 補回來——後端
            // 明明已經刪掉這筆 revision，畫面卻繼續顯示它存在，之後再操作
            // 會打到一個已經不存在的 revision id。
            //
            // 這裡改成依原本的提案類型分開處理：
            //   - create 草稿（詞條原本就不存在）：清空表單；若是從提案專屬
            //     網址進來的，回到詞條列表（那個網址已經不存在了）。
            //   - update／delete 草稿（詞條本來就存在）：重新載入目前的
            //     正式內容，不能留著已捨棄草稿的表單內容。
            setSuccess('提案已捨棄');
            setRevision(null);

            if (isNew) {
                if (revisionId) {
                    onNewDiscarded?.();
                    return;
                }
                reset(prefillName ? { ...emptyWord, name: prefillName } : emptyWord);
            } else {
                try {
                    const word = await getWord(id);
                    setBaseHash(word.content_hash ?? '');
                    const current = normalizeWord(word);
                    setCurrentWord(current);
                    reset(current);
                } catch (err) {
                    setPageError(formatApiError(err));
                }
            }
            return;
        }

        if (actionKey === 'approve' && isNew && result?.target_id) {
            // 新建提案核准後才有 word_id，導到正式詞條頁
            onCreateApproved?.(result.target_id);
        }

        setSuccess('提案狀態已更新');
        setRevision((current) => revisionFromSave(result, current));
    }, [emptyWord, id, isNew, normalizeWord, onCreateApproved, onNewDiscarded, prefillName, reset,
        revisionFromSave, revisionId]);

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
            setConflict(null);
            // 同一個路由元件在 /words/A 跟 /words/B 之間切換時會被 React
            // Router 重用，不會重新掛載。上一筆詞條殘留的刪除面板／引用
            // 資料要先清掉，否則新詞條載入失敗時，畫面會留著舊詞條的刪除
            // 面板內容，看起來像是在對新詞條操作。
            setShowDeletePanel(false);
            setUnlinkReferences(false);
            setReferences(null);
            setCurrentWord(null);
            referencesGenerationRef.current += 1;

            // 表單也要先清空：舊詞條的表單內容不能在新詞條載入失敗時繼續
            // 留在畫面上（那會讓使用者誤以為自己正在看新詞條的資料）。
            // isNew 分支下面就會用 prefillName 重新 reset 一次，這裡不用
            // 先清。loading 為 true 時整頁只顯示 Spinner，不會有閃爍。
            if (!isNew || revisionId) {
                reset(emptyWord);
            }

            try {
                const taxonomyResult = await listTaxonomies();
                if (!active) return;
                setTaxonomies({ ...emptyTaxonomies, ...taxonomyResult });

                if (revisionId) {
                    const loadedRevision = (
                        initialRevision && String(initialRevision.id) === String(revisionId)
                    ) ? initialRevision : await getRevision(revisionId);
                    if (!active) return;
                    if (loadedRevision.target_kind && loadedRevision.target_kind !== 'word') {
                        setPageError('這筆提案不是詞條提案');
                        setRevision(null);
                        return;
                    }
                    setRevision(loadedRevision);
                    setBaseHash('');
                    reset(normalizeWord(loadedRevision.payload ?? {}));
                    return;
                }

                if (isNew) {
                    reset(prefillName ? { ...emptyWord, name: prefillName } : emptyWord);
                    setRevision(null);
                    setBaseHash('');
                    return;
                }

                const word = await getWord(id);
                if (!active) return;

                setBaseHash(word.content_hash ?? '');
                const current = normalizeWord(word);
                setCurrentWord(current);

                const open = word.meta?.open_revision ?? word.meta?.pending_revision;

                if (open) {
                    const loadedRevision = await getRevision(open.id);
                    if (!active) return;

                    setRevision({
                        ...open,
                        ...loadedRevision,
                        id: loadedRevision.id ?? open.id,
                    });
                    // 稽核 FE7a-03：刪除提案的 payload 只有 unlink_references，表單要顯示
                    // 「要被刪掉的是什麼」，也就是目前生效的內容。
                    reset(loadedRevision.operation === 'delete'
                        ? current
                        : normalizeWord(loadedRevision.payload ?? word));
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
        // emptyWord／emptyTaxonomies／normalizeWord 都是 module 層級的常數與純
        // 函式（見 WordEditor.jsx），identity 不會變動，不需要列進相依陣列。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, revisionId, isNew, reset, prefillName]);

    const saveDraft = (buildPayload) => lock.runLocked('save', async () => {
        setPageError('');
        setFieldErrors({});
        setSuccess('');

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
            setConflict(null);
            setSuccess('草稿已儲存');

            if (isNew && !revision?.id && nextRevision.id) {
                onCreated?.(nextRevision.id);
            }

            return nextRevision;
        } catch (err) {
            if (isEditConflict(err)) {
                // WP-8 追加：propose 撞到別人的草稿時，頁面原本沒有 revision，靠 409 附的 revision_id 載入
                setConflict({ payload, revisionId: err?.data?.revision_id });
                setPageError(
                    '這份草稿在你編輯期間已被修改（可能是其他人，或你在另一個分頁存過）。'
                    + '可以先載入最新內容比對，再決定是否改回你的版本後重新儲存。',
                );
            } else if (err.status === 409) {
                setPageError(`${formatApiError(err)} 請重新整理頁面取得最新狀態後再編輯。`);
            } else {
                setPageError(formatApiError(err));
                setFieldErrors(extractFieldErrors(err, WORD_FIELD_KEYS));
            }
            return null;
        }
    });

    /** 衝突時「載入最新內容」：換上伺服器目前的草稿（含新的 updated_at），保留使用者的版本在 conflict 裡。 */
    const reloadLatestRevision = async () => {
        const targetId = revision?.id ?? conflict?.revisionId;
        if (!targetId) return;
        setPageError('');
        try {
            const loadedRevision = await getRevision(targetId);
            setRevision((current) => ({ ...current, ...loadedRevision }));
            reset(normalizeWord(loadedRevision.payload ?? {}));
            setConflict((current) => (current ? { ...current, latestLoaded: true } : current));
            setSuccess('已載入最新內容；你的版本仍保留，可選擇「改回我的版本」');
        } catch (err) {
            setPageError(formatApiError(err));
        }
    };

    /** 衝突時「改回我的版本」：表單換回使用者自己的內容，但版本基準已是最新，再存檔就是明確地覆蓋。
     * 只換表單（replaceForm），不更新「已儲存」快照：快照仍是伺服器最新版，
     * 所以畫面會被視為有未儲存變更，離開前仍會提醒。 */
    const restoreMyVersion = () => {
        if (!conflict) return;
        (replaceForm ?? reset)(normalizeWord(conflict.payload));
        setConflict(null);
        setSuccess('');
    };

    const runRevisionAction = async (action) => {
        setPageError('');
        setSuccess('');

        try {
            await action();
        } catch {
            // useRevisionActions 已保存錯誤訊息，畫面統一顯示。
        }
    };

    const openDeletePanel = async () => {
        const generation = (referencesGenerationRef.current += 1);

        setPageError('');
        setShowDeletePanel(true);
        setLoadingReferences(true);

        try {
            const result = await getWordReferences(id);
            if (generation !== referencesGenerationRef.current) return;
            setReferences(result);
        } catch (err) {
            if (generation !== referencesGenerationRef.current) return;
            setPageError(formatApiError(err));
        } finally {
            if (generation === referencesGenerationRef.current) {
                setLoadingReferences(false);
            }
        }
    };

    const createDeleteProposal = () => lock.runLocked('delete', async () => {
        setPageError('');
        setSuccess('');

        try {
            const result = await proposeWordDelete(id, unlinkReferences);
            setRevision(revisionFromSave(result, {
                status: 'draft',
                operation: 'delete',
                payload: { unlink_references: unlinkReferences },
                reference_counts: references?.counts,
            }));
            // 刪除提案顯示的是目前生效內容（稽核 FE7a-03），丟掉表單上未存的修改
            if (currentWord) reset(currentWord);
            setShowDeletePanel(false);
            setSuccess('刪除提案草稿已建立');
        } catch (err) {
            setPageError(formatApiError(err));
        }
    });

    const hasReferences = (
        (references?.counts?.anaphora_items ?? 0)
        + (references?.counts?.grammar_example_words ?? 0)
    ) > 0;

    return {
        taxonomies,
        revision,
        setRevision,
        currentWord,
        loading,
        saving,
        pageError,
        setPageError,
        fieldErrors,
        setFieldErrors,
        success,
        setSuccess,
        revisionActions,
        saveDraft,
        runRevisionAction,
        conflict: {
            active: Boolean(conflict),
            // 先載入最新內容（取得新的 updated_at）才能改回自己的版本，否則再存仍會衝突
            latestLoaded: Boolean(conflict?.latestLoaded),
            reloadLatest: reloadLatestRevision,
            restoreMine: restoreMyVersion,
        },
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
