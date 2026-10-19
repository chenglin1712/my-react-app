import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ContactPageEditor from './ContactPageEditor';
import { apiGet, apiPatch } from '../../../utils/apiClient';

vi.mock('../../../utils/apiClient', () => ({
  apiGet: vi.fn(),
  apiPatch: vi.fn(),
}));

vi.mock('../../userServives/authContext', () => ({
  useAuth: () => ({ userData: { role: 'admin' }, loading: false }),
}));

const NEW_DOC = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '新的聯絡方式' }] }] };
vi.mock('../components/RichTextEditor', () => ({
  default: ({ onChange }) => <button type="button" onClick={() => onChange(NEW_DOC)}>改內容</button>,
}));

describe('後台 聯絡我們', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPatch.mockReset();
    apiGet.mockResolvedValue({ content: {}, updated_by: '', updated_at: '2026-10-19T08:00:00Z' });
  });

  test('讀寫聯絡我們自己的端點，並提示怎麼放信箱', async () => {
    apiPatch.mockResolvedValue({ content: NEW_DOC, updated_by: 'boss', updated_at: '2026-10-19T09:00:00Z' });
    render(<ContactPageEditor />);
    expect(await screen.findByRole('heading', { level: 1, name: '聯絡我們' })).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/adminapi/contact-page/');
    expect(screen.getByText(/編輯公開頁 \/contact/)).toBeInTheDocument();
    expect(screen.getByText(/mailto:help@example\.org/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '改內容' }));
    fireEvent.click(screen.getByRole('button', { name: '儲存' }));
    await waitFor(() => expect(apiPatch).toHaveBeenCalledWith('/adminapi/contact-page/', { content: NEW_DOC, base_updated_at: '2026-10-19T08:00:00Z' }));
    expect(await screen.findByRole('status')).toHaveTextContent('聯絡我們已儲存');
  });
});
