import {
    useCallback,
    useEffect,
    useMemo,
    useState,
} from 'react';
import { Link } from 'react-router-dom';
import {
    Alert,
    Badge,
    Button,
    Form,
    Spinner,
    Table,
} from 'react-bootstrap';
import { Eye, Plus, Search } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { listTaxonomies, listWords } from './dictionaryApi';
import { canProposeDictionaryChanges } from './useRevisionActions';
import '../../../static/css/_admin/dictionary.css';

const PAGE_SIZE = 20;

const REVISION_STATUSES = {
    draft: {
        label: '草稿',
        bg: 'secondary',
    },
    pending_review: {
        label: '送審中',
        bg: 'warning',
        text: 'dark',
    },
    approved: {
        label: '已核准',
        bg: 'success',
    },
    rejected: {
        label: '已退件',
        bg: 'danger',
    },
};

const EMPTY_DATA = {
    results: [],
    count: 0,
    page: 1,
    page_size: PAGE_SIZE,
};

function RevisionBadge({ revision }) {
    if (!revision) {
        return <Badge bg="light" text="dark">無待審提案</Badge>;
    }

    const meta = REVISION_STATUSES[revision.status] ?? {
        label: revision.status,
        bg: 'secondary',
    };

    return (
        <Badge bg={meta.bg} text={meta.text}>
            {meta.label}
        </Badge>
    );
}

export default function WordList() {
    const { userData } = useAuth();
    const role = userData?.role;

    const [taxonomies, setTaxonomies] = useState({
        tribes: [],
    });
    const [filters, setFilters] = useState({
        tribe_id: '',
        keyword: '',
        has_pending: false,
    });
    const [query, setQuery] = useState(filters);
    const [page, setPage] = useState(1);
    const [data, setData] = useState(EMPTY_DATA);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const tribeNames = useMemo(
        () => new Map(
            taxonomies.tribes.map((tribe) => [String(tribe.id), tribe.name]),
        ),
        [taxonomies.tribes],
    );

    useEffect(() => {
        let active = true;

        (async () => {
            try {
                const result = await listTaxonomies();
                if (active) {
                    setTaxonomies({
                        tribes: result.tribes ?? [],
                    });
                }
            } catch (err) {
                if (active) setError(err.message);
            }
        })();

        return () => {
            active = false;
        };
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');

        try {
            const params = {
                tribe_id: query.tribe_id,
                keyword: query.keyword.trim(),
                page,
                page_size: PAGE_SIZE,
                ...(query.has_pending ? { has_pending: true } : {}),
            };

            setData(await listWords(params));
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [page, query]);

    useEffect(() => {
        load();
    }, [load]);

    const search = (event) => {
        event.preventDefault();
        setPage(1);
        setQuery(filters);
    };

    const clearFilters = () => {
        const cleared = {
            tribe_id: '',
            keyword: '',
            has_pending: false,
        };

        setFilters(cleared);
        setPage(1);
        setQuery(cleared);
    };

    const hasNext = data.page * data.page_size < data.count;

    return (
        <main className="dictionary-admin-page">
            <div className="dictionary-page-heading">
                <div>
                    <h1>詞條管理</h1>
                    <p>
                        搜尋與管理辭典詞條；所有異動都必須建立提案，
                        核准後才會寫入正式辭典。
                    </p>
                </div>

                {canProposeDictionaryChanges(role) && (
                    <Button
                        as={Link}
                        to="/admin/dictionary/words/new"
                    >
                        <Plus size={18} />
                        新增詞條
                    </Button>
                )}
            </div>

            {error && <Alert variant="danger">{error}</Alert>}

            <Form
                className="dictionary-filter-panel"
                onSubmit={search}
            >
                <Form.Group controlId="dictionary-word-tribe-filter">
                    <Form.Label>族語</Form.Label>
                    <Form.Select
                        value={filters.tribe_id}
                        onChange={(event) => setFilters((current) => ({
                            ...current,
                            tribe_id: event.target.value,
                        }))}
                    >
                        <option value="">全部族語</option>
                        {taxonomies.tribes.map((tribe) => (
                            <option key={tribe.id} value={tribe.id}>
                                {tribe.name}
                            </option>
                        ))}
                    </Form.Select>
                </Form.Group>

                <Form.Group controlId="dictionary-word-keyword-filter">
                    <Form.Label>關鍵字</Form.Label>
                    <Form.Control
                        value={filters.keyword}
                        onChange={(event) => setFilters((current) => ({
                            ...current,
                            keyword: event.target.value,
                        }))}
                        placeholder="輸入詞形前綴"
                    />
                    <Form.Text>依詞形開頭搜尋，不是全文搜尋。</Form.Text>
                </Form.Group>

                <Form.Check
                    id="dictionary-word-pending-filter"
                    className="dictionary-pending-filter"
                    type="checkbox"
                    label="只顯示有待審提案"
                    checked={filters.has_pending}
                    onChange={(event) => setFilters((current) => ({
                        ...current,
                        has_pending: event.target.checked,
                    }))}
                />

                <div className="dictionary-filter-actions">
                    <Button type="submit">
                        <Search size={17} />
                        搜尋
                    </Button>
                    <Button
                        type="button"
                        variant="outline-secondary"
                        onClick={clearFilters}
                    >
                        清除
                    </Button>
                </div>
            </Form>

            <div className="dictionary-table-card">
                {loading ? (
                    <div className="dictionary-loading">
                        <Spinner animation="border" />
                        <span>載入詞條中…</span>
                    </div>
                ) : (
                    <Table
                        responsive
                        hover
                        className="dictionary-table"
                    >
                        <thead>
                            <tr>
                                <th>詞形</th>
                                <th>族語</th>
                                <th>解釋數</th>
                                <th>例句數</th>
                                <th>被引用數</th>
                                <th>送審狀態</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.results.length > 0 ? (
                                data.results.map((word) => (
                                    <tr key={word.id}>
                                        <td>
                                            <div className="dictionary-word-name">
                                                {word.name || '—'}
                                            </div>
                                            {word.dialect && (
                                                <small>{word.dialect}</small>
                                            )}
                                        </td>
                                        <td>
                                            {tribeNames.get(String(word.tribe_id))
                                                ?? word.tribe_id
                                                ?? '—'}
                                        </td>
                                        <td>{word.explanation_count ?? 0}</td>
                                        <td>{word.sentence_count ?? 0}</td>
                                        <td>
                                            {word.referenced_by_anaphora_items ?? 0}
                                        </td>
                                        <td>
                                            <RevisionBadge
                                                revision={word.pending_revision}
                                            />
                                        </td>
                                        <td>
                                            <div className="dictionary-row-actions">
                                                <Button
                                                    as={Link}
                                                    size="sm"
                                                    variant="outline-primary"
                                                    to={`/admin/dictionary/words/${word.id}`}
                                                >
                                                    <Eye size={14} />
                                                    詳情
                                                </Button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td
                                        colSpan="7"
                                        className="dictionary-empty"
                                    >
                                        沒有符合條件的詞條
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </Table>
                )}

                <div className="dictionary-pagination">
                    <span>共 {data.count} 筆</span>

                    <div>
                        <Button
                            type="button"
                            variant="outline-secondary"
                            disabled={loading || page <= 1}
                            onClick={() => setPage((current) => current - 1)}
                        >
                            上一頁
                        </Button>

                        <span>第 {data.page} 頁</span>

                        <Button
                            type="button"
                            variant="outline-secondary"
                            disabled={loading || !hasNext}
                            onClick={() => setPage((current) => current + 1)}
                        >
                            下一頁
                        </Button>
                    </div>
                </div>
            </div>
        </main>
    );
}
