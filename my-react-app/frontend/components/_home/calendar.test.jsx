import { describe, expect, test } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import CertificationSection from './calendar';

const exam = (id, over) => ({ id, title: `公告${id}`, detail: `https://exam.example.org/${id}`, start_date: `115年8月${id}日`, ...over });
const many = (n) => Array.from({ length: n }, (_, i) => exam(i + 1));

describe('族語認證最新公告', () => {
  test('標題是 h2，區塊以標題命名', () => {
    render(<CertificationSection examInfo={many(2)} />);
    const heading = screen.getByRole('heading', { level: 2, name: '族語認證最新公告' });
    expect(screen.getByRole('region', { name: '族語認證最新公告' })).toContainElement(heading);
  });

  test('沒有公告：沿用「目前沒有任何公告。」，沒有空清單、沒有展開鈕', () => {
    render(<CertificationSection examInfo={[]} />);
    expect(screen.getByText('目前沒有任何公告。')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('沒傳資料（undefined）也當作沒有公告', () => {
    render(<CertificationSection />);
    expect(screen.getByText('目前沒有任何公告。')).toBeInTheDocument();
  });

  test('每則是清單項目：日期、可點的標題連結（另開新視窗並附報讀器提示）', () => {
    render(<CertificationSection examInfo={many(2)} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    const link = screen.getByRole('link', { name: /公告1/ });
    expect(link).toHaveAttribute('href', 'https://exam.example.org/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveTextContent('（另開新視窗）');
    expect(screen.getByText('115年8月1日')).toBeInTheDocument();
  });

  test('資料是 null：不崩潰，當作沒有公告', () => {
    render(<CertificationSection examInfo={null} />);
    expect(screen.getByText('目前沒有任何公告。')).toBeInTheDocument();
  });

  test('沒有日期不輸出空的日期元素；沒有標題的項目略過，展開鈕的總數不含它', () => {
    const { container } = render(
      <CertificationSection examInfo={[exam(1, { start_date: '' }), exam(2, { title: '  ' }), ...many(8).slice(2)]} />,
    );
    expect(container.querySelector('.exam-date:empty')).toBeNull();
    expect(screen.getByText('公告1')).toBeInTheDocument();
    expect(screen.queryByText('公告2')).toBeNull();
    expect(screen.getByRole('button', { name: '顯示全部 7 則' })).toBeInTheDocument();
  });

  test('沒有網址的公告不是連結', () => {
    render(<CertificationSection examInfo={[exam(1, { detail: '' })]} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('公告1')).toBeInTheDocument();
  });

  test('超過 5 則：先顯示 5 則，按「顯示全部」展開，再按「收合」', () => {
    render(<CertificationSection examInfo={many(8)} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    const more = screen.getByRole('button', { name: '顯示全部 8 則' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(more).toHaveAttribute('aria-controls', screen.getByRole('list').id);
    fireEvent.click(more);
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    const less = screen.getByRole('button', { name: '收合' });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(less);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });

  test('剛好 5 則以內：沒有展開鈕', () => {
    render(<CertificationSection examInfo={many(5)} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(5);
  });

  test('先顯示的是清單最前面的 5 則（後台已排序，不重排）', () => {
    render(<CertificationSection examInfo={many(7)} />);
    expect(screen.getByText('公告1')).toBeInTheDocument();
    expect(screen.getByText('公告5')).toBeInTheDocument();
    expect(screen.queryByText('公告6')).toBeNull();
  });
});
