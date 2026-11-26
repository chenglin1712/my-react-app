import { Alert } from 'react-bootstrap';

const CHANGE_LIMIT = 50;

/**
 * 提案的說明區塊：
 *   - 刪除提案（稽核 FE7a-03／FE7a-07）：明示「核准後會刪除」，表單顯示的是目前內容；
 *     詞條另外顯示是否一併解除引用與目前引用數。
 *   - 更新提案（稽核 FE7a-13）：列出跟現行版本的差異，審核者不用逐欄自己比。
 * changes 為 null 代表沒有現行版本可比（新建提案或讀取失敗），不顯示變更摘要。
 */
export default function RevisionDetails({ revision, entityLabel, changes = null }) {
    if (!revision) return null;

    if (revision.operation === 'delete') {
        const unlink = revision.payload?.unlink_references === true;
        const counts = revision.reference_counts;
        const referenceTotal = counts
            ? (counts.anaphora_items ?? 0) + (counts.grammar_example_words ?? 0)
            : null;

        return (
            <Alert variant="danger" className="dictionary-change-summary" data-testid="revision-delete-info">
                <strong>這是刪除提案。</strong>
                核准後會從正式辭典移除這個{entityLabel}；下方表單顯示的是目前生效的內容，供確認要刪除的是什麼。
                {'unlink_references' in (revision.payload ?? {}) && (
                    <p className="mb-0 mt-2">
                        核准時一併解除引用：<strong>{unlink ? '是' : '否'}</strong>
                        {counts && (
                            <>
                                {'（目前引用：標註 '}
                                {counts.anaphora_items ?? 0}
                                {' 筆、文法例句 '}
                                {counts.grammar_example_words ?? 0}
                                {' 筆）'}
                            </>
                        )}
                    </p>
                )}
                {!unlink && referenceTotal > 0 && (
                    <p className="mb-0 mt-1">此詞條仍被引用且未選擇解除引用，核准時會失敗。</p>
                )}
                {unlink && referenceTotal > 0 && (
                    <p className="mb-0 mt-1">核准後，其他詞條與文法例句中對它的 {referenceTotal} 筆引用會被清除連結。</p>
                )}
                {unlink && (
                    // WP-8 追加：只有擁有者／管理員能在提案時設定「一併解除引用」；審核者可以核准，核准即同意解除
                    <p className="mb-0 mt-1">「一併解除引用」由擁有者或管理員在提出刪除提案時設定；審核者核准即代表同意解除這些引用。</p>
                )}
            </Alert>
        );
    }

    if (revision.operation === 'create') {
        return (
            <Alert variant="info" className="dictionary-change-summary">
                這是新建{entityLabel}的提案，核准後才會加入正式辭典。
            </Alert>
        );
    }

    if (!changes) return null;

    return (
        <section className="dictionary-change-summary" aria-label="變更摘要">
            <Alert variant={changes.length > 0 ? 'info' : 'secondary'}>
                <strong>與目前生效版本相比的變更</strong>
                {changes.length === 0 ? (
                    <p className="mb-0 mt-1">提案內容與目前生效版本相同。</p>
                ) : (
                    <ul className="mt-1">
                        {changes.slice(0, CHANGE_LIMIT).map((change, index) => (
                            // 同一段文字可能重複（例如兩個未命名子項），用索引補足唯一性
                            <li key={`${change.text}-${index}`}>{change.text}</li>
                        ))}
                        {changes.length > CHANGE_LIMIT && (
                            <li>…另有 {changes.length - CHANGE_LIMIT} 項變更</li>
                        )}
                    </ul>
                )}
            </Alert>
        </section>
    );
}
