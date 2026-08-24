import { useEffect, useMemo, useRef, useState } from 'react';

import {
    createTaxonomyTerm,
    deleteTaxonomyTerm,
    listTaxonomies,
    updateTaxonomyTerm,
} from './dictionaryApi';
import { useActionLock } from '../hooks/useActionLock';

const emptyAffixDraft = () => ({
    tribe_id: '',
    affix: '',
    affix_type: 'prefix',
    function: '',
    example_form: '',
});

/**
 * 主檔管理頁的資料與 CRUD（FE-9）。
 *
 * TaxonomyManager.jsx 原本把「目前看的是哪一種主檔」「清單資料」「新增表單」
 * 「行內編輯草稿」「刪除中的列」「合併來源」六組彼此獨立的狀態，跟整頁 JSX
 * 一起放在同一個元件裡（10 個 useState）。
 *
 * 這裡的重點不是把行數搬走，而是讓「切換主檔類型時該重置哪些狀態」這件事
 * 有一個明確的地方（selectKind）——原本它散在元件中間，很容易在新增狀態時
 * 忘記一起重置，變成切換分頁後還殘留前一種主檔的編輯草稿。
 */
export function useTaxonomyManager() {
    const [activeKind, setActiveKind] = useState('source');
    const [taxonomies, setTaxonomies] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [newName, setNewName] = useState('');
    const [newAffix, setNewAffix] = useState(emptyAffixDraft());

    const [editingId, setEditingId] = useState(null);
    const [editDraft, setEditDraft] = useState(null);

    const [deletingId, setDeletingId] = useState(null);
    const [mergeSource, setMergeSource] = useState(null);

    // 建立／編輯／刪除彼此都應該互斥——用同一把鎖，而不是像原本那樣各自用
    // 一個 state 當忙碌旗標（那樣不只擋不住同一個 tick 內的重複觸發，也讓
    // 三種操作可以並行，最後完成的 load() 不一定對應使用者最後做的那個
    // 操作）。
    const lock = useActionLock();
    const creating = lock.pendingKey === 'create';
    const savingEdit = lock.pendingKey === 'edit';

    const isAffix = activeKind === 'grammar_affix';
    const rows = taxonomies?.[activeKind] ?? [];

    // 只有「目前最新的那一次查詢」可以寫回狀態，同時避免元件卸載後
    // setState。
    const loadGenerationRef = useRef(0);

    const load = async () => {
        const requestId = loadGenerationRef.current + 1;
        loadGenerationRef.current = requestId;
        const isStale = () => loadGenerationRef.current !== requestId;

        setLoading(true);
        setError('');

        try {
            const result = await listTaxonomies();
            if (isStale()) return;
            setTaxonomies(result);
        } catch (err) {
            if (isStale()) return;
            setError(err.message);
        } finally {
            if (!isStale()) setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // 只在掛載時載入一次；之後由各個異動操作自己呼叫 load()。
    }, []);

    const tribeNames = useMemo(() => new Map(
        (taxonomies?.tribes ?? []).map((tribe) => [String(tribe.id), tribe.name]),
    ), [taxonomies]);

    /** 切換主檔類型時，所有「屬於上一個類型」的暫存狀態都要一起清掉。 */
    const selectKind = (key) => {
        setActiveKind(key);
        setEditingId(null);
        setEditDraft(null);
        setNewName('');
        setNewAffix(emptyAffixDraft());
        setError('');
        setMergeSource(null);
        setDeletingId(null);
    };

    const submitCreate = (event) => {
        event.preventDefault();

        return lock.runLocked('create', async () => {
            setError('');
            try {
                if (isAffix) {
                    await createTaxonomyTerm('grammar_affix', newAffix);
                    setNewAffix(emptyAffixDraft());
                } else {
                    await createTaxonomyTerm(activeKind, { name: newName.trim() });
                    setNewName('');
                }
                await load();
            } catch (err) {
                setError(err.message);
            }
        });
    };

    const startEdit = (row) => {
        setEditingId(row.id);
        setEditDraft(isAffix
            ? {
                affix: row.affix, affix_type: row.affix_type,
                function: row.function, example_form: row.example_form,
            }
            : { name: row.name });
    };

    const cancelEdit = () => {
        setEditingId(null);
        setEditDraft(null);
    };

    const saveEdit = (row) => lock.runLocked('edit', async () => {
        setError('');
        try {
            await updateTaxonomyTerm(activeKind, row.id, editDraft);
            cancelEdit();
            await load();
        } catch (err) {
            setError(err.message);
        }
    });

    const removeRow = (row) => {
        const label = isAffix ? row.affix : row.name;
        if (!window.confirm(`確定要刪除「${label}」嗎？此操作無法復原。`)) return Promise.resolve();

        return lock.runLocked('delete', async () => {
            setDeletingId(row.id);
            setError('');
            try {
                await deleteTaxonomyTerm(activeKind, row.id);
                await load();
            } catch (err) {
                setError(err.message);
            } finally {
                setDeletingId(null);
            }
        });
    };

    // 合併目標只能是同一種主檔的其他列；詞綴還必須是同一個族語的。
    const mergeOptions = mergeSource
        ? rows.filter((row) => (
            row.id !== mergeSource.id
            && (!isAffix || row.tribe_id === mergeSource.tribe_id)
        ))
        : [];

    return {
        activeKind,
        isAffix,
        rows,
        taxonomies,
        tribeNames,
        loading,
        error,
        setError,
        reload: load,
        selectKind,

        create: {
            newName, setNewName,
            newAffix, setNewAffix,
            creating,
            submit: submitCreate,
        },

        edit: {
            editingId, editDraft, setEditDraft, savingEdit,
            start: startEdit,
            cancel: cancelEdit,
            save: saveEdit,
        },

        removeRow,
        deletingId,

        merge: {
            source: mergeSource,
            setSource: setMergeSource,
            options: mergeOptions,
        },
    };
}

export default useTaxonomyManager;
