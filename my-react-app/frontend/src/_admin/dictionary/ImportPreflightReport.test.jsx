import {
    describe,
    expect,
    test,
} from 'vitest';
import {
    fireEvent,
    render,
    screen,
    within,
} from '@testing-library/react';
import ImportPreflightReport from './ImportPreflightReport';

describe('ImportPreflightReport', () => {
    test('顯示新建、更新與錯誤列及其徽章', () => {
        render(
            <ImportPreflightReport
                report={{
                    new_count: 1,
                    update_count: 1,
                    error_count: 1,
                    items: [
                        {
                            row: 1, name: 'lokah', action: 'create', word_id: null, errors: [], payload: {},
                        },
                        {
                            row: 2, name: 'maku', action: 'update', word_id: 'word-22', errors: [], payload: {},
                        },
                        {
                            row: 3,
                            name: '錯誤詞',
                            action: 'error',
                            word_id: null,
                            errors: ['找不到分類：植物', '找不到詞性：名詞'],
                            payload: null,
                        },
                    ],
                }}
            />,
        );

        // 稽核 FE7a-14：預設只顯示錯誤列
        expect(screen.queryByText('lokah')).not.toBeInTheDocument();
        expect(screen.getByText('錯誤詞')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /全部（3）/ }));

        const createRow = screen.getByText('lokah').closest('tr');
        const updateRow = screen.getByText('maku').closest('tr');
        const errorRow = screen.getByText('錯誤詞').closest('tr');

        expect(within(createRow).getByText('新建')).toHaveClass('bg-success');
        expect(within(updateRow).getByText('更新')).toHaveClass('bg-info');
        expect(within(updateRow).getByText('將更新詞條 word-22')).toBeInTheDocument();
        expect(within(errorRow).getByText('錯誤')).toHaveClass('bg-danger');
        expect(within(errorRow).getByText('找不到分類：植物')).toBeInTheDocument();
        expect(within(errorRow).getByText('找不到詞性：名詞')).toBeInTheDocument();
    });

    test('稽核 FE7a-14：沒有錯誤時直接顯示全部，超過 100 列時分頁', () => {
        const items = Array.from({ length: 250 }, (_, index) => ({
            row: index + 1, name: `word-${index + 1}`, action: 'create', errors: [],
        }));
        render(<ImportPreflightReport report={{ items }} />);

        expect(screen.queryByRole('button', { name: /只看錯誤/ })).not.toBeInTheDocument();
        expect(screen.getByText('word-1')).toBeInTheDocument();
        expect(screen.getByText('word-100')).toBeInTheDocument();
        expect(screen.queryByText('word-101')).not.toBeInTheDocument();
        expect(screen.getByText('第 1–100 列，共 250 列')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: '下一頁' }));
        expect(screen.getByText('word-101')).toBeInTheDocument();
        expect(screen.queryByText('word-1')).not.toBeInTheDocument();
        expect(screen.getByText('2 / 3')).toBeInTheDocument();
    });

    test('稽核 FE7a-14：錯誤列篩選後仍顯示原始列號', () => {
        const items = Array.from({ length: 5 }, (_, index) => ({
            name: `w${index}`, action: index === 3 ? 'error' : 'create', errors: index === 3 ? ['壞'] : [],
        }));
        render(<ImportPreflightReport report={{ items }} />);

        const row = screen.getByText('w3').closest('tr');
        expect(within(row).getByText('4')).toBeInTheDocument();
        expect(screen.getAllByRole('row')).toHaveLength(2);
    });

    test.each([
        ['沒有 report', undefined],
        ['items 為空陣列', { items: [] }],
    ])('%s 時顯示空狀態', (_name, report) => {
        render(<ImportPreflightReport report={report} />);
        expect(screen.getByText('尚未有預檢資料')).toBeInTheDocument();
    });
});
