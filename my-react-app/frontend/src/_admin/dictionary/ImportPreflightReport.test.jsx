import {
    describe,
    expect,
    test,
} from 'vitest';
import {
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

    test.each([
        ['沒有 report', undefined],
        ['items 為空陣列', { items: [] }],
    ])('%s 時顯示空狀態', (_name, report) => {
        render(<ImportPreflightReport report={report} />);
        expect(screen.getByText('尚未有預檢資料')).toBeInTheDocument();
    });
});
