import { useEffect, useState } from 'react';
import { Alert, Spinner } from 'react-bootstrap';
import { Users } from 'lucide-react';
import { apiGet } from '../../../utils/apiClient';
import '../../../static/css/_admin/retention-analysis.css';

const RETENTION_ENDPOINT = '/adminapi/analytics/retention/';

function formatCohortDate(value) {
    if (typeof value !== 'string') return '—';

    const [year, month, day] = value.split('-');

    if (!year || !month || !day) return value;

    return `${year}/${month}/${day}`;
}

function formatPercent(rate) {
    return `${Math.round(rate * 100)}%`;
}

function getRetentionCellStyle(rate) {
    const normalizedRate = Math.min(Math.max(rate, 0), 1);
    const opacity = 0.12 + (normalizedRate * 0.78);

    return {
        backgroundColor: `rgba(31, 58, 92, ${opacity})`,
        color: normalizedRate >= 0.55 ? '#fff' : '#221812',
    };
}

function EmptyState() {
    return (
        <div className="retention-analysis-empty">
            <Users size={30} aria-hidden="true" />
            <p>尚無留存資料</p>
        </div>
    );
}

function RetentionHeatmap({ cohorts, maxWeeks }) {
    const weekOffsets = Array.from(
        { length: maxWeeks },
        (_, index) => index,
    );

    return (
        <section
            className="retention-analysis-panel"
            aria-labelledby="retention-heatmap-title"
        >
            <div className="retention-analysis-panel-heading">
                <div>
                    <h2 id="retention-heatmap-title">每週留存率</h2>
                    <p>依使用者加入週次分組，觀察後續各週的活躍比例</p>
                </div>
            </div>

            <div
                className="retention-analysis-table-scroll"
                tabIndex="0"
                aria-label="世代留存熱力圖，可水平捲動"
            >
                <table className="retention-analysis-table">
                    <thead>
                        <tr>
                            <th
                                scope="col"
                                className="retention-analysis-cohort-heading"
                            >
                                世代
                            </th>

                            {weekOffsets.map((weekOffset) => (
                                <th
                                    key={weekOffset}
                                    scope="col"
                                    className="retention-analysis-week-heading"
                                >
                                    第 {weekOffset} 週
                                </th>
                            ))}
                        </tr>
                    </thead>

                    <tbody>
                        {cohorts.map((cohort) => {
                            const retentionByWeek = new Map(
                                (cohort.retention ?? []).map((item) => (
                                    [item.week_offset, item]
                                )),
                            );

                            return (
                                <tr key={cohort.cohort_start}>
                                    <th
                                        scope="row"
                                        className="retention-analysis-cohort-label"
                                    >
                                        {formatCohortDate(cohort.cohort_start)}
                                        {' '}
                                        那週（{cohort.cohort_size} 人）
                                    </th>

                                    {weekOffsets.map((weekOffset) => {
                                        const retention = retentionByWeek.get(
                                            weekOffset,
                                        );

                                        if (!retention) {
                                            return (
                                                <td
                                                    key={weekOffset}
                                                    className="retention-analysis-cell retention-analysis-cell-pending"
                                                    aria-label={`第 ${weekOffset} 週尚未經過`}
                                                    title="這一週尚未經過"
                                                >
                                                    —
                                                </td>
                                            );
                                        }

                                        const rate = (
                                            typeof retention.rate === 'number'
                                                ? retention.rate
                                                : 0
                                        );
                                        const percentage = formatPercent(rate);

                                        return (
                                            <td
                                                key={weekOffset}
                                                className="retention-analysis-cell retention-analysis-cell-measured"
                                                style={getRetentionCellStyle(rate)}
                                                aria-label={
                                                    `第 ${weekOffset} 週留存率`
                                                    + ` ${percentage}，`
                                                    + `${retention.active_count} 人活躍`
                                                }
                                                title={
                                                    `${retention.active_count} 人活躍，`
                                                    + `留存率 ${percentage}`
                                                }
                                            >
                                                {percentage}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <div
                className="retention-analysis-legend"
                aria-label="熱力圖圖例"
            >
                <div className="retention-analysis-legend-scale">
                    <span>留存率低</span>
                    <span
                        className="retention-analysis-legend-swatch retention-analysis-legend-low"
                        aria-hidden="true"
                    />
                    <span
                        className="retention-analysis-legend-swatch retention-analysis-legend-medium"
                        aria-hidden="true"
                    />
                    <span
                        className="retention-analysis-legend-swatch retention-analysis-legend-high"
                        aria-hidden="true"
                    />
                    <span>留存率高</span>
                </div>

                <div className="retention-analysis-legend-pending">
                    <span
                        className="retention-analysis-legend-swatch"
                        aria-hidden="true"
                    />
                    <span>尚未經過</span>
                </div>
            </div>
        </section>
    );
}

export default function RetentionAnalysis() {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;

        setLoading(true);
        setError('');

        (async () => {
            try {
                const result = await apiGet(RETENTION_ENDPOINT);

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
    }, []);

    const cohorts = data?.cohorts ?? [];
    const maxWeeks = Number.isInteger(data?.max_weeks)
        ? Math.max(data.max_weeks, 0)
        : 0;

    return (
        <main className="retention-analysis-page">
            <div className="retention-analysis-heading">
                <h1>留存分析</h1>
                <p>世代留存熱力圖</p>
            </div>

            {error && (
                <Alert
                    variant="danger"
                    className="retention-analysis-error"
                >
                    {error}
                </Alert>
            )}

            {loading ? (
                <section className="retention-analysis-panel">
                    <div className="retention-analysis-loading">
                        <Spinner
                            animation="border"
                            size="sm"
                            role="status"
                            aria-label="載入留存資料"
                        />
                        <span>載入中</span>
                    </div>
                </section>
            ) : !error && cohorts.length === 0 ? (
                <section className="retention-analysis-panel">
                    <EmptyState />
                </section>
            ) : !error ? (
                <RetentionHeatmap
                    cohorts={cohorts}
                    maxWeeks={maxWeeks}
                />
            ) : null}
        </main>
    );
}
