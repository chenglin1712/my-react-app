import { useEffect, useState } from 'react';
import {
    Link, Navigate, useLocation, useNavigate, useParams,
} from 'react-router-dom';
import { Alert, Button, Spinner } from 'react-bootstrap';
import { ArrowLeft } from 'lucide-react';

import { getRevision, listTaxonomies } from './dictionaryApi';
import WordEditor from './WordEditor';
import GrammarNodePanel from './GrammarNodePanel';
import { formatApiError } from '../apiErrors';
import '../../../static/css/_admin/dictionary.css';

/**
 * /admin/dictionary/revisions/:id（稽核 FE7a-02）。
 *
 * 新建詞條／章節的提案沒有 word_id／section_id，原本離開頁面就找不回來，審核者也無法從
 * 送審佇列開啟核准。這個路由用提案編號開啟：
 *   - 已有目標（更新、刪除，或已核准的新建）：導到該詞條頁／文法管理頁，由那邊載入提案；
 *   - 還沒有目標的新建提案：直接在這裡開編輯器。
 */
function GrammarRevisionPage({ revision }) {
    const navigate = useNavigate();
    const location = useLocation();
    const [taxonomies, setTaxonomies] = useState({ tribes: [], grammar_affix: [] });
    // 新建章節第一次存檔後從文法管理頁換過來時帶的成功訊息；讀一次就清掉，重新整理不會再出現
    const [flash] = useState(() => location.state?.flash ?? '');
    useEffect(() => {
        if (location.state?.flash) {
            navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
        }
    }, [location.pathname, location.search, location.state, navigate]);

    useEffect(() => {
        let active = true;
        listTaxonomies()
            .then((result) => {
                if (active) setTaxonomies({ ...result, tribes: result.tribes ?? [], grammar_affix: result.grammar_affix ?? [] });
            })
            .catch(() => {
                // 詞綴選項載入失敗只影響勾選清單，提案內容本身仍可檢視
            });
        return () => { active = false; };
    }, []);

    return (
        <main className="dictionary-admin-page">
            <Button as={Link} variant="link" className="dictionary-back-link" to="/admin/dictionary/grammar">
                <ArrowLeft size={17} />
                返回文法管理
            </Button>
            <GrammarNodePanel
                tribeId={String(revision.payload?.tribe_id ?? '')}
                sectionId={null}
                revisionId={revision.id}
                initialRevision={revision}
                flashMessage={flash}
                taxonomies={taxonomies}
                onCreateApproved={(sectionId) => navigate(`/admin/dictionary/grammar?section=${sectionId}`, { replace: true })}
                onNewDiscarded={() => navigate('/admin/dictionary/grammar', { replace: true })}
            />
        </main>
    );
}

export default function DictionaryRevisionRoute() {
    const { id } = useParams();
    // forId：這份 state 是哪個提案編號的結果
    const [state, setState] = useState({ forId: null, loading: true, revision: null, error: '' });

    useEffect(() => {
        let active = true;
        setState({ forId: id, loading: true, revision: null, error: '' });
        getRevision(id)
            .then((revision) => {
                if (active) setState({ forId: id, loading: false, revision, error: '' });
            })
            .catch((err) => {
                if (active) setState({ forId: id, loading: false, revision: null, error: formatApiError(err) });
            });
        return () => { active = false; };
    }, [id]);

    // WP-8 追加（已知小問題 a）：網址的 id 換了之後，第一次 render 時 effect 還沒跑，state 仍是上一筆
    // 提案；這時若照舊畫，會用舊提案開編輯器（甚至把舊提案的 initialRevision 交給新網址）。
    // state 不是這個 id 的結果時一律顯示載入中。
    if (state.loading || state.forId !== id) {
        return (
            <div className="dictionary-loading">
                <Spinner animation="border" />
                <span>載入提案中…</span>
            </div>
        );
    }

    const { revision } = state;
    if (!revision) {
        return (
            <main className="dictionary-admin-page">
                <Alert variant="danger">{state.error || '找不到這筆提案'}</Alert>
            </main>
        );
    }

    if (revision.target_kind === 'word') {
        if (revision.target_id) {
            return <Navigate to={`/admin/dictionary/words/${revision.target_id}`} replace />;
        }
        // key：同一個元件在不同提案之間切換時要重新載入
        return <WordEditor key={revision.id} revisionId={revision.id} initialRevision={revision} />;
    }

    if (revision.target_kind === 'grammar_section') {
        if (revision.target_id) {
            return <Navigate to={`/admin/dictionary/grammar?section=${revision.target_id}`} replace />;
        }
        return <GrammarRevisionPage key={revision.id} revision={revision} />;
    }

    return (
        <main className="dictionary-admin-page">
            <Alert variant="warning">不支援的提案類型：{revision.target_kind}</Alert>
        </main>
    );
}
