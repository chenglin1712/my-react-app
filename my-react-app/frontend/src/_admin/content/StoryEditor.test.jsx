import { useState } from 'react';
import { describe, expect, test } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import StoryEditor, { hasStoryErrors, storyPayloadFrom, storyRowsFrom, validateStory } from './StoryEditor';
import { STORY_KICKER, STORY_STEPS } from '../../../components/_home/storyContent';

const base = (over = {}) => ({ story_enabled: true, story_kicker: '', story_steps: storyRowsFrom([]), ...over });

function Harness({ initial, disabled = false, showErrors = false }) {
    const [value, setValue] = useState(initial);
    return (
        <>
            <StoryEditor
                value={value}
                onChange={(patch) => setValue((c) => ({ ...c, ...patch }))}
                disabled={disabled}
                errors={validateStory(value)}
                showErrors={showErrors}
            />
            <output data-testid="payload">{JSON.stringify(storyPayloadFrom(value))}</output>
        </>
    );
}
const payload = () => JSON.parse(screen.getByTestId('payload').textContent);

describe('storyRowsFrom / storyPayloadFrom', () => {
    test('API 的空清單展開成預設四步，每列有各自的 uid', () => {
        const rows = storyRowsFrom([]);
        expect(rows).toHaveLength(4);
        expect(new Set(rows.map((r) => r.uid)).size).toBe(4);
        expect(rows.map(({ glyph, title, text, pattern }) => ({ glyph, title, text, pattern }))).toEqual(STORY_STEPS);
    });

    test('完全等於預設文案與預設小標時送空清單與空字串（之後預設更新，首頁跟著更新）', () => {
        expect(storyPayloadFrom(base({ story_kicker: STORY_KICKER }))).toEqual({ story_enabled: true, story_kicker: '', story_steps: [] });
        expect(storyPayloadFrom(base({ story_kicker: `  ${STORY_KICKER}  ` })).story_kicker).toBe('');
    });

    test('改過任何一個字就送完整清單（不含 uid、文字去空白）', () => {
        const rows = storyRowsFrom([]);
        rows[1] = { ...rows[1], title: ` ${rows[1].title}！ ` };
        const out = storyPayloadFrom(base({ story_steps: rows, story_kicker: ' 我的旅程 ' }));
        expect(out.story_kicker).toBe('我的旅程');
        expect(out.story_steps).toHaveLength(4);
        expect(out.story_steps[1].title).toBe(`${STORY_STEPS[1].title}！`);
        out.story_steps.forEach((s) => expect(Object.keys(s).sort()).toEqual(['glyph', 'pattern', 'text', 'title']));
    });
});

describe('validateStory', () => {
    test('預設內容沒有錯誤', () => {
        expect(hasStoryErrors(validateStory(base()))).toBe(false);
    });

    test('步數、大字、標題、說明、小標的上限與空白', () => {
        const rows = storyRowsFrom([]);
        expect(validateStory(base({ story_steps: rows.slice(0, 2) })).count).toMatch(/3 到 6 步/);
        expect(validateStory(base({ story_steps: [...rows, ...storyRowsFrom([]), ...storyRowsFrom([])] })).count).toBeTruthy();
        const bad = [{ ...rows[0], glyph: '一二三四五' }, { ...rows[1], title: '標'.repeat(17) }, { ...rows[2], text: '  ' }, rows[3]];
        const e = validateStory(base({ story_steps: bad, story_kicker: 'x'.repeat(21) }));
        expect(e.rows[bad[0].uid].glyph).toMatch(/第 1 步的大字最多 4 字/);
        expect(e.rows[bad[1].uid].title).toMatch(/第 2 步的標題最多 16 字/);
        expect(e.rows[bad[2].uid].text).toMatch(/第 3 步的說明不可空白/);
        expect(e.rows[bad[3].uid]).toBeUndefined();
        expect(e.kicker).toMatch(/最多 20 字/);
        expect(hasStoryErrors(e)).toBe(true);
    });

    test('換行不行', () => {
        const rows = storyRowsFrom([]);
        rows[0] = { ...rows[0], text: '兩行\n文字' };
        expect(validateStory(base({ story_steps: rows })).rows[rows[0].uid].text).toMatch(/單行/);
    });
});

describe('StoryEditor 畫面', () => {
    test('預設顯示四步，每步有大字、標題、說明、織紋；預覽用前台同一組樣式', () => {
        const { container } = render(<Harness initial={base()} />);
        expect(screen.getAllByRole('heading', { level: 3, name: /^第 \d 步$/ })).toHaveLength(4);
        expect(screen.getByDisplayValue('遇見')).toBeInTheDocument();
        expect(screen.getAllByLabelText('左側織紋')[2]).toHaveValue('dots');
        expect(container.querySelector('.admin-story-preview.home-story')).not.toBeNull();
        expect(screen.getByText('預覽（第 1 步）')).toBeInTheDocument();
    });

    test('編輯哪一步，預覽就切到那一步，並反映輸入的文字', () => {
        render(<Harness initial={base()} />);
        const titleInput = screen.getAllByLabelText('標題')[2];
        fireEvent.focus(titleInput);
        fireEvent.change(titleInput, { target: { value: '我的新標題' } });
        expect(screen.getByText('預覽（第 3 步）')).toBeInTheDocument();
        const preview = document.querySelector('.admin-story-preview');
        expect(within(preview).getByText('我的新標題')).toBeInTheDocument();
        expect(payload().story_steps[2].title).toBe('我的新標題');
    });

    test('新增一步到 6 步為止；刪除到 3 步為止，按鈕在極限時停用', () => {
        render(<Harness initial={base()} />);
        const add = screen.getByRole('button', { name: /新增一步/ });
        fireEvent.click(add);
        fireEvent.click(add);
        expect(screen.getAllByRole('heading', { level: 3, name: /^第 \d 步$/ })).toHaveLength(6);
        expect(add).toBeDisabled();
        [6, 5, 4].forEach((n) => fireEvent.click(screen.getByRole('button', { name: `刪除第 ${n} 步` })));
        expect(screen.getAllByRole('heading', { level: 3, name: /^第 \d 步$/ })).toHaveLength(3);
        screen.getAllByRole('button', { name: /^刪除第/ }).forEach((b) => expect(b).toBeDisabled());
    });

    test('上移與下移改順序，最上與最下的按鈕停用', () => {
        render(<Harness initial={base()} />);
        expect(screen.getByRole('button', { name: '第 1 步上移' })).toBeDisabled();
        expect(screen.getByRole('button', { name: '第 4 步下移' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: '第 1 步下移' }));
        expect(payload().story_steps.map((s) => s.glyph)).toEqual(['看見', '遇見', '記住', '回家']);
    });

    test('還原預設文案：步驟與小標回到預設，payload 變回空清單', () => {
        render(<Harness initial={base({ story_kicker: '改過的小標' })} />);
        fireEvent.change(screen.getAllByLabelText('大字')[0], { target: { value: '改' } });
        expect(payload().story_steps).toHaveLength(4);
        fireEvent.click(screen.getByRole('button', { name: /還原預設文案/ }));
        expect(payload()).toEqual({ story_enabled: true, story_kicker: '', story_steps: [] });
        expect(screen.getByLabelText('小標')).toHaveValue('');
    });

    test('錯誤只在送出後（showErrors）顯示，標在欄位上並帶 aria-invalid', () => {
        const rows = storyRowsFrom([]);
        rows[0] = { ...rows[0], glyph: '' };
        const a = render(<Harness initial={base({ story_steps: rows })} />);
        expect(screen.queryByText('第 1 步的大字不可空白')).toBeNull();
        a.unmount();
        render(<Harness initial={base({ story_steps: rows })} showErrors />);
        expect(screen.getByText('第 1 步的大字不可空白')).toBeInTheDocument();
        expect(screen.getAllByLabelText('大字')[0]).toHaveAttribute('aria-invalid', 'true');
    });

    test('沒有編輯權限：所有欄位與按鈕停用或不出現', () => {
        render(<Harness initial={base()} disabled />);
        expect(screen.getByLabelText('小標')).toBeDisabled();
        screen.getAllByLabelText('標題').forEach((el) => expect(el).toBeDisabled());
        expect(screen.queryByRole('button', { name: /新增一步/ })).toBeNull();
        expect(screen.queryByRole('button', { name: /^刪除第/ })).toBeNull();
    });

    test('顯示開關可以關', () => {
        render(<Harness initial={base()} />);
        fireEvent.click(screen.getByLabelText('顯示捲動敘事'));
        expect(payload().story_enabled).toBe(false);
    });
});
