/**
 * 稽核 FE7a-13：審核更新提案時，列出提案內容與現行版本的差異。
 *
 * spec 描述一層節點：
 *   fields：{ 欄位: 顯示名稱 }，只比對這些欄位（純量或純量陣列，例如 category_ids）
 *   children：{ 欄位: { label, spec } }，物件陣列（子項），以伺服器 id 對應
 * 子項比對規則跟後端 _reconcile_children 一致：id 為 null 的是新增、現行有但提案沒有的 id 是刪除、
 * 兩邊都有的遞迴比對；保留下來的子項順序改變另外記一筆「調整順序」。
 *
 * 回傳 [{ kind: 'added' | 'removed' | 'modified' | 'reordered', text }]。
 */
const same = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

function itemLabel(childLabel, index, item, spec) {
    const nameField = spec.nameField;
    const name = nameField && item?.[nameField] ? `「${item[nameField]}」` : '';
    return `${childLabel} ${index + 1}${name}`;
}

export function diffTrees(current, proposed, spec, prefix = '') {
    const changes = [];
    const at = (text) => (prefix ? `${prefix} › ${text}` : text);

    Object.entries(spec.fields ?? {}).forEach(([field, fieldSpec]) => {
        // fieldSpec 可以是顯示名稱，或 { label, pick }：pick 只取要比對的部分（例如連結詞條只比 word_id）
        const { label, pick = (value) => value } = typeof fieldSpec === 'string' ? { label: fieldSpec } : fieldSpec;
        if (!same(pick(current?.[field]), pick(proposed?.[field]))) {
            changes.push({ kind: 'modified', text: at(`修改「${label}」`) });
        }
    });

    Object.entries(spec.children ?? {}).forEach(([field, { label, spec: childSpec }]) => {
        const currentItems = current?.[field] ?? [];
        const proposedItems = proposed?.[field] ?? [];
        const currentById = new Map(
            currentItems.filter((item) => item?.id != null).map((item) => [String(item.id), item]),
        );
        const keptIds = [];

        proposedItems.forEach((item, index) => {
            const key = item?.id != null ? String(item.id) : null;
            const entryLabel = itemLabel(label, index, item, childSpec);
            if (key === null || !currentById.has(key)) {
                changes.push({ kind: 'added', text: at(`新增${entryLabel}`) });
                return;
            }
            keptIds.push(key);
            changes.push(...diffTrees(currentById.get(key), item, childSpec, at(entryLabel)));
        });

        const proposedIds = new Set(keptIds);
        currentItems.forEach((item, index) => {
            if (item?.id != null && !proposedIds.has(String(item.id))) {
                changes.push({ kind: 'removed', text: at(`刪除${itemLabel(label, index, item, childSpec)}`) });
            }
        });

        const currentOrder = currentItems
            .map((item) => (item?.id != null ? String(item.id) : null))
            .filter((key) => key !== null && proposedIds.has(key));
        if (!same(currentOrder, keptIds)) {
            changes.push({ kind: 'reordered', text: at(`調整${label}順序`) });
        }
    });

    return changes;
}

// ── 詞條 ──
const AUDIO_SPEC = { fields: { file_id: '音檔', audio_class: '音檔分類' } };
const ANAPHORA_ITEM_SPEC = { nameField: 'name', fields: { name: '名稱', word_id: '連結詞條' } };
const ANAPHORA_SPEC = {
    fields: { is_highlight: '標示', is_symbol: '符號' },
    children: { items: { label: '標註項目', spec: ANAPHORA_ITEM_SPEC } },
};
const SENTENCE_SPEC = {
    fields: {
        external_id: '外部編號',
        original_sentence: '族語例句',
        chinese_sentence: '中文翻譯',
        english_sentence: '英文翻譯',
    },
    children: {
        audios: { label: '例句音檔', spec: AUDIO_SPEC },
        anaphoras: { label: '標註', spec: ANAPHORA_SPEC },
    },
};
const EXPLANATION_SPEC = {
    fields: {
        external_id: '外部編號',
        chinese_explanation: '中文解釋',
        english_explanation: '英文解釋',
        category_ids: '分類',
        pos_ids: '詞類',
        focus_ids: '焦點',
    },
    children: {
        images: { label: '圖片', spec: { fields: { image_url: '圖片網址' } } },
        sentences: { label: '例句', spec: SENTENCE_SPEC },
    },
};
export const WORD_DIFF_SPEC = {
    fields: {
        name: '詞形',
        dialect: '方言',
        pinyin: '拼音',
        variant: '變體',
        formation_word: '構詞',
        derivative_root: '詞根',
        frequency: '詞頻',
        hit: '點閱數',
        dictionary_note: '辭典備註',
        word_img: '詞條圖片',
        is_derivative_root: '是否為詞根',
        is_image: '是否有圖片',
        is_zuzucidian: '族語辭典收錄',
        is_other_dialect: '其他方言',
        source_ids: '來源',
    },
    children: {
        audios: { label: '詞條音檔', spec: AUDIO_SPEC },
        explanations: { label: '解釋', spec: EXPLANATION_SPEC },
    },
};

// ── 文法章節 ──
const EXAMPLE_SPEC = {
    fields: {
        tribe_text: '族語例句',
        chinese_text: '中文翻譯',
        analysis: '分析',
        // 連結詞條沒有伺服器 id，只比 word_id 清單（word_name 是顯示用快取，提案裡可能沒有）
        linked_words: { label: '連結詞條', pick: (value) => (value ?? []).map((word) => word?.word_id ?? null) },
    },
};
const RULE_SPEC = {
    nameField: 'title',
    fields: {
        rule_key: '規則代碼', title: '規則名稱', structure: '結構', function: '功能', notes: '備註', affix_ids: '詞綴',
    },
    children: { examples: { label: '例句', spec: EXAMPLE_SPEC } },
};
export const SECTION_DIFF_SPEC = {
    fields: { section_key: '章節代碼', title: '章節名稱', description: '章節說明' },
    children: { rules: { label: '規則', spec: RULE_SPEC } },
};
