import { StarterKit } from '@tiptap/starter-kit';
import { Image as ImageExtension } from '@tiptap/extension-image';
import { safeHref } from '../../../components/_topic/richText';

// 圖片只存 src／alt／title：後端白名單（backend/adminapi/article_doc.py）不收其他屬性，這裡就不產生它們
const ArticleImage = ImageExtension.extend({
    addAttributes() {
        return { src: { default: null }, alt: { default: null }, title: { default: null } };
    },
});

/** 專題文章編輯器可用的功能。要與後端白名單、前台渲染器（RichTextRenderer）三處一致。 */
export const articleExtensions = [
    StarterKit.configure({
        heading: { levels: [2, 3] },
        // 後端白名單沒有的功能一律關掉，編輯器裡就不會做出存不進去的內容
        code: false,
        codeBlock: false,
        link: {
            openOnClick: false,
            autolink: false,
            isAllowedUri: (url) => Boolean(safeHref(url)),
        },
    }),
    ArticleImage,
];
