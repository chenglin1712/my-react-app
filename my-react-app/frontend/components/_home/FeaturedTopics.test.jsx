import { describe, expect, test } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FeaturedTopics from './FeaturedTopics';
import { pickFeaturedTopics } from './featuredTopicsContent';

const raw = (id, over) => ({
  id, title: `專題${id}`, summary: `摘要${id}`, image_url: `https://res.cloudinary.com/demo/${id}.jpg`,
  category_label: '文化', ...over,
});
const topics = (n, over) => pickFeaturedTopics({ items: Array.from({ length: n }, (_, i) => raw(i + 1, over)) });
const renderTopics = (list) => render(<MemoryRouter><FeaturedTopics topics={list} /></MemoryRouter>);

describe('首頁本期專題', () => {
  test('沒有專題：不輸出任何元素，連標題都沒有', () => {
    [[], null, undefined].forEach((list) => {
      const { container, unmount } = renderTopics(list);
      expect(container).toBeEmptyDOMElement();
      unmount();
    });
  });

  test('標題是 h2，區塊以標題命名，每張卡是清單項目、標題是 h3', () => {
    renderTopics(topics(3));
    const heading = screen.getByRole('heading', { level: 2, name: '本期專題' });
    expect(screen.getByRole('region', { name: '本期專題' })).toContainElement(heading);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(3);
  });

  test('依張數換版面：1、2、3 張各自的 class，只有 2 張以上才有主卡', () => {
    [1, 2, 3].forEach((n) => {
      const { container, unmount } = renderTopics(topics(n));
      expect(container.querySelector(`.topics-grid--${n}`)).not.toBeNull();
      expect(container.querySelectorAll('.topic-card--lead')).toHaveLength(n > 1 ? 1 : 0);
      expect(container.querySelectorAll('.topic-card')).toHaveLength(n);
      unmount();
    });
  });

  test('每張卡連到自己的文章頁：站內連結，不另開視窗', () => {
    renderTopics(topics(2));
    const link = screen.getByRole('link', { name: '專題1' });
    expect(link).toHaveAttribute('href', '/topics/1');
    expect(link).not.toHaveAttribute('target');
    expect(screen.getByRole('link', { name: '專題2' })).toHaveAttribute('href', '/topics/2');
    expect(document.querySelector('.topic-title--linked')).not.toBeNull();
  });

  test('外部連結（元件仍支援）：另開新視窗並附報讀器提示', () => {
    renderTopics([{ key: 1, title: '外部專題', summary: '', categoryLabel: '', imageUrl: null, link: { href: 'https://example.org/1', external: true } }]);
    const link = screen.getByRole('link', { name: /外部專題/ });
    expect(link).toHaveAttribute('href', 'https://example.org/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveTextContent('（另開新視窗）');
  });

  test('資料沒有 id 時不能點：標題是純文字，不是連結', () => {
    renderTopics(pickFeaturedTopics({ items: [{ title: '專題1' }, { title: '專題2' }] }));
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByRole('heading', { level: 3, name: '專題1' })).toBeInTheDocument();
    expect(document.querySelector('.topic-title--linked')).toBeNull();
  });

  test('圖片是裝飾（alt 留空），沒有圖就是純文字卡，沒有破圖', () => {
    const { container } = renderTopics(pickFeaturedTopics({ items: [raw(1), raw(2, { image_url: '' })] }));
    const images = container.querySelectorAll('img');
    expect(images).toHaveLength(1);
    expect(images[0]).toHaveAttribute('alt', '');
    expect(container.querySelectorAll('.topic-card--text')).toHaveLength(1);
  });

  test('圖片載入失敗：退回純文字卡，文字都還在', () => {
    const { container } = renderTopics(topics(1));
    fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.topic-card--text')).not.toBeNull();
    expect(screen.getByText('摘要1')).toBeInTheDocument();
  });

  test('元件自己也只畫前三張', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ key: i, title: `T${i}`, summary: '', categoryLabel: '', imageUrl: null, link: null }));
    const { container } = renderTopics(many);
    expect(container.querySelectorAll('.topic-card')).toHaveLength(3);
    expect(container.querySelector('.topics-grid--3')).not.toBeNull();
  });

  test('換了新圖片網址：重新嘗試載入，不沿用上一張圖的失敗狀態', () => {
    const first = pickFeaturedTopics({ items: [raw(1)] });
    const { container, rerender } = renderTopics(first);
    fireEvent.error(container.querySelector('img'));
    expect(container.querySelector('img')).toBeNull();
    const second = pickFeaturedTopics({ items: [raw(1, { image_url: 'https://res.cloudinary.com/demo/new.jpg' })] });
    rerender(<MemoryRouter><FeaturedTopics topics={second} /></MemoryRouter>);
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://res.cloudinary.com/demo/new.jpg');
  });

  test('沒有摘要、沒有分類：不輸出空元素', () => {
    const { container } = renderTopics(pickFeaturedTopics({ items: [raw(1, { summary: '', category_label: '' })] }));
    expect(container.querySelector('.topic-summary')).toBeNull();
    expect(container.querySelector('.topic-tag')).toBeNull();
  });

  test('文字一律當純文字：標籤字元不會被解析成元素', () => {
    renderTopics(pickFeaturedTopics({ items: [raw(1, { title: '<b>粗體</b>', summary: '<img src=x onerror=alert(1)>' })] }));
    const card = screen.getByRole('listitem');
    expect(within(card).getByText('<b>粗體</b>', { exact: false })).toBeInTheDocument();
    expect(card.querySelector('b')).toBeNull();
    expect(card.querySelectorAll('img')).toHaveLength(1);
  });
});
