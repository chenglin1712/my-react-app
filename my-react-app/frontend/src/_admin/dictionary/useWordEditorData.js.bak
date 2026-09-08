import { useCallback, useEffect, useRef, useState } from 'react';

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
import { useActionLock } from '../hooks/useActionLock';

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
    const [pageError, setPageError] = useState('');
    const [success, setSuccess] = useState('');

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

        if (actionKey === 'discard') {
            // discard 成功後後端只回 { detail: '已捨棄' }，沒有 id/status/
            // payload。原本的寫法一律用 revisionFromSave(result, current)
            // 合併，等於把舊 revision 的欄位整個從 current 補回來——後端
            // 明明已經刪掉這筆 revision，畫面卻繼續顯示它存在，之後再操作
            // 會打到一個已經不存在的 revision id。
            //
            // 這裡改成依原本的提案類型分開處理：
            //   - create 草稿（詞條原本就不存在）：使用者選擇的行為是清空
            //     表單，回到「尚未儲存」的空白狀態。
            //   - update／delete 草稿（詞條本來就存在）：重新載入目前的
            //     正式內容，不能留著已捨棄草稿的表單內容。
            setSuccess('提案已捨棄');
            setRevision(null);

            if (isNew) {
                reset(prefillName ? { ...emptyWord, name: prefillName } : emptyWord);
            } else {
                try {
                    const word = await getWord(id);
                    setBaseHash(word.content_hash ?? '');
                    reset(normalizeWord(word));
                } catch (err) {
                    setPageError(err.message);
                }
            }
            return;
        }

        setSuccess('提案狀態已更新');
        setRevision((current) => revisionFromSave(result, current));
    }, [emptyWord, id, isNew, normalizeWord, prefillName, reset, revisionFromSave]);

    const revisionActions = useRevisionActions(
        revision?.id ?? null,
        { onChanged: handleRevisionChanged, lock },
    );

    useEffect(() => {
        let active = true;

        (async () => {
            setLoading(true);
            setPageError('');
            // 同一個路由元件在 /words/A 跟 /words/B 之間切換時會被 React
            // Router 重用，不會重新掛載。上一筆詞條殘留的刪除面板／引用
            // 資料要先清掉，否則新詞條載入失敗時，畫面會留著舊詞條的刪除
            // 面板內容，看起來像是在對新詞條操作。
            setShowDeletePanel(false);
            setUnlinkReferences(false);
            setReferences(null);
            referencesGenerationRef.current += 1;

            // 表單也要先清空：舊詞條的表單內容不能在新詞條載入失敗時繼續
            // 留在畫面上（那會讓使用者誤以為自己正在看新詞條的資料）。
            // isNew 分支下面就會用 prefillName 重新 reset 一次，這裡不用
            // 先清。loading 為 true 時整頁只顯示 Spinner，不會有閃爍。
            if (!isNew) {
                reset(emptyWord);
            }

            try {
                const taxonomyResult = await listTaxonomies();
                if (!active) return;
                setTaxonomies({ ...emptyTaxonomies, ...taxonomyResult });

                if (isNew) {
                    reset(prefillName ? { ...emptyWord, name: prefillName } : emptyWord);
                    setRevision(null);
                    setBaseHash('');
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

    const saveDraft = (buildPayload) => lock.runLocked('save', async () => {
        setPageError('');
        setSuccess('');

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
        }
    });

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
            setPageError(err.message);
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
                payload: null,
            }));
            setShowDeletePanel(false);
            setSuccess('刪除提案草稿已建立');
        } catch (err) {
            setPageError(err.message);
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
