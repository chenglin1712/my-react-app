import { useEffect, useMemo, useState } from 'react';

import {
    createTaxonomyTerm,
    deleteTaxonomyTerm,
    listTaxonomies,
    updateTaxonomyTerm,
} from './dictionaryApi';

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
    const [creating, setCreating] = useState(false);

    const [editingId, setEditingId] = useState(null);
    const [editDraft, setEditDraft] = useState(null);
    const [savingEdit, setSavingEdit] = useState(false);

    const [deletingId, setDeletingId] = useState(null);
    const [mergeSource, setMergeSource] = useState(null);

    const isAffix = activeKind === 'grammar_affix';
    const rows = taxonomies?.[activeKind] ?? [];

    const load = async () => {
        setLoading(true);
        setError('');
        try {
            setTaxonomies(await listTaxonomies());
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        load();
        // 只在掛載時載入一次；之後由各個異動操作自己呼叫 load()。
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
    };

    const submitCreate = async (event) => {
        event.preventDefault();
        setCreating(true);
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
        } finally {
            setCreating(false);
        }
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

    const saveEdit = async (row) => {
        setSavingEdit(true);
        setError('');
        try {
            await updateTaxonomyTerm(activeKind, row.id, editDraft);
            cancelEdit();
            await load();
        } catch (err) {
            setError(err.message);
        } finally {
            setSavingEdit(false);
        }
    };

    const removeRow = async (row) => {
        const label = isAffix ? row.affix : row.name;
        if (!window.confirm(`確定要刪除「${label}」嗎？此操作無法復原。`)) return;

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
