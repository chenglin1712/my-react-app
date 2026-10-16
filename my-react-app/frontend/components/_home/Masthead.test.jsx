import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import HomeMasthead from './Masthead';
import { pickMastheadContent } from './mastheadContent';

describe('pickMastheadContent（公開設定 → 報頭與跑馬燈內容）', () => {
  test('一般設定：原樣取出，文字去掉頭尾空白', () => {
    const out = pickMastheadContent({
      marquee_items: [' 第一則 ', '第二則'], show_marquee: true,
      tagline: ' 標語 ', show_tagline: true,
      quote_text: ' 引言 ', show_quote: true,
    });
    expect(out).toEqual({ marqueeItems: ['第一則', '第二則'], tagline: '標語', quote: '引言' });
  });

  test('開關關閉時，即使有內容也回空（後端本來就會清空，前端再擋一次）', () => {
    const out = pickMastheadContent({
      marquee_items: ['甲'], show_marquee: false,
      tagline: '標語', show_tagline: false,
      quote_text: '引言', show_quote: false,
    });
    expect(out).toEqual({ marqueeItems: [], tagline: '', quote: '' });
  });

  test('欄位缺漏或為空：全部回空，不會丟例外', () => {
    expect(pickMastheadContent({})).toEqual({ marqueeItems: [], tagline: '', quote: '' });
    expect(pickMastheadContent(undefined)).toEqual({ marqueeItems: [], tagline: '', quote: '' });
    expect(pickMastheadContent({ marquee_items: [], tagline: '', quote_text: '' })).toEqual({ marqueeItems: [], tagline: '', quote: '' });
  });

  test('型別不對的資料不會畫出來：非陣列、非字串項目、全空白、null', () => {
    const out = pickMastheadContent({
      marquee_items: ['甲', '   ', '', null, 5, { a: 1 }, ['x'], '乙'],
      tagline: 42,
      quote_text: null,
    });
    expect(out.marqueeItems).toEqual(['甲', '乙']);
    expect(out.tagline).toBe('');
    expect(out.quote).toBe('');
    expect(pickMastheadContent({ marquee_items: '甲乙丙' }).marqueeItems).toEqual([]);
    expect(pickMastheadContent({ marquee_items: { 0: '甲' } }).marqueeItems).toEqual([]);
  });

  test('超過 10 項只取前 10 項', () => {
    const items = Array.from({ length: 14 }, (_, i) => `項目${i + 1}`);
    const out = pickMastheadContent({ marquee_items: items });
    expect(out.marqueeItems).toHaveLength(10);
    expect(out.marqueeItems[9]).toBe('項目10');
  });
});

describe('HomeMasthead', () => {
  test('固定品牌字「原語」與「YUAN・YU」一定有', () => {
    render(<HomeMasthead />);
    expect(screen.getByText('原語')).toBeInTheDocument();
    expect(screen.getByText('YUAN・YU')).toBeInTheDocument();
  });

  test('引言與標語空白時不輸出元素，也不放示意文字，並改成兩欄版面', () => {
    const { container } = render(<HomeMasthead quote="" tagline="" />);
    expect(container.querySelector('.home-mast__quote')).toBeNull();
    expect(container.querySelector('.home-mast__tagline')).toBeNull();
    expect(container.querySelector('.home-mast')).toHaveClass('home-mast--no-quote');
    expect(container.textContent).toBe('原語YUAN・YU');
  });

  test('有引言與標語時各自輸出，三欄版面', () => {
    const { container } = render(<HomeMasthead quote="每一種語言，都是一座回得去的家。" tagline="讓語言回家" />);
    expect(container.querySelector('.home-mast__quote')).toHaveTextContent('每一種語言，都是一座回得去的家。');
    expect(container.querySelector('.home-mast__tagline')).toHaveTextContent('讓語言回家');
    expect(container.querySelector('.home-mast')).not.toHaveClass('home-mast--no-quote');
  });

  test('只有標語沒有引言：標語照常顯示，中欄不留空位', () => {
    const { container } = render(<HomeMasthead tagline="讓語言回家" />);
    expect(container.querySelector('.home-mast__tagline')).toBeInTheDocument();
    expect(container.querySelector('.home-mast__quote')).toBeNull();
    expect(container.querySelector('.home-mast')).toHaveClass('home-mast--no-quote');
  });

  test('一律當純文字渲染：HTML 與腳本字串不會變成元素', () => {
    const evil = '<img src=x onerror="alert(1)"><b>粗體</b>';
    const { container } = render(<HomeMasthead quote={evil} tagline={evil} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('.home-mast__quote').textContent).toBe(evil);
    expect(container.querySelector('.home-mast__tagline').textContent).toBe(evil);
  });
});
