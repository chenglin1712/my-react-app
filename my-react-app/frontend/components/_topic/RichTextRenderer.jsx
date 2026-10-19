import { Link } from "react-router-dom";
import { safeHref, safeImageSrc } from "./richText";

/**
 * 把專題文章的文件（TipTap JSON）逐節點渲染成 React 元素。
 * 只認白名單內的節點與樣式（與後端 article_doc.py 一致），不認得的節點整個略過；
 * 文字一律是 React 文字節點，網址只放行站內路徑、https 與 Cloudinary 圖片。整條路徑沒有任何 HTML 字串。
 */

const MARK_TAGS = { bold: "strong", italic: "em", underline: "u", strike: "s" };

function renderText(node, key) {
    let element = node.text ?? "";
    (Array.isArray(node.marks) ? node.marks : []).forEach((mark) => {
        if (mark?.type === "link") {
            const link = safeHref(mark.attrs?.href);
            if (!link) return;
            if (link.mail) {
                element = <a key={key} href={link.href}>{element}</a>;
                return;
            }
            element = link.external ? (
                <a key={key} href={link.href} target="_blank" rel="noopener noreferrer">
                    {element}
                    <span className="visually-hidden">（另開新視窗）</span>
                </a>
            ) : (
                <Link key={key} to={link.href}>{element}</Link>
            );
            return;
        }
        const Tag = MARK_TAGS[mark?.type];
        if (Tag) element = <Tag key={key}>{element}</Tag>;
    });
    return element;
}

function renderChildren(node) {
    return (Array.isArray(node.content) ? node.content : []).map((child, index) => renderNode(child, index));
}

function renderNode(node, key) {
    if (!node || typeof node !== "object") return null;
    switch (node.type) {
        case "text":
            return renderText(node, key);
        case "hardBreak":
            return <br key={key} />;
        case "paragraph":
            return <p key={key}>{renderChildren(node)}</p>;
        case "heading": {
            const Tag = node.attrs?.level === 3 ? "h3" : "h2";
            return <Tag key={key}>{renderChildren(node)}</Tag>;
        }
        case "bulletList":
            return <ul key={key}>{renderChildren(node)}</ul>;
        case "orderedList": {
            const start = Number.isInteger(node.attrs?.start) ? node.attrs.start : undefined;
            return <ol key={key} start={start}>{renderChildren(node)}</ol>;
        }
        case "listItem":
            return <li key={key}>{renderChildren(node)}</li>;
        case "blockquote":
            return <blockquote key={key}>{renderChildren(node)}</blockquote>;
        case "horizontalRule":
            return <hr key={key} />;
        case "image": {
            const src = safeImageSrc(node.attrs?.src);
            if (!src) return null;
            const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
            const caption = typeof node.attrs?.title === "string" ? node.attrs.title.trim() : "";
            return (
                <figure key={key} className="rt-figure">
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
