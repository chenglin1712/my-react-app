import { Badge, Table } from 'react-bootstrap';

const ACTIONS = {
    create: { label: '新建', bg: 'success' },
    update: { label: '更新', bg: 'info' },
    error: { label: '錯誤', bg: 'danger' },
};

export default function ImportPreflightReport({ report }) {
    const items = report?.items ?? [];

    if (items.length === 0) {
        return (
            <div className="dictionary-empty">
                尚未有預檢資料
            </div>
        );
    }

    return (
        <div className="dictionary-table-card">
            <Table responsive hover className="dictionary-table">
                <thead>
                    <tr>
                        <th>列號</th>
                        <th>詞形</th>
                        <th>預檢結果</th>
                        <th>詳細資料</th>
                    </tr>
                </thead>

                <tbody>
                    {items.map((item, index) => {
                        const action = ACTIONS[item.action] ?? {
                            label: item.action || '未知',
                            bg: 'secondary',
                        };

                        return (
                            <tr key={`${item.row ?? index}-${item.name ?? ''}`}>
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
            </Table>
        </div>
    );
}
