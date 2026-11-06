import { useState } from 'react';
import { Button, Form } from 'react-bootstrap';
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { STORY_KICKER, STORY_LIMITS, STORY_PATTERNS, STORY_STEPS } from '../../../components/_home/storyContent';
import '../../../static/css/_home/story.css';
import '../../../static/css/_admin/story-editor.css';

/**
 * 首頁捲動敘事「一個詞的旅程」的編輯區塊（Apple 化 5-5）。
 *
 * 只收純文字與固定的織紋代號：小標、每一步的大字／標題／說明／織紋，3 到 6 步。
 * 步驟順序就是首頁上的順序；不提供自由 HTML。預覽使用前台同一組樣式，編輯哪一步就預覽到哪一步。
 * 這裡的上限與後端 adminapi/validators.py 的 STORY_* 一致（後端才是最後一關，這裡讓錯誤在送出前就看得到）。
 */

let uidCounter = 0;
const nextUid = () => { uidCounter += 1; return `story-row-${uidCounter}`; };

/** API 的步驟（可能是空清單 = 預設）轉成表單的列，每列帶一個只在前端使用的 uid（當 React key）。 */
export function storyRowsFrom(steps) {
    const source = Array.isArray(steps) && steps.length > 0 ? steps : STORY_STEPS;
    return source.map((s) => ({ uid: nextUid(), glyph: s.glyph ?? '', title: s.title ?? '', text: s.text ?? '', pattern: s.pattern ?? 'stripe' }));
}

const countChars = (text) => Array.from(text ?? '').length;
const clean = (row) => ({ glyph: row.glyph.trim(), title: row.title.trim(), text: row.text.trim(), pattern: row.pattern });
const sameAsDefault = (rows) => rows.length === STORY_STEPS.length
    && rows.every((row, i) => {
        const c = clean(row);
        const d = STORY_STEPS[i];
        return c.glyph === d.glyph && c.title === d.title && c.text === d.text && c.pattern === d.pattern;
    });

/** 表單 → API：完全等於預設文案時送空清單（之後預設文案更新，首頁會跟著更新）；小標等於預設也送空字串。 */
export function storyPayloadFrom({ story_enabled: enabled, story_kicker: kicker, story_steps: rows }) {
    const trimmedKicker = kicker.trim();
    return {
        story_enabled: enabled,
        story_kicker: trimmedKicker === STORY_KICKER ? '' : trimmedKicker,
        story_steps: sameAsDefault(rows) ? [] : rows.map(clean),
    };
}

/** 驗證：回傳 { kicker?, count?, rows: { [uid]: { glyph?, title?, text? } } }。 */
export function validateStory({ story_kicker: kicker, story_steps: rows }) {
    const errors = { rows: {} };
    if (countChars(kicker.trim()) > STORY_LIMITS.kicker) errors.kicker = `小標最多 ${STORY_LIMITS.kicker} 字`;
    if (rows.length < STORY_LIMITS.minSteps || rows.length > STORY_LIMITS.maxSteps) {
        errors.count = `步驟必須是 ${STORY_LIMITS.minSteps} 到 ${STORY_LIMITS.maxSteps} 步，目前 ${rows.length} 步`;
    }
    const fields = [['glyph', '大字'], ['title', '標題'], ['text', '說明']];
    rows.forEach((row, index) => {
        fields.forEach(([key, label]) => {
            const value = row[key].trim();
            const limit = STORY_LIMITS[key];
            let message;
            if (!value) message = `第 ${index + 1} 步的${label}不可空白`;
            else if (countChars(value) > limit) message = `第 ${index + 1} 步的${label}最多 ${limit} 字`;
            else if (/[\r\n\u2028\u2029]/.test(value)) message = `第 ${index + 1} 步的${label}必須是單行`;
            if (message) errors.rows[row.uid] = { ...errors.rows[row.uid], [key]: message };
        });
    });
    return errors;
}

export const hasStoryErrors = (errors) => Boolean(errors.kicker || errors.count || Object.keys(errors.rows).length);

function Preview({ rows, kicker, index }) {
    const safe = Math.min(index, rows.length - 1);
    const shown = (key, fallback) => rows[safe][key].trim() || fallback;
    return (
        <div className="admin-story-preview home-story" aria-label="預覽" data-count={rows.length}>
            <div className="home-story__stage">
                <div className="home-story__art" aria-hidden="true">
                    {rows.map((row, i) => (
                        <div
                            key={row.uid}
                            className={`home-story__layer home-story__layer--${row.pattern}${i === 0 ? ' is-first' : ''}${i <= safe ? ' is-on' : ''}`}
                        />
                    ))}
                    <div className="home-story__glyph">{shown('glyph', '　')}</div>
                </div>
                <div className="home-story__copy">
                    <p className="home-story__kicker">{kicker.trim() || STORY_KICKER}</p>
                    <ol className="home-story__steps">
                        {rows.map((row, i) => (
                            <li key={row.uid} className={`home-story__step${i === safe ? ' is-on' : ''}`}>
                                <span className="home-story__num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                                <b>{row.title.trim() || '（未填標題）'}</b>
                                <p>{row.text.trim() || '（未填說明）'}</p>
                            </li>
                        ))}
                    </ol>
                </div>
            </div>
        </div>
    );
}

export default function StoryEditor({ value, onChange, disabled, errors, showErrors }) {
    const { story_enabled: enabled, story_kicker: kicker, story_steps: rows } = value;
    const [previewIndex, setPreviewIndex] = useState(0);
    const e = showErrors ? errors : { rows: {} };

    const setRows = (next) => onChange({ story_steps: next });
    const patchRow = (uid, patch) => setRows(rows.map((row) => (row.uid === uid ? { ...row, ...patch } : row)));
    const move = (index, delta) => {
        const target = index + delta;
        if (target < 0 || target >= rows.length) return;
        const next = rows.slice();
        [next[index], next[target]] = [next[target], next[index]];
        setRows(next);
        setPreviewIndex(target);
    };
    const remove = (index) => {
        setRows(rows.filter((_, i) => i !== index));
        setPreviewIndex((current) => Math.max(0, Math.min(current, rows.length - 2)));
    };
    const add = () => {
        setRows([...rows, { uid: nextUid(), glyph: '', title: '', text: '', pattern: STORY_PATTERNS[rows.length % STORY_PATTERNS.length].value }]);
        setPreviewIndex(rows.length);
    };
    const reset = () => {
        onChange({ story_kicker: '', story_steps: storyRowsFrom([]) });
        setPreviewIndex(0);
    };

    return (
        <section className="homepage-config-section" aria-labelledby="homepage-config-story">
            <div className="homepage-config-section-heading">
                <h2 id="homepage-config-story">捲動敘事：一個詞的旅程</h2>
                <p>首頁第一屏之後的釘住捲動區段。{STORY_LIMITS.minSteps} 到 {STORY_LIMITS.maxSteps} 步，順序就是首頁上的順序；只能填純文字。關掉開關，首頁就不會出現這一段。</p>
            </div>

            <Form.Group className="homepage-config-switch" controlId="homepage-story-enabled">
                <Form.Check
                    type="switch"
                    label="顯示捲動敘事"
                    disabled={disabled}
                    checked={enabled}
                    onChange={(ev) => onChange({ story_enabled: ev.target.checked })}
                    aria-describedby="homepage-story-enabled-hint"
                />
                <Form.Text id="homepage-story-enabled-hint">關閉後內容仍會保留，重新開啟即再次公開。</Form.Text>
            </Form.Group>

            <Form.Group className="homepage-config-field" controlId="homepage-story-kicker">
                <Form.Label>小標</Form.Label>
                <Form.Control
                    disabled={disabled}
                    value={kicker}
                    placeholder={STORY_KICKER}
                    onChange={(ev) => onChange({ story_kicker: ev.target.value })}
                    isInvalid={Boolean(e.kicker)}
                    aria-invalid={Boolean(e.kicker)}
                    aria-describedby={e.kicker ? 'homepage-story-kicker-error homepage-story-kicker-hint' : 'homepage-story-kicker-hint'}
                />
                <Form.Control.Feedback type="invalid" id="homepage-story-kicker-error">{e.kicker}</Form.Control.Feedback>
                <Form.Text id="homepage-story-kicker-hint">最多 {STORY_LIMITS.kicker} 字（目前 {countChars(kicker.trim())} 字）。留白使用「{STORY_KICKER}」。</Form.Text>
            </Form.Group>

            {e.count && <p className="admin-story-count-error" role="alert">{e.count}</p>}

            <ol className="admin-story-rows">
                {rows.map((row, index) => {
                    const re = e.rows[row.uid] ?? {};
                    const id = `homepage-story-${row.uid}`;
                    return (
                        <li key={row.uid} className={`admin-story-row${index === previewIndex ? ' is-previewing' : ''}`} onFocus={() => setPreviewIndex(index)}>
                            <div className="admin-story-row-head">
                                <h3>第 {index + 1} 步</h3>
                                {!disabled && (
                                    <div className="admin-story-row-actions">
                                        <button type="button" className="admin-story-icon-btn" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`第 ${index + 1} 步上移`}>
                                            <ArrowUp size={16} aria-hidden="true" />
                                        </button>
                                        <button type="button" className="admin-story-icon-btn" onClick={() => move(index, 1)} disabled={index === rows.length - 1} aria-label={`第 ${index + 1} 步下移`}>
                                            <ArrowDown size={16} aria-hidden="true" />
                                        </button>
                                        <button type="button" className="admin-story-icon-btn" onClick={() => remove(index)} disabled={rows.length <= STORY_LIMITS.minSteps} aria-label={`刪除第 ${index + 1} 步`}>
                                            <Trash2 size={16} aria-hidden="true" />
                                        </button>
                                    </div>
                                )}
                            </div>
                            <div className="admin-story-row-grid">
                                <Form.Group controlId={`${id}-glyph`}>
                                    <Form.Label>大字</Form.Label>
                                    <Form.Control
                                        disabled={disabled}
                                        value={row.glyph}
                                        onChange={(ev) => patchRow(row.uid, { glyph: ev.target.value })}
                                        isInvalid={Boolean(re.glyph)}
                                        aria-invalid={Boolean(re.glyph)}
                                        aria-describedby={re.glyph ? `${id}-glyph-error` : undefined}
                                    />
                                    <Form.Control.Feedback type="invalid" id={`${id}-glyph-error`}>{re.glyph}</Form.Control.Feedback>
                                    <Form.Text>最多 {STORY_LIMITS.glyph} 字（{countChars(row.glyph.trim())}）</Form.Text>
                                </Form.Group>
                                <Form.Group controlId={`${id}-title`}>
                                    <Form.Label>標題</Form.Label>
                                    <Form.Control
                                        disabled={disabled}
                                        value={row.title}
                                        onChange={(ev) => patchRow(row.uid, { title: ev.target.value })}
                                        isInvalid={Boolean(re.title)}
                                        aria-invalid={Boolean(re.title)}
                                        aria-describedby={re.title ? `${id}-title-error` : undefined}
                                    />
                                    <Form.Control.Feedback type="invalid" id={`${id}-title-error`}>{re.title}</Form.Control.Feedback>
                                    <Form.Text>最多 {STORY_LIMITS.title} 字（{countChars(row.title.trim())}）</Form.Text>
                                </Form.Group>
                                <Form.Group controlId={`${id}-pattern`}>
                                    <Form.Label>左側織紋</Form.Label>
                                    <Form.Select disabled={disabled} value={row.pattern} onChange={(ev) => patchRow(row.uid, { pattern: ev.target.value })}>
                                        {STORY_PATTERNS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                                    </Form.Select>
                                </Form.Group>
                            </div>
                            <Form.Group controlId={`${id}-text`}>
                                <Form.Label>說明</Form.Label>
                                <Form.Control
                                    as="textarea"
                                    rows={2}
                                    disabled={disabled}
                                    value={row.text}
                                    onChange={(ev) => patchRow(row.uid, { text: ev.target.value })}
                                    isInvalid={Boolean(re.text)}
                                    aria-invalid={Boolean(re.text)}
                                    aria-describedby={re.text ? `${id}-text-error` : undefined}
                                />
                                <Form.Control.Feedback type="invalid" id={`${id}-text-error`}>{re.text}</Form.Control.Feedback>
                                <Form.Text>單行，最多 {STORY_LIMITS.text} 字（{countChars(row.text.trim())}）</Form.Text>
                            </Form.Group>
                        </li>
                    );
                })}
            </ol>

            {!disabled && (
                <div className="admin-story-toolbar">
                    <Button type="button" variant="outline-secondary" onClick={add} disabled={rows.length >= STORY_LIMITS.maxSteps}>
                        <Plus size={16} aria-hidden="true" /> 新增一步
                    </Button>
                    <Button type="button" variant="outline-secondary" onClick={reset}>
                        <RotateCcw size={16} aria-hidden="true" /> 還原預設文案
                    </Button>
                    <span className="admin-story-toolbar-hint">還原只會改表單，按「儲存設定」後才會公開。</span>
                </div>
            )}

            <div className="admin-story-preview-wrap">
                <h3 className="admin-story-preview-title">預覽（第 {Math.min(previewIndex, rows.length - 1) + 1} 步）</h3>
                <p className="admin-story-preview-hint">點選或編輯上面某一步，這裡就顯示那一步。首頁上是釘住畫面、隨捲動切換。</p>
                <Preview rows={rows} kicker={kicker} index={previewIndex} />
            </div>
        </section>
    );
}
