import { useEffect, useRef, useState } from 'react';
import { Button, Form, Spinner } from 'react-bootstrap';
import { EditorContent, useEditor } from '@tiptap/react';
import {
    Bold, Heading2, Heading3, ImagePlus, Italic, Link2, List, ListOrdered, Minus, Quote, Redo2,
    Strikethrough, Underline as UnderlineIcon, Undo2,
} from 'lucide-react';
import { safeHref } from '../../../components/_topic/richText';
import { articleExtensions } from './articleExtensions';
import '../../../static/css/_admin/rich-text-editor.css';

function ToolButton({ label, icon: Icon, active, disabled, onClick }) {
    return (
        <button
            type="button"
            className={`rte-tool${active ? ' is-active' : ''}`}
            aria-label={label}
            title={label}
            aria-pressed={active ?? undefined}
            disabled={disabled}
            // 按下時不要讓編輯區失去焦點，選取的文字才不會消失
            onMouseDown={(event) => event.preventDefault()}
            onClick={onClick}
        >
            <Icon size={18} aria-hidden="true" />
        </button>
    );
}

/**
 * 專題文章的富文字編輯器（像 Word 的所見即所得）。輸出是 TipTap 文件 JSON，不是 HTML：
 * 後端只收白名單內的節點，前台逐節點渲染。內容只在掛載時載入，要換內容請改 key 重新掛載。
 *
 * @param {object}   props.value        初始文件（TipTap JSON，可為空物件）
 * @param {function} props.onChange     (doc) => void，內容每次變動時呼叫
 * @param {boolean}  props.disabled     唯讀
 * @param {object}   props.media        useMediaUpload 的回傳值，圖片上傳走同一套（5 MB 上限、離開時中止）
 */
export default function RichTextEditor({ value, onChange, disabled = false, media, labelledBy, describedBy }) {
    const fileInputRef = useRef(null);
    const toolbarRef = useRef(null);
    const [linkOpen, setLinkOpen] = useState(false);
    const [linkValue, setLinkValue] = useState('');
    const [linkError, setLinkError] = useState('');
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
        },
        onUpdate: ({ editor: current }) => onChange?.(current.getJSON()),
        // 游標移動也要更新工具列的「目前套用」狀態
        onSelectionUpdate: () => forceRender((n) => n + 1),
        onTransaction: () => forceRender((n) => n + 1),
    });

    useEffect(() => {
        editor?.setEditable(!disabled);
    }, [editor, disabled]);

    if (!editor) return null;

    const chain = () => editor.chain().focus();
    const openLink = () => {
        setLinkValue(editor.getAttributes('link').href ?? '');
        setLinkError('');
        setLinkOpen(true);
    };
    const applyLink = () => {
        const url = linkValue.trim();
        if (!url) {
            chain().extendMarkRange('link').unsetLink().run();
            setLinkOpen(false);
            return;
        }
        if (!safeHref(url)) {
            setLinkError('網址請填站內路徑（以 / 開頭）、https:// 開頭的網址，或 mailto:信箱');
            return;
        }
        if (editor.state.selection.empty && !editor.isActive('link')) {
            setLinkError('請先選取要加上連結的文字');
            return;
        }
        chain().extendMarkRange('link').setLink({ href: url }).run();
        setLinkOpen(false);
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
    const imageActive = editor.isActive('image');
    const image = imageActive ? editor.getAttributes('image') : null;
    const setImageAttr = (name, text) => chain().updateAttributes('image', { [name]: text }).run();

    return (
        <div className={`rte${disabled ? ' is-disabled' : ''}`}>
            {!disabled && (
                <div ref={toolbarRef} className="rte-toolbar" role="toolbar" aria-label="文章格式工具列" onKeyDown={onToolbarKeyDown}>
                    <div className="rte-group">
                        <ToolButton label="復原" icon={Undo2} disabled={!editor.can().undo()} onClick={() => chain().undo().run()} />
                        <ToolButton label="重做" icon={Redo2} disabled={!editor.can().redo()} onClick={() => chain().redo().run()} />
                    </div>
                    <div className="rte-group">
                        <ToolButton label="大標題" icon={Heading2} active={editor.isActive('heading', { level: 2 })} onClick={() => chain().toggleHeading({ level: 2 }).run()} />
                        <ToolButton label="小標題" icon={Heading3} active={editor.isActive('heading', { level: 3 })} onClick={() => chain().toggleHeading({ level: 3 }).run()} />
                    </div>
                    <div className="rte-group">
                        <ToolButton label="粗體" icon={Bold} active={editor.isActive('bold')} onClick={() => chain().toggleBold().run()} />
                        <ToolButton label="斜體" icon={Italic} active={editor.isActive('italic')} onClick={() => chain().toggleItalic().run()} />
                        <ToolButton label="底線" icon={UnderlineIcon} active={editor.isActive('underline')} onClick={() => chain().toggleUnderline().run()} />
                        <ToolButton label="刪除線" icon={Strikethrough} active={editor.isActive('strike')} onClick={() => chain().toggleStrike().run()} />
                    </div>
                    <div className="rte-group">
                        <ToolButton label="項目清單" icon={List} active={editor.isActive('bulletList')} onClick={() => chain().toggleBulletList().run()} />
                        <ToolButton label="編號清單" icon={ListOrdered} active={editor.isActive('orderedList')} onClick={() => chain().toggleOrderedList().run()} />
                        <ToolButton label="引用" icon={Quote} active={editor.isActive('blockquote')} onClick={() => chain().toggleBlockquote().run()} />
                        <ToolButton label="分隔線" icon={Minus} onClick={() => chain().setHorizontalRule().run()} />
                    </div>
                    <div className="rte-group">
                        <ToolButton label="連結" icon={Link2} active={editor.isActive('link')} onClick={openLink} />
                        <ToolButton label="插入圖片" icon={ImagePlus} disabled={uploading} onClick={() => fileInputRef.current?.click()} />
                        <input ref={fileInputRef} type="file" accept="image/*" className="rte-file" tabIndex={-1} aria-hidden="true" onChange={pickImage} />
                    </div>
                </div>
            )}

            {linkOpen && !disabled && (
                <div className="rte-bar" role="group" aria-label="設定連結">
                    <Form.Control
                        size="sm" value={linkValue} placeholder="/quiz/select 或 https://example.com" aria-label="連結網址"
                        isInvalid={Boolean(linkError)} autoFocus
                        onChange={(event) => { setLinkValue(event.target.value); setLinkError(''); }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') { event.preventDefault(); applyLink(); }
                            if (event.key === 'Escape') setLinkOpen(false);
                        }}
                    />
                    <Button size="sm" variant="primary" onClick={applyLink}>套用</Button>
                    {editor.isActive('link') && (
                        <Button size="sm" variant="outline-secondary" onClick={() => { chain().extendMarkRange('link').unsetLink().run(); setLinkOpen(false); }}>移除連結</Button>
                    )}
                    <Button size="sm" variant="outline-secondary" onClick={() => setLinkOpen(false)}>取消</Button>
                    {linkError && <p className="rte-error" role="alert">{linkError}</p>}
                </div>
            )}

            {imageActive && !disabled && (
                <div className="rte-bar" role="group" aria-label="圖片設定">
                    <Form.Control size="sm" value={image.title ?? ''} maxLength={120} aria-label="圖說（顯示在圖片下方）" placeholder="圖說（顯示在圖片下方）"
                        onChange={(event) => setImageAttr('title', event.target.value)} />
                    <Form.Control size="sm" value={image.alt ?? ''} maxLength={200} aria-label="替代文字（給看不到圖片的人）" placeholder="替代文字（給看不到圖片的人）"
                        onChange={(event) => setImageAttr('alt', event.target.value)} />
                    <Button size="sm" variant="outline-danger" onClick={() => chain().deleteSelection().run()}>刪除圖片</Button>
                </div>
            )}

            {uploading && <p className="rte-busy" role="status"><Spinner size="sm" /> 圖片上傳中…</p>}
            {media?.error && !uploading && <p className="rte-error" role="alert">{media.error}</p>}

            <EditorContent editor={editor} />
        </div>
    );
}
