import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import ChartFigure from './ChartFigure';

const columns = [{ key: 'name', label: '題型' }, { key: 'share', label: '比例' }];
const rows = [{ name: '是非', share: '40%' }, { name: '選擇', share: '60%' }];

describe('ChartFigure（圖表文字替代）', () => {
    test('圖表有名稱與摘要，並附可展開的資料表', () => {
        render(<ChartFigure title="題型分布" summary="共 2 種題型" columns={columns} rows={rows}><svg /></ChartFigure>);
        expect(screen.getByRole('img', { name: '題型分布' })).toBeInTheDocument();
        expect(screen.getByText('共 2 種題型')).toBeInTheDocument();
        expect(screen.getByText('查看資料表')).toBeInTheDocument();
        expect(screen.getByRole('columnheader', { name: '比例' })).toBeInTheDocument();
        expect(screen.getByRole('rowheader', { name: '是非' })).toBeInTheDocument();
        expect(screen.getByRole('cell', { name: '60%' })).toBeInTheDocument();
    });

    test('沒有資料列時不顯示資料表', () => {
        render(<ChartFigure title="題型分布" summary="目前沒有資料" columns={columns} rows={[]}><svg /></ChartFigure>);
        expect(screen.queryByText('查看資料表')).toBeNull();
    });
});
