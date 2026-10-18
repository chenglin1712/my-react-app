import { describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import CertificationSection from './calendar';
import { pickExamSchedule } from './examScheduleContent';

// 固定「今天」：2026/10/12
const NOW = new Date(2026, 9, 12, 15, 30);
const schedule = pickExamSchedule({
  session: '115年度原住民族語言能力認證日程表',
  phases: [
    { phase: '報名', start_date: '2026-09-01', end_date: '2026-09-15' },
    { phase: '准考證', start_date: '2026-10-10', end_date: '2026-10-14' },
    { phase: '測驗', start_date: '2026-11-08', end_date: null },
    { phase: '成績', start_date: '2026-11-13', end_date: null },
  ],
});

describe('族語認證時程', () => {
  test('標題是 h2「族語認證時程」，區塊以標題命名，標題下有屆次', () => {
    render(<CertificationSection schedule={schedule} now={NOW} />);
    const heading = screen.getByRole('heading', { level: 2, name: '族語認證時程' });
    expect(screen.getByRole('region', { name: '族語認證時程' })).toContainElement(heading);
    expect(screen.getByText('115年度原住民族語言能力認證')).toBeInTheDocument();
  });

  test('每個期程一列：日期（起訖用～）、期程名稱、狀態文字', () => {
    render(<CertificationSection schedule={schedule} now={NOW} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('9/1～9/15');
    expect(rows[0]).toHaveTextContent('報名');
    expect(rows[0]).toHaveTextContent('已結束');
    expect(rows[1]).toHaveTextContent('進行中');
    expect(rows[2]).toHaveTextContent('27 天後');
    expect(rows[2]).not.toHaveTextContent('～');
  });

  test('進行中的列有標記（不只靠顏色，狀態字也寫出來）', () => {
    render(<CertificationSection schedule={schedule} now={NOW} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('data-state'))).toEqual(['past', 'current', 'upcoming', 'upcoming']);
  });

  test('連結只放在進行中與下一個期程；已結束或還很久的不放（另開新視窗）', () => {
    // 今天 10/12：報名已結束，准考證進行中，測驗是下一個（沒有頁面），成績還很久
    render(<CertificationSection schedule={schedule} now={NOW} />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  test('下一個期程有頁面時附連結，網址是官方站並另開新視窗', () => {
    render(<CertificationSection schedule={schedule} now={new Date(2026, 10, 10)} />);
    const link = screen.getByRole('link', { name: /前往成績頁面/ });
    expect(link).toHaveAttribute('href', 'https://exam.sce.ntnu.edu.tw/abst/score_search.php');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveTextContent('（另開新視窗）');
    expect(screen.queryByRole('link', { name: /前往報名頁面/ })).toBeNull();
  });

  test('明天開始：寫「明天開始」；結束那天仍是進行中', () => {
    const s = pickExamSchedule({ phases: [
      { phase: '測驗', start_date: '2026-10-13', end_date: null },
      { phase: '准考證', start_date: '2026-10-10', end_date: '2026-10-12' },
    ] });
    render(<CertificationSection schedule={s} now={NOW} />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('進行中');
    expect(rows[1]).toHaveTextContent('明天開始');
  });

  test('載入中：骨架與給報讀器的說明，標題仍在', () => {
    const { container } = render(<CertificationSection loading />);
    expect(screen.getByRole('heading', { level: 2, name: '族語認證時程' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('認證時程載入中');
    expect(container.querySelector('section')).toHaveAttribute('aria-busy', 'true');
  });

  test('載入失敗：顯示說明與「重新載入」，按了呼叫 onRetry', () => {
    const onRetry = vi.fn();
    render(<CertificationSection error onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('目前無法載入認證時程，請稍後再試。');
    fireEvent.click(screen.getByRole('button', { name: '重新載入' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('沒有期程（空陣列、沒傳資料）：顯示「目前沒有認證時程。」，沒有空清單', () => {
    const { rerender } = render(<CertificationSection schedule={{ session: '', phases: [] }} />);
    expect(screen.getByText('目前沒有認證時程。')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    rerender(<CertificationSection />);
    expect(screen.getByText('目前沒有認證時程。')).toBeInTheDocument();
  });

  test('有說明「實際日期以原民會公告為準」', () => {
    render(<CertificationSection schedule={schedule} now={NOW} />);
    expect(within(screen.getByRole('region')).getByText('實際日期以原民會公告為準。')).toBeInTheDocument();
  });
});
