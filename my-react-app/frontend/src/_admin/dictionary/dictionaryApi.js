/**
 * P4 辭典管理的 API 呼叫集中放這裡（比照專案慣例：URL 字串只在一個地方
 * 出現，其餘元件只呼叫這裡的函式，不自己組字串）。全部是 apiGet/apiPost/
 * apiDelete 的薄包裝，見 utils/apiClient.js。
 */
import {
  apiDelete, apiGet, apiPatch, apiPost, apiPut,
} from '../../../utils/apiClient';

// ── 詞條 ──────────────────────────────────────────────
/** params: { tribe_id, keyword, has_pending, page, page_size }
 * has_pending=true 只回傳目前有一筆「送審中」提案的詞條（不含草稿——
 * 草稿是提案者自己的工作副本，不該讓其他人在列表篩選裡看到）。 */
export const listWords = (params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== '' && value !== null && value !== undefined) query.set(key, value);
  });
  const qs = query.toString();
  return apiGet(`/adminapi/dictionary/words/${qs ? `?${qs}` : ''}`);
};

export const getWord = (wordId) => apiGet(`/adminapi/dictionary/words/${wordId}/`);

export const getWordReferences = (wordId) => apiGet(`/adminapi/dictionary/words/${wordId}/references/`);

export const createWordProposal = (payload) => apiPost('/adminapi/dictionary/words/', payload);

export const proposeWordUpdate = (wordId, payload) => (
  apiPost(`/adminapi/dictionary/words/${wordId}/propose/`, payload)
);

export const proposeWordDelete = (wordId, unlinkReferences = false) => (
  apiPost(`/adminapi/dictionary/words/${wordId}/delete-proposal/`, { unlink_references: unlinkReferences })
);

// ── 送審提案（詞條與未來的文法章節共用同一組端點） ──────────
export const getRevision = (revisionId) => apiGet(`/adminapi/dictionary/revisions/${revisionId}/`);

/** 更新一筆草稿提案的內容——給「新建詞條」這種還沒有 word_id 可以掛
 * proposeWordUpdate 的情境用（建立提案之後，送審前可能要繼續編輯好幾次，
 * 每次呼叫這個而不是重新建立一筆新提案）。只有 status=draft 的提案能改。 */
export const updateRevisionPayload = (revisionId, payload) => (
  apiPut(`/adminapi/dictionary/revisions/${revisionId}/`, payload)
);

export const discardRevision = (revisionId) => apiDelete(`/adminapi/dictionary/revisions/${revisionId}/`);

export const submitRevision = (revisionId) => (
  apiPost(`/adminapi/dictionary/revisions/${revisionId}/submit/`)
);

export const withdrawRevision = (revisionId) => (
  apiPost(`/adminapi/dictionary/revisions/${revisionId}/withdraw/`)
);

export const approveRevision = (revisionId, { reviewComment = '' } = {}) => (
  apiPost(`/adminapi/dictionary/revisions/${revisionId}/approve/`, { review_comment: reviewComment })
);

export const rejectRevision = (revisionId, reviewComment) => (
  apiPost(`/adminapi/dictionary/revisions/${revisionId}/reject/`, { review_comment: reviewComment })
);

// ── 主檔（P4.1 唯讀清單給編輯器多選欄位用；P4.2 加上寫入端點） ──
// kind: 'source' | 'category' | 'part_of_speech' | 'focus' | 'grammar_affix'
// （'tribe' 沒有對應的寫入端點——族語清單固定在 config/tribes.py，見後端說明）
export const listTaxonomies = () => apiGet('/adminapi/dictionary/taxonomies/');

export const createTaxonomyTerm = (kind, fields) => (
  apiPost(`/adminapi/dictionary/taxonomies/${kind}/`, fields)
);

export const updateTaxonomyTerm = (kind, id, fields) => (
  apiPatch(`/adminapi/dictionary/taxonomies/${kind}/${id}/`, fields)
);

export const deleteTaxonomyTerm = (kind, id) => (
  apiDelete(`/adminapi/dictionary/taxonomies/${kind}/${id}/`)
);

/** 合併不可逆，限定 owner/admin（見後端 ACCOUNT_MANAGERS 檢查）。 */
export const mergeTaxonomyTerm = (kind, sourceId, targetId) => (
  apiPost(`/adminapi/dictionary/taxonomies/${kind}/${sourceId}/merge/`, { target_id: targetId })
);

// ── 文法章節（P4.3）：跟詞條同一套 DictionaryRevision 送審流程，
// submit/withdraw/approve/reject/discard 直接沿用上面的
// submitRevision/withdrawRevision/approveRevision/rejectRevision/discardRevision，
// 不需要另外包一份。 ──────────────────────────────────────
/** tribeId 必填——文法樹是「一次編輯一個族語」的畫面，跟詞條列表的
 * 「全部族語」預設不同。 */
export const listGrammarSections = (tribeId) => (
  apiGet(`/adminapi/dictionary/grammar/sections/?tribe_id=${encodeURIComponent(tribeId)}`)
);

export const getGrammarSection = (sectionId) => (
  apiGet(`/adminapi/dictionary/grammar/sections/${sectionId}/`)
);

export const createGrammarSectionProposal = (payload) => (
  apiPost('/adminapi/dictionary/grammar/sections/', payload)
);

export const proposeGrammarSectionUpdate = (sectionId, payload) => (
  apiPost(`/adminapi/dictionary/grammar/sections/${sectionId}/propose/`, payload)
);

export const proposeGrammarSectionDelete = (sectionId) => (
  apiPost(`/adminapi/dictionary/grammar/sections/${sectionId}/delete-proposal/`)
);

/** 章節排序直接寫入、不經送審（見後端 dictionary_grammar_views.py 說明）。
 * sectionIds 必須恰好等於該族語目前的章節集合。 */
export const reorderGrammarSections = (tribeId, sectionIds) => (
  apiPost('/adminapi/dictionary/grammar/sections/reorder/', { tribe_id: tribeId, section_ids: sectionIds })
);

// ── 批次匯入／匯出精靈（P4.4） ─────────────────────────
// DictionaryImportJob 走自己的狀態機（uploaded→validated→pending_review→
// applied/applied_with_errors 或 rejected），不是 DictionaryRevision，
// 送審/核准/退件是這裡專屬的端點，不能重用上面詞條/文法章節共用的那組。
export const listImportJobs = (params = {}) => {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== '' && value !== null && value !== undefined) query.set(key, value);
  });
  const qs = query.toString();
  return apiGet(`/adminapi/dictionary/import/${qs ? `?${qs}` : ''}`);
};

export const getImportJob = (jobId) => apiGet(`/adminapi/dictionary/import/${jobId}/`);

/** bundle 是解析好的 JSON 物件（前端先在瀏覽器內用 JSON.parse 讀完使用者
 * 選取的檔案，不是上傳原始檔案本身——只做結構檢查，見後端說明）。 */
export const uploadImportJob = (filename, bundle) => (
  apiPost('/adminapi/dictionary/import/', { filename, bundle })
);

export const preflightImportJob = (jobId) => (
  apiPost(`/adminapi/dictionary/import/${jobId}/preflight/`)
);

/** owner-only，見後端 require_role(request, (OWNER,)) 檢查。 */
export const autoCreateImportTaxonomies = (jobId) => (
  apiPost(`/adminapi/dictionary/import/${jobId}/auto-create-taxonomies/`)
);

export const submitImportJob = (jobId) => apiPost(`/adminapi/dictionary/import/${jobId}/submit/`);

export const withdrawImportJob = (jobId) => apiPost(`/adminapi/dictionary/import/${jobId}/withdraw/`);

export const approveImportJob = (jobId, reviewComment = '') => (
  apiPost(`/adminapi/dictionary/import/${jobId}/approve/`, { review_comment: reviewComment })
);

export const rejectImportJob = (jobId, reviewComment) => (
  apiPost(`/adminapi/dictionary/import/${jobId}/reject/`, { review_comment: reviewComment })
);

/** 回傳解析好的 bundle JSON（不是檔案 blob）——後端用
 * Content-Disposition: attachment 只是給瀏覽器原生下載一個提示，axios 依
 * Content-Type: application/json 還是會直接幫忙解析成物件，呼叫端自己用
 * Blob + <a download> 觸發下載，比照 UserDetail.jsx 的 exportUser() 既有
 * 模式，不需要另外處理 blob responseType。 */
export const exportDictionary = (tribeSlug) => (
  apiGet(`/adminapi/dictionary/export/?tribe=${encodeURIComponent(tribeSlug)}`)
);
