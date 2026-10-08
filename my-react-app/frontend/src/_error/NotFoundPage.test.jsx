import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import NotFoundPage from './NotFoundPage';

describe('前台 404 頁', () => {
    test('有唯一的 h1，並提供回首頁、查單詞、回上一頁', () => {
        render(
            <MemoryRouter initialEntries={['/x']}>
                <Routes><Route path="*" element={<NotFoundPage />} /></Routes>
            </MemoryRouter>,
        );
        expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
        expect(screen.getByRole('link', { name: '回到首頁' })).toHaveAttribute('href', '/');
        expect(screen.getByRole('link', { name: '查單詞' })).toHaveAttribute('href', '/search');
        expect(screen.getByRole('button', { name: '回上一頁' })).toBeInTheDocument();
    });
});
