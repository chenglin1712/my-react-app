import {
    beforeEach, describe, expect, test, vi,
} from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import {
    MemoryRouter, Route, Routes, useNavigate,
} from 'react-router-dom';

import DictionaryRevisionRoute from './DictionaryRevisionRoute';
import { getRevision } from './dictionaryApi';

vi.mock('./dictionaryApi', () => ({
    getRevision: vi.fn(),
    listTaxonomies: vi.fn(() => Promise.resolve({ tribes: [], grammar_affix: [] })),
}));

const editorRenders = [];
vi.mock('./WordEditor', () => ({
    default: ({ revisionId, initialRevision }) => {
        editorRenders.push({ revisionId, initialId: initialRevision?.id });
        return <div>編輯器 {revisionId}</div>;
    },
}));
vi.mock('./GrammarNodePanel', () => ({ default: () => <div>章節面板</div> }));

function GoTo({ to }) {
    const navigate = useNavigate();
    return <button type="button" onClick={() => navigate(to)}>前往 {to}</button>;
}

const wordCreate = (id) => ({ id, target_kind: 'word', target_id: '', status: 'draft', operation: 'create', payload: {} });

describe('DictionaryRevisionRoute', () => {
    beforeEach(() => {
        editorRenders.length = 0;
        getRevision.mockReset();
    });

    // WP-8 追加（已知小問題 a）
    test('網址的提案編號改變後，在新提案載入完成前不會用舊提案畫編輯器', async () => {
        let resolveSecond;
        getRevision.mockImplementation((id) => (
            String(id) === '1'
                ? Promise.resolve(wordCreate(1))
                : new Promise((resolve) => { resolveSecond = () => resolve(wordCreate(2)); })
        ));

        render(
            <MemoryRouter initialEntries={['/admin/dictionary/revisions/1']}>
                <Routes>
                    <Route
                        path="/admin/dictionary/revisions/:id"
                        element={(
                            <>
                                <GoTo to="/admin/dictionary/revisions/2" />
                                <DictionaryRevisionRoute />
                            </>
                        )}
                    />
                </Routes>
            </MemoryRouter>,
        );

        expect(await screen.findByText('編輯器 1')).toBeInTheDocument();
        editorRenders.length = 0;

        fireEvent.click(screen.getByRole('button', { name: /前往/ }));

        expect(await screen.findByText('載入提案中…')).toBeInTheDocument();
        expect(screen.queryByText('編輯器 1')).not.toBeInTheDocument();
        expect(editorRenders).toEqual([]);

        await act(async () => { resolveSecond(); });
        expect(await screen.findByText('編輯器 2')).toBeInTheDocument();
        expect(editorRenders.every((call) => call.revisionId === 2 && call.initialId === 2)).toBe(true);
    });

    test('讀取失敗時顯示錯誤，不會一直停在載入中', async () => {
        getRevision.mockRejectedValue(new Error('找不到'));
        render(
            <MemoryRouter initialEntries={['/admin/dictionary/revisions/9']}>
                <Routes>
                    <Route path="/admin/dictionary/revisions/:id" element={<DictionaryRevisionRoute />} />
                </Routes>
            </MemoryRouter>,
        );
        expect(await screen.findByText('找不到')).toBeInTheDocument();
    });
});
