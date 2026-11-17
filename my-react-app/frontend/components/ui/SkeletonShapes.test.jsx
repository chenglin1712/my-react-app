import { describe, test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WordCardSkeleton, NoteCardSkeleton, NoteEditorSkeleton, TranslateResultSkeleton } from './SkeletonShapes';

describe('SkeletonShapes（P1-4）', () => {
  test('每一組都是一個 role=status，只有一句看不見的說明，塊本身 aria-hidden', () => {
    const { container } = render(
      <>
        <WordCardSkeleton label="搜尋中…" />
        <NoteCardSkeleton label="載入筆記中…" />
        <NoteEditorSkeleton label="載入編輯器…" />
        <TranslateResultSkeleton label="翻譯中…" />
      </>,
    );
    expect(screen.getAllByRole('status')).toHaveLength(4);
    ['搜尋中…', '載入筆記中…', '載入編輯器…', '翻譯中…'].forEach((t) => expect(screen.getByText(t)).toHaveClass('visually-hidden'));
    const blocks = container.querySelectorAll('.yy-skeleton');
    expect(blocks.length).toBeGreaterThan(0);
    blocks.forEach((b) => expect(b.getAttribute('aria-hidden') === 'true' || b.closest('[aria-hidden="true"]')).toBeTruthy());
  });

  test('count 與 lines 決定骨架數量', () => {
    const { container } = render(
      <>
        <WordCardSkeleton count={3} />
        <NoteCardSkeleton count={5} />
        <TranslateResultSkeleton lines={2} />
      </>,
    );
    expect(container.querySelectorAll('.yy-sk-wordcard')).toHaveLength(3);
    expect(container.querySelectorAll('.yy-sk-notecard')).toHaveLength(5);
    expect(container.querySelectorAll('.yy-sk-translate .yy-skeleton')).toHaveLength(2);
  });
});
