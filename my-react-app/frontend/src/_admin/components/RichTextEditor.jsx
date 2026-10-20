import { useEffect, useRef, useState } from 'react';
import { Button, Form, Spinner } from 'react-bootstrap';
import { EditorContent, useEditor } from '@tiptap/react';
import {
    AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Eye, Highlighter, ImagePlus, Info, Italic, Keyboard,
    Link2, List, ListChecks, ListOrdered, Maximize2, Minimize2, Minus, Palette, Pencil, Quote, Redo2,
    RemoveFormatting, Strikethrough, Subscript, Superscript, Table2, Underline as UnderlineIcon, Undo2, Video,
} from 'lucide-react';
import RichTextRenderer from '../../../components/_topic/RichTextRenderer';
import {
    CALLOUT_TONES, FONT_SIZES, HIGHLIGHT_COLORS, IMAGE_ALIGNS, IMAGE_SIZES, TEXT_ALIGNS, TEXT_COLORS,
    countDocText, parseYoutubeId, safeHref,
} from '../../../components/_topic/richText';
import { articleExtensions } from './articleExtensions';
import '../../../static/css/_topic/rich-palette.css';
import '../../../static/css/_admin/rich-text-editor.css';

const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify };

// 快捷鍵說明。Mac 請把 Ctrl 換成 ⌘。與 TipTap 內建與 articleExtensions 自訂的按鍵一致
const SHORTCUTS = [
    ['粗體', 'Ctrl + B'], ['斜體', 'Ctrl + I'], ['底線', 'Ctrl + U'], ['刪除線', 'Ctrl + Shift + S'],
    ['上標', 'Ctrl + .'], ['下標', 'Ctrl + ,'], ['連結', 'Ctrl + K'],
    ['復原', 'Ctrl + Z'], ['重做', 'Ctrl + Shift + Z'],
    ['內文', 'Ctrl + Alt + 0'], ['大標題', 'Ctrl + Alt + 2'], ['中標題', 'Ctrl + Alt + 3'], ['小標題', 'Ctrl + Alt + 4'],
    ['靠左對齊', 'Ctrl + Shift + L'], ['置中對齊', 'Ctrl + Shift + E'], ['靠右對齊', 'Ctrl + Shift + R'], ['左右對齊', 'Ctrl + Shift + J'],
    ['項目清單', 'Ctrl + Shift + 8'], ['編號清單', 'Ctrl + Shift + 7'], ['待辦清單', 'Ctrl + Shift + 9'], ['引用', 'Ctrl + Shift + B'],
    ['離開全螢幕或關閉面板', 'Esc'],
];
const shortcutOf = (name) => SHORTCUTS.find(([label]) => label === name)?.[1];

function ToolButton({ label, icon: Icon, text, shortcut, active, disabled, onClick }) {
    return (
        <button
            type="button"
            className={`rte-tool${text ? ' rte-tool--text' : ''}${active ? ' is-active' : ''}`}
            aria-label={label}
            title={shortcut ? `${label}（${shortcut}）` : label}
            aria-pressed={active ?? undefined}
            disabled={disabled}
            // 按下時不要讓編輯區失去焦點，選取的文字才不會消失
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClick}
        >
            <Icon size={18} aria-hidden="true" />
            {text && <span>{text}</span>}
        </button>
    );
}

// 一排互斥的選項按鈕（提示框種類、圖片對齊與大小…）
function Segmented({ label, options, value, onPick }) {
    return (
        <div className="rte-seg" role="group" aria-label={label}>
            <span className="rte-seg-label">{label}</span>
            {options.map((option) => (
                <button
                    key={option.key}
                    type="button"
                    className={`rte-seg-btn${value === option.key ? ' is-active' : ''}`}
                    aria-pressed={value === option.key}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onPick(option.key)}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}

function Swatches({ label, kind, options, current, onPick, onClear, clearLabel }) {
    return (
        <div className="rte-bar" role="group" aria-label={label}>
            {options.map((option) => (
                <button
                    key={option.key}
                    type="button"
                    className={`rte-swatch rte-swatch--${kind}-${option.key}`}
                    aria-label={option.label}
                    title={option.label}
                    aria-pressed={current === option.key}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onPick(option.key)}
                >
                    A
                </button>
            ))}
            <Button size="sm" variant="outline-secondary" onMouseDown={(event) => event.preventDefault()} onClick={onClear}>{clearLabel}</Button>
        </div>
    );
}

const preventBlur = (event) => event.preventDefault();

/**
 * 公開文章（專題、隱私與資料、聯絡我們）的富文字編輯器，所見即所得，功能對照 Word／Google 文件常用的那一批：
 * 段落樣式、字級、粗斜底線刪除線、上下標、文字色與螢光筆、對齊、三種清單、引用、重點提示框、分隔線、
 * 連結、圖片（含對齊與大小）、YouTube 影片、表格、清除格式、預覽、全螢幕、字數、快捷鍵。
 *
 * 輸出是 TipTap 文件 JSON，不是 HTML：後端只收白名單內的節點與固定選項，前台逐節點渲染（見 articleExtensions.js）。
 * 內容只在掛載時載入，要換內容請改 key 重新掛載。
 *
 * @param {object}   props.value        初始文件（TipTap JSON，可為空物件）
 * @param {function} props.onChange     (doc) => void，內容每次變動時呼叫
 * @param {boolean}  props.disabled     唯讀
 * @param {object}   props.media        useMediaUpload 的回傳值，圖片上傳走同一套（5 MB 上限、離開時中止）
 */
export default function RichTextEditor({ value, onChange, disabled = false, media, labelledBy, describedBy }) {
    const fileInputRef = useRef(null);
    const toolbarRef = useRef(null);
    const openLinkRef = useRef(() => {});
    const [panel, setPanel] = useState(null); // null | link | color | highlight | callout | youtube | shortcuts
    const [linkValue, setLinkValue] = useState('');
    const [youtubeValue, setYoutubeValue] = useState('');
    const [panelError, setPanelError] = useState('');
    const [previewing, setPreviewing] = useState(false);
    const [fullscreen, setFullscreen] = useState(false);
    const [, forceRender] = useState(0);
    const uploading = media?.uploadingKey === 'article-image';

    const editor = useEditor({
        extensions: articleExtensions,
        content: value && value.type === 'doc' ? value : '<p></p>',
        editable: !disabled,
        editorProps: {
            attributes: {
                class: 'rte-content',
                role: 'textbox',
                'aria-multiline': 'true',
                ...(labelledBy ? { 'aria-labelledby': labelledBy } : {}),
                ...(describedBy ? { 'aria-describedby': describedBy } : {}),
            },
            handleKeyDown: (_view, event) => {
                if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k') {
                    event.preventDefault();
                    openLinkRef.current();
                    return true;
                }
                return false;
            },
        },
        onUpdate: ({ editor: current }) => onChange?.(current.getJSON()),
        // 游標移動也要更新工具列的「目前套用」狀態
        onSelectionUpdate: () => forceRender((n) => n + 1),
        onTransaction: () => forceRender((n) => n + 1),
    });

    useEffect(() => {
        editor?.setEditable(!disabled && !previewing);
    }, [editor, disabled, previewing]);

    // Ctrl／⌘ + K 開連結面板（編輯區的按鍵處理在 useEditor 建立時就固定了，所以經由 ref 呼叫最新的函式）
    useEffect(() => {
        openLinkRef.current = () => {
            if (!editor) return;
            setLinkValue(editor.getAttributes('link').href ?? '');
            setPanelError('');
            setPanel('link');
        };
    }, [editor]);

    // 全螢幕時鎖住背後頁面的捲動，離開（或元件卸載）時還原
    useEffect(() => {
        if (!fullscreen) return undefined;
        const previous = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = previous; };
    }, [fullscreen]);

    if (!editor) return null;

    const chain = () => editor.chain().focus();
    const closePanel = () => { setPanel(null); setPanelError(''); };
    const togglePanel = (name) => {
        setPanelError('');
        setPanel((current) => (current === name ? null : name));
    };

    const openLink = () => {
        setLinkValue(editor.getAttributes('link').href ?? '');
        setPanelError('');
        setPanel('link');
    };
    const applyLink = () => {
        const url = linkValue.trim();
        if (!url) {
            chain().extendMarkRange('link').unsetLink().run();
            closePanel();
            return;
        }
        if (!safeHref(url)) {
            setPanelError('網址請填站內路徑（以 / 開頭）、https:// 開頭的網址，或 mailto:信箱（可加 ?subject=主旨）');
            return;
        }
        if (editor.state.selection.empty && !editor.isActive('link')) {
            setPanelError('請先選取要加上連結的文字');
            return;
        }
        chain().extendMarkRange('link').setLink({ href: url }).run();
        closePanel();
    };
    const applyYoutube = () => {
        const id = parseYoutubeId(youtubeValue);
        if (!id) {
            setPanelError('請貼上 YouTube 影片網址，例如 https://www.youtube.com/watch?v=… 或 https://youtu.be/…');
            return;
        }
        chain().setYoutube({ videoId: id, title: null }).run();
        setYoutubeValue('');
        closePanel();
    };
    const pickImage = (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        media?.upload(file, 'article-image', {
            onUploaded: (url) => chain().setImage({ src: url, alt: '', title: '' }).run(),
        });
    };
    // role="toolbar" 的慣例：左右鍵在按鈕間移動、Home／End 到頭尾（Tab 仍然是逐一經過，不會漏掉任何按鈕）
    const onToolbarKeyDown = (event) => {
        const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
        if (!keys.includes(event.key)) return;
        const buttons = [...toolbarRef.current.querySelectorAll('button:not(:disabled)')];
        const index = buttons.indexOf(document.activeElement);
        if (index < 0) return;
        event.preventDefault();
        const next = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: buttons.length - 1 }[event.key];
        buttons[(next + buttons.length) % buttons.length]?.focus();
    };
    const onRootKeyDown = (event) => {
        if (event.key !== 'Escape') return;
        if (panel) { closePanel(); event.stopPropagation(); return; }
        if (fullscreen) { setFullscreen(false); event.stopPropagation(); }
    };

    const heading = [2, 3, 4].find((level) => editor.isActive('heading', { level }));
    const paragraphStyle = heading ? `h${heading}` : 'p';
    const setParagraphStyle = (style) => {
        if (style === 'p') chain().setParagraph().run();
        else chain().setHeading({ level: Number(style.slice(1)) }).run();
    };
    const fontSize = editor.getAttributes('fontSize').size ?? '';
    const setFontSize = (size) => (size ? chain().setFontSize(size).run() : chain().unsetFontSize().run());
    const currentAlign = editor.getAttributes('paragraph').textAlign ?? editor.getAttributes('heading').textAlign ?? 'left';
    const textColor = editor.getAttributes('textColor').color ?? null;
    const highlightColor = editor.getAttributes('highlight').color ?? null;
    const calloutTone = editor.isActive('callout') ? editor.getAttributes('callout').tone : null;

    const imageActive = editor.isActive('image');
    const image = imageActive ? editor.getAttributes('image') : null;
    const setImageAttr = (name, text) => chain().updateAttributes('image', { [name]: text }).run();
    const videoActive = editor.isActive('youtube');
    const video = videoActive ? editor.getAttributes('youtube') : null;
    const inTable = editor.isActive('table');

    const canEdit = !disabled && !previewing;
    const chars = countDocText(editor.getJSON());

    return (
        <div
            className={`rte${disabled ? ' is-disabled' : ''}${fullscreen ? ' is-fullscreen' : ''}${previewing ? ' is-previewing' : ''}`}
            onKeyDown={onRootKeyDown}
        >
            {!disabled && (
                <div ref={toolbarRef} className="rte-toolbar" role="toolbar" aria-label="文章格式工具列" onKeyDown={onToolbarKeyDown}>
                    {!previewing && (
                        <>
                            <div className="rte-group" role="group" aria-label="復原與重做">
                                <ToolButton label="復原" icon={Undo2} shortcut={shortcutOf('復原')} disabled={!editor.can().undo()} onClick={() => chain().undo().run()} />
                                <ToolButton label="重做" icon={Redo2} shortcut={shortcutOf('重做')} disabled={!editor.can().redo()} onClick={() => chain().redo().run()} />
                            </div>
                            <div className="rte-group" role="group" aria-label="段落與字級">
                                <Form.Select size="sm" className="rte-select" aria-label="段落樣式" value={paragraphStyle} onChange={(e) => setParagraphStyle(e.target.value)}>
                                    <option value="p">內文</option>
                                    <option value="h2">大標題</option>
                                    <option value="h3">中標題</option>
                                    <option value="h4">小標題</option>
                                </Form.Select>
                                <Form.Select size="sm" className="rte-select rte-select--size" aria-label="字級" value={fontSize} onChange={(e) => setFontSize(e.target.value)}>
                                    {FONT_SIZES.map((size) => <option key={size.key} value={size.key}>{size.label}</option>)}
                                </Form.Select>
                            </div>
                            <div className="rte-group" role="group" aria-label="文字樣式">
                                <ToolButton label="粗體" icon={Bold} shortcut={shortcutOf('粗體')} active={editor.isActive('bold')} onClick={() => chain().toggleBold().run()} />
                                <ToolButton label="斜體" icon={Italic} shortcut={shortcutOf('斜體')} active={editor.isActive('italic')} onClick={() => chain().toggleItalic().run()} />
                                <ToolButton label="底線" icon={UnderlineIcon} shortcut={shortcutOf('底線')} active={editor.isActive('underline')} onClick={() => chain().toggleUnderline().run()} />
                                <ToolButton label="刪除線" icon={Strikethrough} shortcut={shortcutOf('刪除線')} active={editor.isActive('strike')} onClick={() => chain().toggleStrike().run()} />
                                <ToolButton label="上標" icon={Superscript} shortcut={shortcutOf('上標')} active={editor.isActive('superscript')} onClick={() => chain().toggleSuperscript().run()} />
                                <ToolButton label="下標" icon={Subscript} shortcut={shortcutOf('下標')} active={editor.isActive('subscript')} onClick={() => chain().toggleSubscript().run()} />
                            </div>
                            <div className="rte-group" role="group" aria-label="顏色與清除格式">
                                <ToolButton label="文字顏色" icon={Palette} active={panel === 'color' || Boolean(textColor)} onClick={() => togglePanel('color')} />
                                <ToolButton label="螢光筆" icon={Highlighter} active={panel === 'highlight' || Boolean(highlightColor)} onClick={() => togglePanel('highlight')} />
                                <ToolButton label="清除格式" icon={RemoveFormatting} onClick={() => chain().unsetAllMarks().clearNodes().setTextAlign('left').run()} />
                            </div>
                            <div className="rte-group" role="group" aria-label="對齊">
                                {TEXT_ALIGNS.map((align) => (
                                    <ToolButton
                                        key={align.key}
                                        label={align.label}
                                        icon={ALIGN_ICONS[align.key]}
                                        shortcut={shortcutOf(align.label)}
                                        active={currentAlign === align.key}
                                        onClick={() => chain().setTextAlign(align.key).run()}
                                    />
                                ))}
                            </div>
                            <div className="rte-group" role="group" aria-label="清單與區塊">
                                <ToolButton label="項目清單" icon={List} shortcut={shortcutOf('項目清單')} active={editor.isActive('bulletList')} onClick={() => chain().toggleBulletList().run()} />
                                <ToolButton label="編號清單" icon={ListOrdered} shortcut={shortcutOf('編號清單')} active={editor.isActive('orderedList')} onClick={() => chain().toggleOrderedList().run()} />
                                <ToolButton label="待辦清單" icon={ListChecks} shortcut={shortcutOf('待辦清單')} active={editor.isActive('taskList')} onClick={() => chain().toggleTaskList().run()} />
                                <ToolButton label="引用" icon={Quote} shortcut={shortcutOf('引用')} active={editor.isActive('blockquote')} onClick={() => chain().toggleBlockquote().run()} />
                                <ToolButton label="重點提示框" icon={Info} text="提示框" active={panel === 'callout' || editor.isActive('callout')} onClick={() => togglePanel('callout')} />
                                <ToolButton label="分隔線" icon={Minus} onClick={() => chain().setHorizontalRule().run()} />
                            </div>
                            <div className="rte-group" role="group" aria-label="插入">
                                <ToolButton label="連結" icon={Link2} text="連結" shortcut={shortcutOf('連結')} active={editor.isActive('link') || panel === 'link'} onClick={() => (panel === 'link' ? closePanel() : openLink())} />
                                <ToolButton label="插入圖片" icon={ImagePlus} text="圖片" disabled={uploading} onClick={() => fileInputRef.current?.click()} />
                                <ToolButton label="插入影片" icon={Video} text="影片" active={panel === 'youtube'} onClick={() => togglePanel('youtube')} />
                                <ToolButton label="插入表格" icon={Table2} text="表格" disabled={inTable} onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
                                <input ref={fileInputRef} type="file" accept="image/*" className="rte-file" tabIndex={-1} aria-hidden="true" onChange={pickImage} />
                            </div>
                        </>
                    )}
                    <div className="rte-group rte-group--end" role="group" aria-label="檢視">
                        <ToolButton label={previewing ? '回到編輯' : '預覽'} icon={previewing ? Pencil : Eye} text={previewing ? '回到編輯' : '預覽'} active={previewing} onClick={() => { closePanel(); setPreviewing((on) => !on); }} />
                        <ToolButton label={fullscreen ? '離開全螢幕' : '全螢幕'} icon={fullscreen ? Minimize2 : Maximize2} text={fullscreen ? '離開全螢幕' : '全螢幕'} active={fullscreen} onClick={() => setFullscreen((on) => !on)} />
                        {!previewing && <ToolButton label="快捷鍵說明" icon={Keyboard} active={panel === 'shortcuts'} onClick={() => togglePanel('shortcuts')} />}
                    </div>
                </div>
            )}

            {previewing && <p className="rte-notice" role="status">預覽中：這是排版後的樣子，不能編輯。按「回到編輯」繼續寫。</p>}

            {canEdit && panel === 'link' && (
                <div className="rte-bar" role="group" aria-label="設定連結">
                    <Form.Control
                        size="sm" value={linkValue} placeholder="/quiz/select、https://example.com 或 mailto:help@example.org" aria-label="連結網址"
                        isInvalid={Boolean(panelError)} autoFocus
                        onChange={(event) => { setLinkValue(event.target.value); setPanelError(''); }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') { event.preventDefault(); applyLink(); }
                        }}
                    />
                    <Button size="sm" variant="primary" onClick={applyLink}>套用</Button>
                    {editor.isActive('link') && (
                        <Button size="sm" variant="outline-secondary" onClick={() => { chain().extendMarkRange('link').unsetLink().run(); closePanel(); }}>移除連結</Button>
                    )}
                    <Button size="sm" variant="outline-secondary" onClick={closePanel}>取消</Button>
                    {panelError && <p className="rte-error" role="alert">{panelError}</p>}
                </div>
            )}

            {canEdit && panel === 'youtube' && (
                <div className="rte-bar" role="group" aria-label="插入 YouTube 影片">
                    <Form.Control
                        size="sm" value={youtubeValue} placeholder="貼上 YouTube 影片網址" aria-label="YouTube 影片網址"
                        isInvalid={Boolean(panelError)} autoFocus
                        onChange={(event) => { setYoutubeValue(event.target.value); setPanelError(''); }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') { event.preventDefault(); applyYoutube(); }
                        }}
                    />
                    <Button size="sm" variant="primary" onClick={applyYoutube}>插入影片</Button>
                    <Button size="sm" variant="outline-secondary" onClick={closePanel}>取消</Button>
                    {panelError && <p className="rte-error" role="alert">{panelError}</p>}
                </div>
            )}

            {canEdit && panel === 'color' && (
                <Swatches
                    label="文字顏色" kind="text" options={TEXT_COLORS} current={textColor} clearLabel="預設顏色"
                    onPick={(color) => { chain().setTextColor(color).run(); closePanel(); }}
                    onClear={() => { chain().unsetTextColor().run(); closePanel(); }}
                />
            )}
            {canEdit && panel === 'highlight' && (
                <Swatches
                    label="螢光筆" kind="highlight" options={HIGHLIGHT_COLORS} current={highlightColor} clearLabel="移除螢光筆"
                    onPick={(color) => { chain().setHighlight(color).run(); closePanel(); }}
                    onClear={() => { chain().unsetHighlight().run(); closePanel(); }}
                />
            )}

            {canEdit && panel === 'callout' && (
                <div className="rte-bar" role="group" aria-label="重點提示框">
                    <Segmented
                        label="提示框種類" options={CALLOUT_TONES} value={calloutTone}
                        onPick={(tone) => { (calloutTone ? chain().setCalloutTone(tone) : chain().setCallout(tone)).run(); closePanel(); }}
                    />
                    {calloutTone && (
                        <Button size="sm" variant="outline-secondary" onMouseDown={preventBlur} onClick={() => { chain().unsetCallout().run(); closePanel(); }}>取消提示框</Button>
                    )}
                </div>
            )}

            {canEdit && panel === 'shortcuts' && (
                <div className="rte-bar rte-bar--block" role="group" aria-label="快捷鍵說明">
                    <p className="rte-hint">Mac 請把 Ctrl 換成 ⌘。</p>
                    <dl className="rte-shortcuts">
                        {SHORTCUTS.map(([name, keys]) => (
                            <div key={name}><dt>{name}</dt><dd><kbd>{keys}</kbd></dd></div>
                        ))}
                    </dl>
                </div>
            )}

            {canEdit && imageActive && (
                <div className="rte-bar" role="group" aria-label="圖片設定">
                    <Form.Control size="sm" value={image.title ?? ''} maxLength={120} aria-label="圖說（顯示在圖片下方）" placeholder="圖說（顯示在圖片下方）"
                        onChange={(event) => setImageAttr('title', event.target.value)} />
                    <Form.Control size="sm" value={image.alt ?? ''} maxLength={200} aria-label="替代文字（給看不到圖片的人）" placeholder="替代文字（給看不到圖片的人）"
                        onChange={(event) => setImageAttr('alt', event.target.value)} />
                    <Segmented label="圖片對齊" options={IMAGE_ALIGNS} value={image.align ?? 'left'} onPick={(key) => setImageAttr('align', key === 'left' ? null : key)} />
                    <Segmented label="圖片大小" options={IMAGE_SIZES} value={image.size ?? 'full'} onPick={(key) => setImageAttr('size', key === 'full' ? null : key)} />
                    <Button size="sm" variant="outline-danger" onClick={() => chain().deleteSelection().run()}>刪除圖片</Button>
                </div>
            )}

            {canEdit && videoActive && (
                <div className="rte-bar" role="group" aria-label="影片設定">
                    <Form.Control size="sm" value={video.title ?? ''} maxLength={120} aria-label="影片說明（顯示在影片下方）" placeholder="影片說明（顯示在影片下方）"
                        onChange={(event) => chain().setYoutubeTitle(event.target.value || null).run()} />
                    <Button size="sm" variant="outline-danger" onClick={() => chain().deleteSelection().run()}>刪除影片</Button>
                </div>
            )}

            {canEdit && inTable && (
                <div className="rte-bar" role="group" aria-label="表格設定">
                    <Button size="sm" variant="outline-secondary" onMouseDown={preventBlur} onClick={() => chain().addRowBefore().run()}>上方加列</Button>
                    <Button size="sm" variant="outline-secondary" onMouseDown={preventBlur} onClick={() => chain().addRowAfter().run()}>下方加列</Button>
                    <Button size="sm" variant="outline-secondary" onMouseDown={preventBlur} onClick={() => chain().deleteRow().run()}>刪除列</Button>
                    <Button size="sm" variant="outline-secondary" onMouseDown={preventBlur} onClick={() => chain().addColumnBefore().run()}>左側加欄</Button>
                    <Button size="sm" variant="outline-secondary" onMouseDown={preventBlur} onClick={() => chain().addColumnAfter().run()}>右側加欄</Button>
                    <Button size="sm" variant="outline-secondary" onMouseDown={preventBlur} onClick={() => chain().deleteColumn().run()}>刪除欄</Button>
                    <Button size="sm" variant="outline-secondary" onMouseDown={preventBlur} onClick={() => chain().toggleHeaderRow().run()}>標題列開關</Button>
                    <Button size="sm" variant="outline-secondary" onMouseDown={preventBlur} onClick={() => chain().mergeOrSplit().run()}>合併／拆分儲存格</Button>
                    <Button size="sm" variant="outline-danger" onMouseDown={preventBlur} onClick={() => chain().deleteTable().run()}>刪除表格</Button>
                </div>
            )}

            {uploading && <p className="rte-busy" role="status"><Spinner size="sm" /> 圖片上傳中…</p>}
            {media?.error && !uploading && <p className="rte-error" role="alert">{media.error}</p>}

            {/* 預覽用前台同一個渲染器，看到的就是讀者會看到的；編輯器保持掛載，回到編輯時游標與復原紀錄都還在 */}
            {previewing && (
                <div className="rte-preview" aria-label="排版預覽">
                    <RichTextRenderer doc={editor.getJSON()} />
                </div>
            )}
            <div hidden={previewing}>
                <EditorContent editor={editor} />
            </div>

            <div className="rte-status">字數 {chars}</div>
        </div>
    );
}
