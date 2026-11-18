import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Panel_Start from './quiz_panel_start';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

describe('Panel_Start（FR-4a：等級資料改用共用 QUIZ_LEVELS）', () => {
  test('四個等級都顯示，點選會依 level.id 導向對應路徑', () => {
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

  test('推薦等級（中級）是膠囊小標籤加文字「推薦」，不是貼紙圖片；只有一張卡有', () => {
    const { container } = render(<Panel_Start tribe="tayal" />);
    const tags = container.querySelectorAll('.level-recommend-tag');
    expect(tags).toHaveLength(1);
    expect(tags[0]).toHaveTextContent('推薦');
    expect(tags[0]).toHaveAttribute('aria-hidden', 'true'); // 報讀器讀的是等級名稱裡的「（推薦）」，不重複讀
    expect(screen.getByText('（推薦）')).toBeInTheDocument();
    expect(tags[0].closest('.level-card')).toHaveClass('level-2');
    expect(container.querySelector('img')).toBeNull();
  });

  test('等級徽章顯示 初、中、中+、高 的文字，等級不只靠顏色分辨', () => {
    const { container } = render(<Panel_Start tribe="tayal" />);
    const badges = [...container.querySelectorAll('.level-icon-text')].map((b) => b.textContent);
    expect(badges).toEqual(['初', '中', '中+', '高']);
  });

  test('點選「開始情境練習」會導向 scenario 路徑', () => {
    mockNavigate.mockReset();
    render(<Panel_Start tribe="tayal" />);

    fireEvent.click(screen.getByRole('button', { name: '開始情境練習' }));
    expect(mockNavigate).toHaveBeenCalledWith('/quiz/scenario');
  });
});
