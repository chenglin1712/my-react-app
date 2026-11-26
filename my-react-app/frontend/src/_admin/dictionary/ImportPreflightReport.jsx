import { useMemo } from 'react';
import { Badge, Button, ButtonGroup } from 'react-bootstrap';
import AdminTable from '../components/AdminTable';
import { REPORT_PAGE_SIZE, useReportPaging } from './useReportPaging';

const ACTIONS = {
    create: { label: '新建', bg: 'success' },
    update: { label: '更新', bg: 'info' },
    error: { label: '錯誤', bg: 'danger' },
};

export function ReportPagingControls({ paging, problemLabel = '錯誤', idPrefix }) {
    const {
        total, problemCount, showAll, setShowAll, page, pageCount, setPage, start, visibleCount,
    } = paging;
    const end = Math.min(start + REPORT_PAGE_SIZE, visibleCount);

    return (
        <div className="dictionary-report-controls">
            {problemCount > 0 && (
                <ButtonGroup size="sm" aria-label="報告顯示範圍">
                    <Button
                        id={`${idPrefix}-filter-problems`}
                        variant={showAll ? 'outline-secondary' : 'secondary'}
                        aria-pressed={!showAll}
                        onClick={() => setShowAll(false)}
                    >
                        只看{problemLabel}（{problemCount}）
                    </Button>
                    <Button
                        id={`${idPrefix}-filter-all`}
                        variant={showAll ? 'secondary' : 'outline-secondary'}
                        aria-pressed={showAll}
                        onClick={() => setShowAll(true)}
                    >
                        全部（{total}）
                    </Button>
                </ButtonGroup>
            )}

            <span className="dictionary-muted" aria-live="polite">
                {visibleCount === 0 ? '沒有符合的列' : `第 ${start + 1}–${end} 列，共 ${visibleCount} 列`}
            </span>

            {pageCount > 1 && (
                <ButtonGroup size="sm" aria-label="報告分頁">
                    <Button
                        variant="outline-secondary"
                        disabled={page <= 1}
                        onClick={() => setPage(page - 1)}
                    >
                        上一頁
                    </Button>
                    <Button variant="outline-secondary" disabled>
                        {page} / {pageCount}
                    </Button>
                    <Button
                        variant="outline-secondary"
                        disabled={page >= pageCount}
                        onClick={() => setPage(page + 1)}
                    >
                        下一頁
                    </Button>
                </ButtonGroup>
            )}
        </div>
    );
}

const isPreflightError = (item) => item.action === 'error';

export default function ImportPreflightReport({ report }) {
    const items = useMemo(() => report?.items ?? [], [report]);
    const paging = useReportPaging(items, isPreflightError);

    if (items.length === 0) {
        return (
            <div className="dictionary-empty">
                尚未有預檢資料
            </div>
        );
    }

    return (
        <div className="dictionary-table-card">
            <ReportPagingControls paging={paging} idPrefix="preflight" />
            <AdminTable label="匯入預檢報告" hover className="dictionary-table">
                <thead>
                    <tr>
                        <th>列號</th>
                        <th>詞形</th>
                        <th>預檢結果</th>
                        <th>詳細資料</th>
                    </tr>
                </thead>

                <tbody>
                    {paging.rows.map(({ item, index }) => {
                        const action = ACTIONS[item.action] ?? {
                            label: item.action || '未知',
                            bg: 'secondary',
                        };

                        return (
                            <tr key={`${item.row ?? index}-${item.name ?? ''}-${index}`}>
                                <td>{item.row ?? index + 1}</td>
                                <td>{item.name || '—'}</td>
                                <td>
                                    <Badge bg={action.bg}>
                                        {action.label}
                                    </Badge>
                                </td>
                                <td>
                                    {item.action === 'error' ? (
                                        item.errors?.length > 0 ? (
                                            <ul className="mb-0">
                                                {item.errors.map((message, errorIndex) => (
                                                    <li key={`${message}-${errorIndex}`}>
                                                        {message}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : (
                                            '未提供錯誤說明'
                                        )
                                    ) : item.action === 'update' && item.word_id ? (
                                        <small className="text-muted">
                                            將更新詞條 {item.word_id}
                                        </small>
                                    ) : (
                                        <span className="text-muted">—</span>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </AdminTable>
        </div>
    );
}
