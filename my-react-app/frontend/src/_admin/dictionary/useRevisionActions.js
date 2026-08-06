/**
 * P4 辭典管理的送審按鈕組共用邏輯（編輯/送審/撤回/核准/退件），給
 * WordEditor／GrammarNodePanel（P4.3）共用，避免重複實作非同步狀態
 * 管理與角色判斷。
 *
 * 跟既有 QuizSituations.jsx／QuizBank.jsx 的角色常數維持同一份值
 * （CONTENT_EDITORS/CONTENT_APPROVERS 沒有集中成共用模組，是這幾個
 * 檔案各自宣告同樣的字面值陣列——這是既有慣例，不是這裡新引入的做法）。
 *
 * 這裡刻意不跟 quizbank 那五個頁面共用同一個 hook：辭典的狀態機掛在
 * 「提案」（DictionaryRevision）上而不是內容本身，沒有 unpublish／
 * has_pending_revision 這類語意，也多了合併／匯入這類完全沒有對應的
 * 動作——硬要共用一個 hook 反而會被參數化到難以理解，跟 revisions.py
 * 當初獨立成一個檔案而不是塞進 _make_content_views 的理由一致。
 */
import { useCallback, useState } from 'react';
import {
  approveRevision, discardRevision, rejectRevision, submitRevision, withdrawRevision,
} from './dictionaryApi';

export const CONTENT_EDITORS = ['owner', 'admin', 'editor'];
export const CONTENT_APPROVERS = ['owner', 'admin', 'reviewer'];

export const canProposeDictionaryChanges = (role) => CONTENT_EDITORS.includes(role);
export const canApproveDictionaryChanges = (role) => CONTENT_APPROVERS.includes(role);

/**
 * revision 是 { id, status, operation, submitted_by, submitted_at } 或 null
 * （null 代表目前沒有草稿/送審中的提案）。
 *
 * 回傳：
 *   - pending / error：目前是否有動作正在執行、上一次動作的錯誤訊息
 *   - submit/withdraw/approve/reject/discard：對應動作，成功後呼叫
 *     onChanged(result)，失敗時把錯誤存進 error 並往外拋（呼叫端可以
 *     用 try/catch 做進一步處理，例如關閉 Modal 前先確認沒有錯誤）
 */
export function useRevisionActions(revisionId, { onChanged } = {}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const run = useCallback(async (fn) => {
    setPending(true);
    setError('');
    try {
      const result = await fn();
      onChanged?.(result);
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setPending(false);
    }
  }, [onChanged]);

  return {
    pending,
    error,
    clearError: () => setError(''),
    submit: () => run(() => submitRevision(revisionId)),
    withdraw: () => run(() => withdrawRevision(revisionId)),
    approve: (opts) => run(() => approveRevision(revisionId, opts)),
    reject: (reviewComment) => run(() => rejectRevision(revisionId, reviewComment)),
    discard: () => run(() => discardRevision(revisionId)),
  };
}
