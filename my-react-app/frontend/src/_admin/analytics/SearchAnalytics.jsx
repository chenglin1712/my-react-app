import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Alert,
    Button,
    Form,
    Spinner,
    Table,
} from 'react-bootstrap';
import { BarChart3, FilePlus2 } from 'lucide-react';
import { useAuth } from '../../userServives/authContext';
import { TRIBES } from '../../constants/tribes';
import { apiGet } from '../../../utils/apiClient';
import '../../../static/css/_admin/analytics.css';

const DATE_RANGE_OPTIONS = [
    { value: 'today', label: '今日' },
    { value: '7d', label: '7 天' },
    { value: '30d', label: '30 天' },
    { value: 'custom', label: '自訂' },
];

const CONTENT_EDITOR_ROLES = ['owner', 'admin', 'editor'];

const EmptyTable = () => (
    <div className="search-analytics-empty">
        <BarChart3 size={28} />
        <p>此區間暫無資料</p>
    </div>
);

function QueryTable({
    title,
    items,
    loading,
    showCreateAction = false,
    onCreateDraft,
}) {
    return (
        <section className="search-analytics-panel">
            <div className="search-analytics-panel-heading">
                <h2>{title}</h2>
                {!loading && items.length > 0 && (
                    <span>共 {items.length} 筆</span>
                )}
            </div>

            {loading ? (
                <div className="search-analytics-loading">
                    <Spinner animation="border" size="sm" />
                    載入中
                </div>
            ) : items.length === 0 ? (
                <EmptyTable />
            ) : (
                <Table responsive hover className="search-analytics-table">
                    <thead>
                        <tr>
                            <th>查詢字詞</th>
                            <th className="search-analytics-count-column">次數</th>
                            {showCreateAction && (
                                <th className="search-analytics-action-column">操作</th>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {items.map((item) => (
                            <tr key={item.query}>
                                <td className="search-analytics-query">
                                    {item.query}
                                </td>
                                <td className="search-analytics-count">
                                    {item.count}
                                </td>
                                {showCreateAction && (
                                    <td className="search-analytics-action">
                                        <Button
                                            variant="outline-primary"
                                            size="sm"
                                            aria-label={`建立「${item.query}」詞條草稿`}
                                            onClick={() => onCreateDraft(item.query)}
                                        >
                                            <FilePlus2 size={15} aria-hidden="true" />
                                            建立詞條草稿
                                        </Button>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </Table>
            )}
        </section>
    );
}

export default function SearchAnalytics() {
    const { userData } = useAuth();
    const navigate = useNavigate();
    const canCreateDraft = CONTENT_EDITOR_ROLES.includes(userData?.role);

    const [dateRange, setDateRange] = useState('7d');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [tribe, setTribe] = useState('');

    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const customDatesIncomplete = (
        dateRange === 'custom' && (!dateFrom || !dateTo)
    );

    useEffect(() => {
        if (customDatesIncomplete) {
            setData(null);
            setLoading(false);
            setError('');
            return undefined;
        }

        let active = true;
        setLoading(true);
        setError('');

        const params = new URLSearchParams({ date_range: dateRange });

        if (dateRange === 'custom') {
            params.set('date_from', dateFrom);
            params.set('date_to', dateTo);
        }

        if (tribe) params.set('tribe', tribe);

        (async () => {
            try {
                const result = await apiGet(
                    `/adminapi/analytics/search/?${params.toString()}`,
                );

                if (active) setData(result);
            } catch (err) {
                if (active) {
                    setData(null);
                    setError(err.message);
                }
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => {
            active = false;
        };
    }, [
        customDatesIncomplete,
        dateRange,
        dateFrom,
        dateTo,
        tribe,
    ]);

    const createDraft = (query) => {
        navigate('/admin/dictionary/words/new', {
            state: { prefillName: query },
        });
    };

    return (
        <main className="search-analytics-page">
            <div className="search-analytics-heading">
                <h1>搜尋分析</h1>
                <p>掌握熱門搜尋需求與尚未被辭典內容滿足的查詢</p>
            </div>

            <section
                className="search-analytics-filter-panel"
                aria-label="搜尋分析篩選器"
            >
                <div className="search-analytics-filter-group">
                    <Form.Label htmlFor="search-analytics-date-range">
                        日期區間
                    </Form.Label>
                    <Form.Select
                        id="search-analytics-date-range"
                        value={dateRange}
                        onChange={(event) => setDateRange(event.target.value)}
                    >
                        {DATE_RANGE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </Form.Select>
                </div>

                {dateRange === 'custom' && (
                    <>
                        <div className="search-analytics-filter-group">
                            <Form.Label htmlFor="search-analytics-date-from">
                                開始日期
                            </Form.Label>
                            <Form.Control
                                id="search-analytics-date-from"
                                type="date"
                                value={dateFrom}
                                max={dateTo || undefined}
                                onChange={(event) => setDateFrom(event.target.value)}
                            />
                        </div>

                        <div className="search-analytics-filter-group">
                            <Form.Label htmlFor="search-analytics-date-to">
                                結束日期
                            </Form.Label>
                            <Form.Control
                                id="search-analytics-date-to"
                                type="date"
                                value={dateTo}
                                min={dateFrom || undefined}
                                onChange={(event) => setDateTo(event.target.value)}
                            />
                        </div>
                    </>
                )}

                <div className="search-analytics-filter-group">
                    <Form.Label htmlFor="search-analytics-tribe">
                        族語
                    </Form.Label>
                    <Form.Select
                        id="search-analytics-tribe"
                        value={tribe}
                        onChange={(event) => setTribe(event.target.value)}
                    >
                        <option value="">全部族語</option>
                        {TRIBES.map((item) => (
                            <option key={item.slug} value={item.slug}>
                                {item.fullName}
                            </option>
                        ))}
                    </Form.Select>
                </div>

                {customDatesIncomplete && (
                    <p className="search-analytics-filter-hint">
                        請選擇開始與結束日期
                    </p>
                )}
            </section>

            {error && (
                <Alert variant="danger" className="search-analytics-error">
                    {error}
                </Alert>
            )}

            {customDatesIncomplete ? (
                <section className="search-analytics-date-placeholder">
                    <BarChart3 size={30} />
                    <p>請選擇開始與結束日期以載入搜尋分析</p>
                </section>
            ) : !error && (
                <div className="search-analytics-grid">
                    <QueryTable
                        title="熱門查詢"
                        items={data?.popular_queries ?? []}
                        loading={loading}
                    />

                    <QueryTable
                        title="查無結果詞"
                        items={data?.zero_result_queries ?? []}
                        loading={loading}
                        showCreateAction={canCreateDraft}
                        onCreateDraft={createDraft}
                    />
                </div>
            )}
        </main>
    );
}
