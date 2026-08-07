import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Alert,
    Button,
    Form,
    Spinner,
    Table,
} from 'react-bootstrap';
import { BarChart3, ExternalLink } from 'lucide-react';
import {
    CartesianGrid,
    Label,
    ReferenceArea,
    ReferenceLine,
    ResponsiveContainer,
    Scatter,
    ScatterChart,
    Tooltip,
    XAxis,
    YAxis,
    ZAxis,
} from 'recharts';
import { TRIBES } from '../../constants/tribes';
import { apiGet } from '../../../utils/apiClient';
import '../../../static/css/_admin/quiz-quality-analysis.css';

const DATE_RANGE_OPTIONS = [
    { value: 'today', label: '今日' },
    { value: '7d', label: '7 天' },
    { value: '30d', label: '30 天' },
    { value: 'custom', label: '自訂' },
];

const ITEM_KIND_LABELS = {
    true_false: '是非題',
    choice: '選擇題',
    matching: '配合題',
    cloze: '閱讀填空',
    situation: '情境題',
};

const formatPercent = (value) => (
    typeof value === 'number'
        ? `${Math.round(value * 100)}%`
        : '—'
);

function EmptyState() {
    return (
        <div className="quiz-quality-empty">
            <BarChart3 size={28} />
            <p>此區間暫無資料</p>
        </div>
    );
}

function QualityTooltip({ active, payload }) {
    if (!active || !payload?.length) return null;

    const item = payload[0].payload;

    return (
        <div className="quiz-quality-tooltip">
            <strong>{item.label}</strong>
            <span>
                題型：
                {ITEM_KIND_LABELS[item.item_kind] ?? item.item_kind}
            </span>
            <span>作答次數：{item.attempt_count}</span>
            <span>答對率：{formatPercent(item.accuracy_rate)}</span>
            <span>鑑別度：{item.discrimination.toFixed(2)}</span>
            <small>點擊前往題庫列表</small>
        </div>
    );
}

function QualityDot({
    cx,
    cy,
    payload,
    onNavigate,
}) {
    if (!payload) return null;

    return (
        <circle
            cx={cx}
            cy={cy}
            r={7}
            fill="#1f3a5c"
            stroke="#fff"
            strokeWidth={2}
            role="button"
            tabIndex="0"
            aria-label={`查看題目：${payload.label}`}
            className="quiz-quality-dot"
            onClick={() => onNavigate(payload.list_path)}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onNavigate(payload.list_path);
                }
            }}
        />
    );
}

export default function QuizQualityAnalysis() {
    const navigate = useNavigate();

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
                    `/adminapi/analytics/quiz-quality/?${params.toString()}`,
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

    const chartItems = useMemo(
        () => (data?.items ?? []).filter(
            (item) => (
                item.sufficient_sample
                && typeof item.discrimination === 'number'
            ),
        ),
        [data],
    );

    const insufficientItems = useMemo(
        () => (data?.items ?? []).filter(
            (item) => !item.sufficient_sample,
        ),
        [data],
    );

    return (
        <main className="quiz-quality-page">
            <div className="quiz-quality-heading">
                <div>
                    <h1>題目品質分析</h1>
                    <p>以答對率與鑑別度找出需要檢視的題目</p>
                </div>

                {!loading && !error && data && (
                    <div className="quiz-quality-respondents">
                        <strong>{data.respondent_count ?? 0}</strong>
                        <span>位受試者</span>
                    </div>
                )}
            </div>

            <section
                className="quiz-quality-filter-panel"
                aria-label="題目品質分析篩選器"
            >
                <div className="quiz-quality-filter-group">
                    <Form.Label htmlFor="quiz-quality-date-range">
                        日期區間
                    </Form.Label>
                    <Form.Select
                        id="quiz-quality-date-range"
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
                        <div className="quiz-quality-filter-group">
                            <Form.Label htmlFor="quiz-quality-date-from">
                                開始日期
                            </Form.Label>
                            <Form.Control
                                id="quiz-quality-date-from"
                                type="date"
                                value={dateFrom}
                                max={dateTo || undefined}
                                onChange={(event) => setDateFrom(event.target.value)}
                            />
                        </div>

                        <div className="quiz-quality-filter-group">
                            <Form.Label htmlFor="quiz-quality-date-to">
                                結束日期
                            </Form.Label>
                            <Form.Control
                                id="quiz-quality-date-to"
                                type="date"
                                value={dateTo}
                                min={dateFrom || undefined}
                                onChange={(event) => setDateTo(event.target.value)}
                            />
                        </div>
                    </>
                )}

                <div className="quiz-quality-filter-group">
                    <Form.Label htmlFor="quiz-quality-tribe">
                        族語
                    </Form.Label>
                    <Form.Select
                        id="quiz-quality-tribe"
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
                    <p className="quiz-quality-filter-hint">
                        請選擇開始與結束日期
                    </p>
                )}
            </section>

            {error && (
                <Alert variant="danger" className="quiz-quality-error">
                    {error}
                </Alert>
            )}

            {customDatesIncomplete ? (
                <section className="quiz-quality-date-placeholder">
                    <BarChart3 size={30} />
                    <p>請選擇開始與結束日期以載入題目品質分析</p>
                </section>
            ) : !error && (
                <>
                    <section className="quiz-quality-panel quiz-quality-chart-panel">
                        <div className="quiz-quality-panel-heading">
                            <div>
                                <h2>答對率 × 鑑別度</h2>
                                <p>僅顯示樣本充足、可計算鑑別度的題目</p>
                            </div>
                            {!loading && chartItems.length > 0 && (
                                <span>共 {chartItems.length} 題</span>
                            )}
                        </div>

                        <div className="quiz-quality-quadrant-key">
                            <span className="quadrant-difficult">
                                難但有鑑別力
                            </span>
                            <span className="quadrant-good">
                                良好／較易
                            </span>
                            <span className="quadrant-problem">
                                過難或鑑別不良
                            </span>
                            <span className="quadrant-easy">
                                過易或鑑別不足
                            </span>
                        </div>

                        {loading ? (
                            <div className="quiz-quality-loading">
                                <Spinner animation="border" size="sm" />
                                載入中
                            </div>
                        ) : chartItems.length === 0 ? (
                            <EmptyState />
                        ) : (
                            <div className="quiz-quality-chart">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ScatterChart
                                        margin={{
                                            top: 16,
                                            right: 24,
                                            bottom: 20,
                                            left: 8,
                                        }}
                                    >
                                        <CartesianGrid
                                            stroke="#dfe3e6"
                                            strokeDasharray="3 3"
                                        />

                                        <ReferenceArea
                                            x1={0}
                                            x2={0.5}
                                            y1={0}
                                            y2={1}
                                            fill="#fff5d9"
                                            fillOpacity={0.55}
                                        />
                                        <ReferenceArea
                                            x1={0.5}
                                            x2={1}
                                            y1={0}
                                            y2={1}
                                            fill="#eaf6ee"
                                            fillOpacity={0.6}
                                        />
                                        <ReferenceArea
                                            x1={0}
                                            x2={0.5}
                                            y1={-1}
                                            y2={0}
                                            fill="#fdebed"
                                            fillOpacity={0.65}
                                        />
                                        <ReferenceArea
                                            x1={0.5}
                                            x2={1}
                                            y1={-1}
                                            y2={0}
                                            fill="#fff2e2"
                                            fillOpacity={0.6}
                                        />

                                        <ReferenceLine
                                            x={0.5}
                                            stroke="#68717a"
                                            strokeDasharray="5 4"
                                        />
                                        <ReferenceLine
                                            y={0}
                                            stroke="#68717a"
                                            strokeDasharray="5 4"
                                        />

                                        <XAxis
                                            type="number"
                                            dataKey="accuracy_rate"
                                            domain={[0, 1]}
                                            ticks={[0, 0.25, 0.5, 0.75, 1]}
                                            tickFormatter={(value) => `${value * 100}%`}
                                            stroke="#6b5a47"
                                            fontSize={12}
                                        >
                                            <Label
                                                value="答對率"
                                                position="insideBottom"
                                                offset={-12}
                                            />
                                        </XAxis>

                                        <YAxis
                                            type="number"
                                            dataKey="discrimination"
                                            domain={[-1, 1]}
                                            ticks={[-1, -0.5, 0, 0.5, 1]}
                                            stroke="#6b5a47"
                                            fontSize={12}
                                        >
                                            <Label
                                                value="鑑別度"
                                                angle={-90}
                                                position="insideLeft"
                                            />
                                        </YAxis>

                                        <ZAxis
                                            type="number"
                                            dataKey="attempt_count"
                                            range={[70, 260]}
                                        />

                                        <Tooltip
                                            content={<QualityTooltip />}
                                            cursor={{
                                                strokeDasharray: '3 3',
                                            }}
                                        />

                                        <Scatter
                                            name="題目"
                                            data={chartItems}
                                            shape={(props) => (
                                                <QualityDot
                                                    {...props}
                                                    onNavigate={navigate}
                                                />
                                            )}
                                        />
                                    </ScatterChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </section>

                    <section className="quiz-quality-panel">
                        <div className="quiz-quality-panel-heading">
                            <div>
                                <h2>樣本不足清單</h2>
                                <p>尚無法可靠判定鑑別度的題目</p>
                            </div>
                            {!loading && insufficientItems.length > 0 && (
                                <span>共 {insufficientItems.length} 題</span>
                            )}
                        </div>

                        {loading ? (
                            <div className="quiz-quality-loading">
                                <Spinner animation="border" size="sm" />
                                載入中
                            </div>
                        ) : insufficientItems.length === 0 ? (
                            <EmptyState />
                        ) : (
                            <Table
                                responsive
                                hover
                                className="quiz-quality-table"
                            >
                                <thead>
                                    <tr>
                                        <th>題型</th>
                                        <th>內容摘要</th>
                                        <th>作答次數</th>
                                        <th>答對率</th>
                                        <th>狀態</th>
                                        <th>操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {insufficientItems.map((item) => (
                                        <tr key={`${item.item_kind}-${item.item_id}`}>
                                            <td>
                                                {ITEM_KIND_LABELS[item.item_kind]
                                                    ?? item.item_kind}
                                            </td>
                                            <td className="quiz-quality-item-label">
                                                {item.label}
                                            </td>
                                            <td>{item.attempt_count}</td>
                                            <td>{formatPercent(item.accuracy_rate)}</td>
                                            <td>
                                                <span className="quiz-quality-insufficient">
                                                    樣本不足，尚無法判定鑑別度
                                                </span>
                                            </td>
                                            <td>
                                                <Button
                                                    variant="link"
                                                    size="sm"
                                                    aria-label={`前往題庫查看：${item.label}`}
                                                    onClick={() => navigate(item.list_path)}
                                                >
                                                    前往題庫
                                                    <ExternalLink
                                                        size={14}
                                                        aria-hidden="true"
                                                    />
                                                </Button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </Table>
                        )}
                    </section>
                </>
            )}
        </main>
    );
}
