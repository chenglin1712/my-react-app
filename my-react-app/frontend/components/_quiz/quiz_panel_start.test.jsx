import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Panel_Start from './quiz_panel_start';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

describe('Panel_Start（FR-4a：等級資料改用共用 QUIZ_LEVELS）', () => {
  test('四個等級都顯示，點擊會依 level.id 導向對應路徑', () => {
    mockNavigate.mockReset();
    render(<Panel_Start tribe="tayal" />);

    expect(screen.getByText('初級')).toBeInTheDocument();
    expect(screen.getByText('中級')).toBeInTheDocument();
    expect(screen.getByText('中高級')).toBeInTheDocument();
    expect(screen.getByText('高級')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: '選擇' })[2]);
    expect(mockNavigate).toHaveBeenCalledWith('/quiz/3');
  });

  test('非泰雅語會帶族語路徑前綴', () => {
    mockNavigate.mockReset();
    render(<Panel_Start tribe="amis" />);

    fireEvent.click(screen.getAllByRole('button', { name: '選擇' })[0]);
    expect(mockNavigate).toHaveBeenCalledWith('/quiz/amis/1');
  });

  test('推薦等級（中級）顯示推薦圖片，且有非空的 alt', () => {
    render(<Panel_Start tribe="tayal" />);
    expect(screen.getByAltText('推薦等級')).toBeInTheDocument();
  });

  test('點擊「開始情境練習」會導向 scenario 路徑', () => {
    mockNavigate.mockReset();
    render(<Panel_Start tribe="tayal" />);

    fireEvent.click(screen.getByRole('button', { name: '開始情境練習' }));
    expect(mockNavigate).toHaveBeenCalledWith('/quiz/scenario');
  });
});
