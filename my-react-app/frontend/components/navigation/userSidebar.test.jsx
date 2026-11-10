import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('../../src/userServives/userServive', () => ({ signOut: vi.fn() }));
vi.mock('../../static/assets/_auth/avatar.webp', () => ({ default: 'avatar.webp' }));

import UserSidebar from './userSidebar';
import { signOut } from '../../src/userServives/userServive';

const userData = { firestoreData: { name: 'Y.Cheng', email: 'a@b.tw', identity: '學生', avatarUrl: '' } };

describe('個人資料側欄（UserSidebar）', () => {
  let closeSidebar;
  let onOpenBot;
  beforeEach(() => {
    navigate.mockReset();
    signOut.mockReset();
    closeSidebar = vi.fn();
    onOpenBot = vi.fn();
  });
  const renderSidebar = () => render(<UserSidebar userData={userData} closeSidebar={closeSidebar} onOpenBot={onOpenBot} />);

  test('選單順序：個人詞語庫、AI 助手、我的學習記憶、行事曆', () => {
    renderSidebar();
    const labels = screen.getAllByRole('button').map((b) => b.textContent.trim()).filter((t) => ['個人詞語庫', 'AI 助手', '我的學習記憶', '行事曆'].includes(t));
    expect(labels).toEqual(['個人詞語庫', 'AI 助手', '我的學習記憶', '行事曆']);
  });

  test('「我的學習記憶」導向 /memory 並關閉側欄', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: '我的學習記憶' }));
    expect(navigate).toHaveBeenCalledWith('/memory');
    expect(closeSidebar).toHaveBeenCalledTimes(1);
  });

  test('其他選項維持原行為：個人詞語庫、行事曆導頁，AI 助手開啟助手', () => {
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: '個人詞語庫' }));
    expect(navigate).toHaveBeenLastCalledWith('/favorite', { state: { tabId: 1 } });
    fireEvent.click(screen.getByRole('button', { name: '行事曆' }));
    expect(navigate).toHaveBeenLastCalledWith('/calendar');
    fireEvent.click(screen.getByRole('button', { name: 'AI 助手' }));
    expect(onOpenBot).toHaveBeenCalledTimes(1);
    expect(closeSidebar).toHaveBeenCalledTimes(3);
  });

  test('編輯資料導向 /edit 並帶使用者資料；登出成功回首頁', async () => {
    signOut.mockResolvedValueOnce();
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: '編輯資料' }));
    expect(navigate).toHaveBeenCalledWith('/edit', { state: userData });
    fireEvent.click(screen.getByRole('button', { name: '登出' }));
    await vi.waitFor(() => expect(navigate).toHaveBeenLastCalledWith('/'));
  });

  test('登出失敗顯示可讀的錯誤（role=alert），不導頁', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    signOut.mockRejectedValueOnce(new Error('network'));
    renderSidebar();
    fireEvent.click(screen.getByRole('button', { name: '登出' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('登出失敗，請稍後再試。');
    expect(navigate).not.toHaveBeenCalledWith('/');
    spy.mockRestore();
  });

  test('導覽區有名稱，圖示不會被報讀器讀出', () => {
    renderSidebar();
    expect(screen.getByRole('navigation', { name: '個人選單' })).toBeInTheDocument();
    expect(document.querySelectorAll('.nav-icon[aria-hidden="true"]')).toHaveLength(4);
  });
});
