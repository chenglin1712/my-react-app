import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import AdminTable from './AdminTable';

let observerCallback;
class FakeResizeObserver {
  constructor(cb) { observerCallback = cb; }
  observe() {}
  disconnect() {}
}

const renderTable = () => render(
  <AdminTable label="公告列表" hover className="x-table">
    <thead><tr><th>標題</th><th>操作</th></tr></thead>
    <tbody><tr><td>a</td><td><button type="button">編輯</button></td></tr></tbody>
  </AdminTable>,
);

const setMetrics = (el, { scrollWidth, clientWidth, scrollLeft = 0 }) => {
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
  Object.defineProperty(el, 'scrollLeft', { configurable: true, writable: true, value: scrollLeft });
};

describe('AdminTable（後台表格捲動區）', () => {
  beforeEach(() => { vi.stubGlobal('ResizeObserver', FakeResizeObserver); });
  afterEach(() => { vi.unstubAllGlobals(); });

  test('表格放得下時只是普通容器：沒有 region、沒有 tabIndex、沒有邊緣陰影', () => {
    const { container } = renderTable();
    const scroll = container.querySelector('.admin-table-scroll');
    setMetrics(scroll, { scrollWidth: 300, clientWidth: 300 });
    act(() => observerCallback());
    expect(scroll).not.toHaveAttribute('role');
    expect(scroll).not.toHaveAttribute('tabindex');
    expect(container.querySelector('.admin-table-edge')).toBeNull();
    expect(screen.getByRole('table')).toHaveClass('x-table');
  });

  test('表格比容器寬時成為可聚焦、有名稱的 region，並只在右側顯示陰影', () => {
    const { container } = renderTable();
    const scroll = container.querySelector('.admin-table-scroll');
    setMetrics(scroll, { scrollWidth: 1000, clientWidth: 400, scrollLeft: 0 });
    act(() => observerCallback());
    const region = screen.getByRole('region', { name: '公告列表，可左右捲動' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(container.querySelector('.admin-table-edge.is-end')).not.toBeNull();
    expect(container.querySelector('.admin-table-edge.is-start')).toBeNull();
  });

  test('捲到中間兩側都有陰影，捲到底只剩左側', () => {
    const { container } = renderTable();
    const scroll = container.querySelector('.admin-table-scroll');
    setMetrics(scroll, { scrollWidth: 1000, clientWidth: 400, scrollLeft: 0 });
    act(() => observerCallback());

    scroll.scrollLeft = 200;
    fireEvent.scroll(scroll);
    expect(container.querySelector('.admin-table-edge.is-start')).not.toBeNull();
    expect(container.querySelector('.admin-table-edge.is-end')).not.toBeNull();

    scroll.scrollLeft = 600;
    fireEvent.scroll(scroll);
    expect(container.querySelector('.admin-table-edge.is-start')).not.toBeNull();
    expect(container.querySelector('.admin-table-edge.is-end')).toBeNull();
  });

  test('沒有 ResizeObserver 的環境也不會出錯', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('ResizeObserver', undefined);
    expect(() => renderTable()).not.toThrow();
  });
});
