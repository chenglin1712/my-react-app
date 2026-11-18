import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import GameIntro from './GameIntro';

const LINES = ['歡迎來到《測試》', '第一行背景', '第二行背景', '第三行玩法', '第四行玩法'];

describe('GameIntro（P4-2）', () => {
  test('第一行是標題；其餘各行全部在 DOM 裡（全文沒有刪減），預設收合', () => {
    render(<GameIntro lines={LINES} onStart={() => {}} />);
    expect(screen.getByRole('heading', { name: '歡迎來到《測試》' })).toBeInTheDocument();
    LINES.slice(1).forEach((l) => expect(screen.getByText(l)).toBeInTheDocument());
    expect(document.querySelector('.game-intro-body')).not.toHaveClass('is-open');
  });

  test('「了解更多」展開、「收起」收合；aria-expanded 與 aria-controls 對應', () => {
    render(<GameIntro lines={LINES} onStart={() => {}} />);
    const more = screen.getByRole('button', { name: '了解更多' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById(more.getAttribute('aria-controls'))).toBe(document.querySelector('.game-intro-body'));
    fireEvent.click(more);
    expect(screen.getByRole('button', { name: '收起' })).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('.game-intro-body')).toHaveClass('is-open');
  });

  test('介紹很短（不超過兩行內文）就沒有「了解更多」', () => {
    render(<GameIntro lines={['標題', '一行', '兩行']} onStart={() => {}} />);
    expect(screen.queryByRole('button', { name: '了解更多' })).not.toBeInTheDocument();
  });

  test('開始鈕是主要按鈕，點了呼叫 onStart；載入中 disabled 並顯示「載入中...」', () => {
    const onStart = vi.fn();
    const { rerender } = render(<GameIntro lines={LINES} onStart={onStart} />);
    const start = screen.getByRole('button', { name: '開始' });
    expect(start).toHaveClass('yy-btn-primary');
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledTimes(1);
    rerender(<GameIntro lines={LINES} onStart={onStart} loading />);
    expect(screen.getByRole('button', { name: '載入中...' })).toBeDisabled();
  });

  test('有錯誤：role=alert 顯示在開始鈕上方，按鈕變成「重試」', () => {
    render(<GameIntro lines={LINES} onStart={() => {}} error="載入失敗" />);
    const alert = screen.getByRole('alert');
    const retry = screen.getByRole('button', { name: '重試' });
    expect(alert).toHaveTextContent('載入失敗');
    expect(alert.compareDocumentPosition(retry) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('補充內容（children）放在開始鈕之後', () => {
    render(<GameIntro lines={LINES} onStart={() => {}}><p>錄音說明</p></GameIntro>);
    const start = screen.getByRole('button', { name: '開始' });
    expect(start.compareDocumentPosition(screen.getByText('錄音說明')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
