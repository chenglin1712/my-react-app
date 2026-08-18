import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Badge, Form, Spinner } from 'react-bootstrap';
import {
    Activity,
    BarChart3,
    ClipboardCheck,
    UserPlus,
    Users,
} from 'lucide-react';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Legend,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts';
import { useAuth } from '../../userServives/authContext';
import { apiGet } from '../../../utils/apiClient';
import { useAnalyticsQuery } from '../hooks/useAnalyticsQuery';
import { useAsyncValue } from '../hooks/useAsyncValue';
import { TRIBES } from '../../constants/tribes';
import '../../../static/css/_admin/dashboard.css';

const ACTION_LABELS = {
    create: '建立',
    update: '編輯',
    submit: '送審',
    withdraw: '撤回',
    approve: '核准',
    reject: '退件',
    unpublish: '下架',
    republish: '重新發布',
};

const DATE_RANGE_OPTIONS = [
    { value: 'today', label: '今日' },
    { value: '7d', label: '7 天' },
    { value: '30d', label: '30 天' },
    { value: 'custom', label: '自訂' },
];

const FEATURE_COLORS = ['#1f3a5c', '#2c6e7f', '#4b6b3a', '#d9a227'];

const formatDateTime = (value) => value
    ? new Intl.DateTimeFormat('zh-TW', {
        dateStyle: 'medium',
        timeStyle: 'short',
    }).format(new Date(value))
    : '—';

const formatChartDate = (value) => {
    if (!value) return '';
    const [, month, day] = value.split('-');
    return `${Number(month)}/${Number(day)}`;
};

const getTribeColor = (slug) => (
    TRIBES.find((tribe) => tribe.slug === slug)?.color ?? '#6b7280'
);

const ComingSoonStat = ({ icon: Icon, title }) => (
    <article className="admin-stat-card admin-stat-placeholder">
        <div className="admin-stat-icon"><Icon size={20} /></div>
        <div>
            <span className="admin-stat-title">{title}</span>
            <strong>—</strong>
            <Badge bg="light" text="secondary">即將推出</Badge>
        </div>
    </article>
);

const AnalyticsStat = ({
    icon: Icon,
    title,
    value,
    detail,
    loading,
    error,
}) => (
    <article className="admin-stat-card">
        <div className="admin-stat-icon"><Icon size={20} /></div>
        <div>
            <span className="admin-stat-title">{title}</span>
            {loading
                ? <Spinner animation="border" size="sm" />
                : error
                    ? <small className="dashboard-inline-error">{error}</small>
                    : <strong>{value}</strong>}
            <span className="admin-stat-detail">{detail}</span>
        </div>
    </article>
);

const EmptyPanel = ({ title, message, className = '' }) => (
    <section className={`dashboard-panel dashboard-empty-panel ${className}`}>
        <h2>{title}</h2>
        <div>
            <BarChart3 size={28} />
            <p>{message}</p>
        </div>
    </section>
);

const PanelState = ({ loading, error, empty, children }) => {
    if (loading) {
        return (
            <div className="dashboard-panel-loading">
                <Spinner animation="border" size="sm" />
                載入中
            </div>
        );
    }

    if (error) return <Alert variant="danger">{error}</Alert>;

    if (empty) {
        return (
            <div className="dashboard-chart-empty">
                <BarChart3 size={28} />
                <p>此區間暫無資料</p>
            </div>
        );
    }

    return children;
};

export default function Dashboard() {
    const { userData } = useAuth();
    const canViewAudit = ['owner', 'admin'].includes(userData?.role);

    // 四個彼此獨立的小區塊各自取自己的值（FE-9：原本每個都手寫一次
    // value/loading/error + active 旗標的 useEffect）。
    const pending = useAsyncValue(
        async () => (await apiGet('/adminapi/announcements/?status=pending_review&page_size=1')).count,
    );

    const todayActive = useAsyncValue(
        async () => {
            const data = await apiGet('/adminapi/analytics/dashboard/?date_range=today');
            return data.daily_active_users?.[0]?.count ?? 0;
        },
    );

    const weeklyRegistration = useAsyncValue(
        async () => {
            const data = await apiGet('/adminapi/analytics/dashboard/?date_range=7d');
            return (data.daily_new_registrations ?? [])
                .reduce((sum, item) => sum + item.count, 0);
        },
    );

    const audit = useAsyncValue(
        async () => (await apiGet('/adminapi/audit-log/?limit=8')).results ?? [],
        { enabled: canViewAudit, initialValue: [] },
    );

    // 主要的活動分析區塊有日期區間／族語篩選，跟 SearchAnalytics／
    // QuizQualityAnalysis 共用同一個 hook。
    const {
        data: analytics,
        loading: analyticsLoading,
        error: analyticsError,
        filters,
    } = useAnalyticsQuery({ endpoint: '/adminapi/analytics/dashboard/' });

    const {
        dateRange, setDateRange, dateFrom, setDateFrom,
        dateTo, setDateTo, tribe, setTribe,
    } = filters;

    const pendingCount = pending.value;
    const pendingLoading = pending.loading;
    const pendingError = pending.error;

    const todayActiveCount = todayActive.value;
    const todayActiveLoading = todayActive.loading;
    const todayActiveError = todayActive.error;

    const weeklyRegistrationCount = weeklyRegistration.value;
    const weeklyRegistrationLoading = weeklyRegistration.loading;
    const weeklyRegistrationError = weeklyRegistration.error;

    const auditItems = audit.value;
    const auditLoading = audit.loading;
    const auditError = audit.error;


    const activityChartData = useMemo(() => {
        const registrationByDate = new Map(
            (analytics?.daily_new_registrations ?? [])
                .map((item) => [item.date, item.count]),
        );

        return (analytics?.daily_active_users ?? []).map((item) => ({
            date: item.date,
            dateLabel: formatChartDate(item.date),
            activeUsers: item.count,
            newRegistrations: registrationByDate.get(item.date) ?? 0,
        }));
    }, [analytics]);

    const tribeChartData = analytics?.tribe_distribution ?? [];
    const featureChartData = analytics?.feature_usage ?? [];
    const customDatesIncomplete = dateRange === 'custom' && (!dateFrom || !dateTo);

    return (
        <main className="admin-dashboard-page">
            <div className="dashboard-heading">
                <h1>儀表板</h1>
                <p>後台工作與服務概況</p>
            </div>

            <div className="dashboard-stat-grid">
                <Link
                    className="admin-stat-card admin-stat-link"
                    to="/admin/content/announcements?status=pending_review"
                >
                    <div className="admin-stat-icon"><ClipboardCheck size={20} /></div>
                    <div>
                        <span className="admin-stat-title">待審公告</span>
                        {pendingLoading
                            ? <Spinner animation="border" size="sm" />
                            : pendingError
                                ? <small className="dashboard-inline-error">{pendingError}</small>
                                : <strong>{pendingCount}</strong>}
                        <span className="admin-stat-detail">前往公告管理</span>
                    </div>
                </Link>

                <AnalyticsStat
                    icon={Users}
                    title="今日活躍使用者"
                    value={todayActiveCount}
                    detail="今日不重複活躍人數"
                    loading={todayActiveLoading}
                    error={todayActiveError}
                />

                <AnalyticsStat
                    icon={UserPlus}
                    title="本週新註冊"
                    value={weeklyRegistrationCount}
                    detail="最近 7 天註冊總數"
                    loading={weeklyRegistrationLoading}
                    error={weeklyRegistrationError}
                />

                <ComingSoonStat icon={Activity} title="今日測驗完成" />
            </div>

            <section className="dashboard-filter-panel" aria-label="圖表篩選器">
                <div className="dashboard-filter-group">
                    <Form.Label htmlFor="dashboard-date-range">日期區間</Form.Label>
                    <Form.Select
                        id="dashboard-date-range"
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
                        <div className="dashboard-filter-group">
                            <Form.Label htmlFor="dashboard-date-from">開始日期</Form.Label>
                            <Form.Control
                                id="dashboard-date-from"
                                type="date"
                                value={dateFrom}
                                max={dateTo || undefined}
                                onChange={(event) => setDateFrom(event.target.value)}
                            />
                        </div>
                        <div className="dashboard-filter-group">
                            <Form.Label htmlFor="dashboard-date-to">結束日期</Form.Label>
                            <Form.Control
                                id="dashboard-date-to"
                                type="date"
                                value={dateTo}
                                min={dateFrom || undefined}
                                onChange={(event) => setDateTo(event.target.value)}
                            />
                        </div>
                    </>
                )}

                <div className="dashboard-filter-group">
                    <Form.Label htmlFor="dashboard-tribe">族語</Form.Label>
                    <Form.Select
                        id="dashboard-tribe"
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
                    <p className="dashboard-filter-hint">請選擇開始與結束日期</p>
                )}
            </section>

            <div className="dashboard-analytics-grid">
                <section className="dashboard-panel dashboard-chart-panel dashboard-activity-panel">
                    <h2>每日活躍與新註冊</h2>
                    <PanelState
                        loading={analyticsLoading}
                        error={analyticsError}
                        empty={!customDatesIncomplete && activityChartData.length === 0}
                    >
                        {customDatesIncomplete ? (
                            <div className="dashboard-chart-empty">
                                <p>請選擇開始與結束日期</p>
                            </div>
                        ) : (
                            <div className="dashboard-chart-container">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart
                                        data={activityChartData}
                                        margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
                                    >
                                        <CartesianGrid stroke="#edf0f2" strokeDasharray="3 3" />
                                        <XAxis
                                            dataKey="dateLabel"
                                            stroke="#6b5a47"
                                            fontSize={12}
                                            tickLine={false}
                                        />
                                        <YAxis
                                            allowDecimals={false}
                                            stroke="#6b5a47"
                                            fontSize={12}
                                            tickLine={false}
                                        />
                                        <Tooltip
                                            labelFormatter={(_, payload) => payload?.[0]?.payload?.date ?? ''}
                                        />
                                        <Legend />
                                        <Line
                                            type="monotone"
                                            dataKey="activeUsers"
                                            name="活躍使用者"
                                            stroke="#1f3a5c"
                                            strokeWidth={2}
                                            dot={{ r: 3 }}
                                            activeDot={{ r: 5 }}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="newRegistrations"
                                            name="新註冊"
                                            stroke="#2c6e7f"
                                            strokeWidth={2}
                                            dot={{ r: 3 }}
                                            activeDot={{ r: 5 }}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </PanelState>
                </section>

                <section className="dashboard-panel dashboard-chart-panel">
                    <h2>族語使用分布</h2>
                    <PanelState
                        loading={analyticsLoading}
                        error={analyticsError}
                        empty={!customDatesIncomplete && tribeChartData.length === 0}
                    >
                        {customDatesIncomplete ? (
                            <div className="dashboard-chart-empty">
                                <p>請選擇開始與結束日期</p>
                            </div>
                        ) : (
                            <div className="dashboard-chart-container">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart
                                        data={tribeChartData}
                                        layout="vertical"
                                        margin={{ top: 8, right: 18, left: 8, bottom: 0 }}
                                    >
                                        <CartesianGrid stroke="#edf0f2" strokeDasharray="3 3" />
                                        <XAxis
                                            type="number"
                                            allowDecimals={false}
                                            stroke="#6b5a47"
                                            fontSize={12}
                                            tickLine={false}
                                        />
                                        <YAxis
                                            type="category"
                                            dataKey="label"
                                            width={70}
                                            stroke="#6b5a47"
                                            fontSize={12}
                                            tickLine={false}
                                        />
                                        <Tooltip />
                                        <Bar dataKey="count" name="使用次數" radius={[0, 4, 4, 0]}>
                                            {tribeChartData.map((item) => (
                                                <Cell
                                                    key={item.tribe}
                                                    fill={getTribeColor(item.tribe)}
                                                />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </PanelState>
                </section>

                <section className="dashboard-panel dashboard-chart-panel">
                    <h2>功能使用熱度</h2>
                    <PanelState
                        loading={analyticsLoading}
                        error={analyticsError}
                        empty={!customDatesIncomplete && featureChartData.length === 0}
                    >
                        {customDatesIncomplete ? (
                            <div className="dashboard-chart-empty">
                                <p>請選擇開始與結束日期</p>
                            </div>
                        ) : (
                            <div className="dashboard-chart-container">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart
                                        data={featureChartData}
                                        margin={{ top: 8, right: 12, left: -12, bottom: 0 }}
                                    >
                                        <CartesianGrid stroke="#edf0f2" strokeDasharray="3 3" />
                                        <XAxis
                                            dataKey="label"
                                            stroke="#6b5a47"
                                            fontSize={12}
                                            tickLine={false}
                                        />
                                        <YAxis
                                            allowDecimals={false}
                                            stroke="#6b5a47"
                                            fontSize={12}
                                            tickLine={false}
                                        />
                                        <Tooltip />
                                        <Bar dataKey="count" name="使用次數" radius={[4, 4, 0, 0]}>
                                            {featureChartData.map((item, index) => (
                                                <Cell
                                                    key={item.event_type}
                                                    fill={FEATURE_COLORS[index % FEATURE_COLORS.length]}
                                                />
                                            ))}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </PanelState>
                </section>
            </div>

            <div className={`dashboard-bottom-grid${canViewAudit ? '' : ' without-audit'}`}>
                {canViewAudit && (
                    <section className="dashboard-panel dashboard-audit-panel">
                        <h2>最近操作</h2>
                        {auditLoading
                            ? (
                                <div className="dashboard-panel-loading">
                                    <Spinner animation="border" size="sm" />
                                    載入中
                                </div>
                            )
                            : auditError
                                ? <Alert variant="danger">{auditError}</Alert>
                                : auditItems.length
                                    ? (
                                        <ul>
                                            {auditItems.map((item) => (
                                                <li key={item.id}>
                                                    <div>
                                                        <strong>{item.actor_uid || '—'}</strong>
                                                        <span>
                                                            {ACTION_LABELS[item.action] ?? item.action}
                                                            {' '}
                                                            {item.target_type} #{item.target_id}
                                                        </span>
                                                    </div>
                                                    <time>{formatDateTime(item.created_at)}</time>
                                                </li>
                                            ))}
                                        </ul>
                                    )
                                    : <p className="dashboard-no-records">目前沒有操作紀錄</p>}
                    </section>
                )}

                <EmptyPanel title="系統健康" message="尚未串接健康檢查資料" />
            </div>
        </main>
    );
}
