import { Link } from "react-router-dom";
import {
    CALLOUT_TONES, FONT_SIZES, HIGHLIGHT_COLORS, IMAGE_ALIGNS, IMAGE_SIZES, TEXT_ALIGNS, TEXT_COLORS,
    pick, safeHref, safeImageSrc,
} from "./richText";
import "../../static/css/_topic/rich-palette.css";
import "../../static/css/_topic/rich-text.css";

/**
 * 把文章文件（TipTap／ProseMirror JSON）逐節點渲染成 React 元素。
 * 只認白名單內的節點與樣式（與後端 article_doc.py 一致），不認得的節點整個略過；
 * 顏色、字級、對齊等選項只認固定清單，不認得的值一律當作沒設定，文件裡不會有任何 CSS。
 * 文字一律是 React 文字節點，網址只放行站內路徑、https、單純的 mailto 與 Cloudinary 圖片，
 * 影片只用 11 碼代號組出 youtube-nocookie 的網址。整條路徑沒有任何 HTML 字串。
 */

const MARK_TAGS = { bold: "strong", italic: "em", underline: "u", strike: "s", subscript: "sub", superscript: "sup" };
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

const alignClass = (value) => {
    const align = pick(TEXT_ALIGNS, value);
    return align && align !== "left" ? `rt-align-${align}` : undefined;
};

function renderMark(mark, element, key) {
    const type = mark?.type;
    if (type === "link") {
        const link = safeHref(mark.attrs?.href);
        if (!link) return element;
        if (link.mail) return <a key={key} href={link.href}>{element}</a>;
        return link.external ? (
            <a key={key} href={link.href} target="_blank" rel="noopener noreferrer">
                {element}
                <span className="visually-hidden">（另開新視窗）</span>
            </a>
        ) : (
            <Link key={key} to={link.href}>{element}</Link>
        );
    }
    if (type === "textColor") {
        const color = pick(TEXT_COLORS, mark.attrs?.color);
        return color ? <span key={key} className={`rt-color-${color}`}>{element}</span> : element;
    }
    if (type === "highlight") {
        const color = pick(HIGHLIGHT_COLORS, mark.attrs?.color);
        return color ? <mark key={key} className={`rt-mark rt-mark-${color}`}>{element}</mark> : element;
    }
    if (type === "fontSize") {
        const size = pick(FONT_SIZES, mark.attrs?.size);
        return size ? <span key={key} className={`rt-size-${size}`}>{element}</span> : element;
    }
    const Tag = MARK_TAGS[type];
    if (!Tag) return element;
    const tagClass = type === "subscript" ? "rt-sub" : type === "superscript" ? "rt-sup" : undefined;
    return <Tag key={key} className={tagClass}>{element}</Tag>;
}

function renderText(node, key) {
    let element = node.text ?? "";
    (Array.isArray(node.marks) ? node.marks : []).forEach((mark) => {
        element = renderMark(mark, element, key);
    });
    return element;
}

function renderChildren(node) {
    return (Array.isArray(node.content) ? node.content : []).map((child, index) => renderNode(child, index));
}

function renderTableCell(node, key, Tag) {
    const colSpan = Number.isInteger(node.attrs?.colspan) && node.attrs.colspan > 1 ? Math.min(node.attrs.colspan, 12) : undefined;
    const rowSpan = Number.isInteger(node.attrs?.rowspan) && node.attrs.rowspan > 1 ? Math.min(node.attrs.rowspan, 12) : undefined;
    return <Tag key={key} colSpan={colSpan} rowSpan={rowSpan}>{renderChildren(node)}</Tag>;
}

function renderNode(node, key) {
    if (!node || typeof node !== "object") return null;
    switch (node.type) {
    case "text":
        return renderText(node, key);
    case "hardBreak":
        return <br key={key} />;
    case "paragraph":
        return <p key={key} className={alignClass(node.attrs?.textAlign)}>{renderChildren(node)}</p>;
    case "heading": {
        const level = [3, 4].includes(node.attrs?.level) ? node.attrs.level : 2;
        const Tag = `h${level}`;
        return <Tag key={key} className={alignClass(node.attrs?.textAlign)}>{renderChildren(node)}</Tag>;
    }
    case "bulletList":
        return <ul key={key}>{renderChildren(node)}</ul>;
    case "orderedList": {
        const start = Number.isInteger(node.attrs?.start) ? node.attrs.start : undefined;
        return <ol key={key} start={start}>{renderChildren(node)}</ol>;
    }
    case "listItem":
        return <li key={key}>{renderChildren(node)}</li>;
    case "taskList":
        return <ul key={key} className="rt-tasks">{renderChildren(node)}</ul>;
    case "taskItem": {
        const checked = node.attrs?.checked === true;
        return (
            <li key={key} className="rt-task">
                <input type="checkbox" checked={checked} disabled readOnly aria-label={checked ? "已完成" : "未完成"} />
                <div className="rt-task-body">{renderChildren(node)}</div>
            </li>
        );
    }
    case "blockquote":
        return <blockquote key={key}>{renderChildren(node)}</blockquote>;
    case "callout": {
        const tone = pick(CALLOUT_TONES, node.attrs?.tone) ?? "info";
        return <aside key={key} className={`rt-callout rt-callout--${tone}`}>{renderChildren(node)}</aside>;
    }
    case "table": {
        const rows = (Array.isArray(node.content) ? node.content : []).filter((row) => row?.type === "tableRow");
        return (
            <div key={key} className="rt-table-wrap" role="region" aria-label="表格" tabIndex={0}>
                <table className="rt-table">
                    <tbody>
                        {rows.map((row, rowIndex) => (
                            <tr key={rowIndex}>
                                {(Array.isArray(row.content) ? row.content : []).map((cell, cellIndex) => {
                                    if (cell?.type === "tableHeader") return renderTableCell(cell, cellIndex, "th");
                                    if (cell?.type === "tableCell") return renderTableCell(cell, cellIndex, "td");
                                    return null;
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }
    case "horizontalRule":
        return <hr key={key} />;
    case "youtube": {
        const id = node.attrs?.videoId;
        if (typeof id !== "string" || !YOUTUBE_ID.test(id)) return null;
        const title = typeof node.attrs?.title === "string" ? node.attrs.title.trim() : "";
        return (
            <figure key={key} className="rt-video">
                <div className="rt-video-frame">
                    <iframe
                        src={`https://www.youtube-nocookie.com/embed/${id}`}
                        title={title || "YouTube 影片"}
                        loading="lazy"
                        allow="encrypted-media; picture-in-picture; fullscreen"
                        allowFullScreen
                        referrerPolicy="strict-origin-when-cross-origin"
                    />
                </div>
                {title && <figcaption>{title}</figcaption>}
            </figure>
        );
    }
    case "image": {
        const src = safeImageSrc(node.attrs?.src);
        if (!src) return null;
        const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
        const caption = typeof node.attrs?.title === "string" ? node.attrs.title.trim() : "";
        const size = pick(IMAGE_SIZES, node.attrs?.size);
        const align = pick(IMAGE_ALIGNS, node.attrs?.align);
        const className = ["rt-figure", size && size !== "full" ? `rt-figure--${size}` : "", align ? `rt-figure--${align}` : ""]
            .filter(Boolean).join(" ");
        return (
            <figure key={key} className={className}>
                <img src={src} alt={alt} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                {caption && <figcaption>{caption}</figcaption>}
            </figure>
        );
    }
    default:
        return null;
    }
}

const RichTextRenderer = ({ doc }) => {
    if (!doc || typeof doc !== "object" || doc.type !== "doc") return null;
    return <>{renderChildren(doc)}</>;
};

export default RichTextRenderer;
