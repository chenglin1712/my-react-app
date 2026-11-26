import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from 'react-bootstrap';

import { listNewWordRevisions } from './dictionaryApi';
import { REVISION_STATUS_META } from './revisionMeta';

/**
 * 稽核 FE7a-02：新建詞條／章節的提案還沒有目標 id，不會出現在詞條列表或文法章節清單裡。
 * 這裡列出「我的新建草稿」與「送審中的新建詞條」，點進去走 /admin/dictionary/revisions/:id。
 * 沒有任何一筆時不顯示；讀取失敗也只是不顯示這塊，不影響下面的詞條列表。
 */
export default function NewWordRevisions({
    tribes = [], kind = 'word', title = '我的草稿與待審的新建詞條',
}) {
    const [items, setItems] = useState([]);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const result = await listNewWordRevisions(kind);
                if (active) setItems(result?.results ?? []);
            } catch {
                if (active) setItems([]);
            }
        })();
        return () => { active = false; };
    }, [kind]);

    if (items.length === 0) return null;

    return (
        <section className="dictionary-editor-card" aria-labelledby={`dictionary-new-${kind}-revisions-title`}>
            <h2 id={`dictionary-new-${kind}-revisions-title`}>{title}</h2>
            <ul className="mb-0">
                {items.map((item) => {
                    const meta = REVISION_STATUS_META[item.status] ?? { label: item.status, bg: 'secondary' };
                    return (
                        <li key={item.id}>
                            <Link to={`/admin/dictionary/revisions/${item.id}`}>
                                {item.title || '（未命名）'}
                            </Link>
                            {' '}
                            <Badge bg={meta.bg} text={meta.text}>{meta.label}</Badge>
                            {item.tribe && (
                                <span className="dictionary-muted">
                                    {' '}
                                    {tribes.find((tribe) => tribe.slug === item.tribe)?.name ?? item.tribe}
                                </span>
                            )}
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
