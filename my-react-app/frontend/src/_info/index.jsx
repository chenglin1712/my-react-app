import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import RichTextRenderer from "../../components/_topic/RichTextRenderer";
import { hasDocContent } from "../../components/_topic/richText";
import "../../static/css/_info/index.css";

// 頁尾三個入口（使用說明、隱私與資料、聯絡我們）的內容頁。
//
// 內容原則：只寫程式碼能證實的事。「隱私與資料」的內文由後台「隱私與資料」頁維護
// （/adminapi/public/privacy-policy/），這裡只負責頁面骨架與載入狀態。

// 聯絡信箱由部署環境設定（VITE_CONTACT_EMAIL）；沒設定、或格式不像信箱時，不顯示信箱，避免出現無效連結。
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const contactEmail = () => {
    const value = (import.meta.env.VITE_CONTACT_EMAIL || "").trim();
    return EMAIL_PATTERN.test(value) ? value : "";
};

const InfoPage = ({ title, lead, children }) => (
    <div className="yy-page info-page">
        <article className="yy-card info-card">
            <h1 className="info-title">{title}</h1>
            {lead && <p className="info-lead">{lead}</p>}
            {children}
        </article>
    </div>
);

const Section = ({ id, title, children }) => (
    <section className="info-section" aria-labelledby={id}>
        <h2 className="info-heading" id={id}>{title}</h2>
        {children}
    </section>
);

export const HelpPage = () => (
    <InfoPage title="使用說明" lead="各功能怎麼用、哪些需要登入。">
        <Section id="help-search" title="單詞查詢">
            <p>不用登入就能使用。輸入族語或中文單詞，可以查看詞義、發音與例句。</p>
        </Section>
        <Section id="help-translate" title="翻譯">
            <p>支援中文與族語互譯，每個詞都會標明是否有辭典語料佐證；沒有標記不代表翻譯正確，只代表這個詞在資料庫裡查得到。</p>
            <p>登入後可使用完整功能。未登入時，開放試用期間每天可以翻譯的次數有限，剩餘次數以翻譯頁顯示為準。發音與詞形分析需要登入。</p>
        </Section>
        <Section id="help-member" title="需要登入的功能">
            <ul>
                <li>影像辨識：用相機或圖片查詢對應的族語詞彙。</li>
                <li>詞彙遊戲：詞彙填字、聽力、發音與句型。發音遊戲需要允許瀏覽器使用麥克風。</li>
                <li>測驗學習：依你的語言能力調整題目。</li>
                <li>收藏與筆記：保存你查到的詞彙與學習筆記。</li>
            </ul>
            <p>還沒有帳號可以<Link to="/register">免費註冊</Link>。</p>
        </Section>
        <Section id="help-more" title="更多">
            <p>資料如何被使用，請見<Link to="/privacy">隱私與資料</Link>；有問題或建議，請見<Link to="/contact">聯絡我們</Link>。</p>
        </Section>
    </InfoPage>
);

// 後端存的是 ISO 時間；顯示成「2026 年 10 月 19 日」，無法解析就不顯示
const formatUpdatedAt = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
};

export const PrivacyPage = () => {
    const [policy, setPolicy] = useState(null);
    // loading / ready / error（可重試）
    const [state, setState] = useState("loading");
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let active = true;
        const controller = new AbortController();
        setState("loading");
        fetch("/adminapi/public/privacy-policy/", { signal: controller.signal })
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.json();
            })
            .then((data) => {
                if (!active) return;
                setPolicy(data);
                setState("ready");
            })
            .catch((err) => {
                if (!active) return;
                console.error("載入隱私與資料失敗：", err);
                setState("error");
            });
        return () => { active = false; controller.abort(); };
    }, [reloadKey]);

    const retry = useCallback(() => setReloadKey((n) => n + 1), []);
    const updated = state === "ready" ? formatUpdatedAt(policy?.updated_at) : "";

    return (
        <InfoPage title="隱私與資料" lead="說明這個網站收集哪些資料、用在哪裡、保存多久。">
            {state === "loading" && <p role="status" aria-busy="true" className="info-status">載入中…</p>}
            {state === "error" && (
                <div className="info-status" role="alert">
                    <p>暫時無法載入內容，請稍後再試。</p>
                    <button type="button" className="info-retry" onClick={retry}>重新載入</button>
                </div>
            )}
            {state === "ready" && (
                hasDocContent(policy?.content)
                    ? <div className="info-rich"><RichTextRenderer doc={policy.content} /></div>
                    : <p className="info-status">內容籌備中。</p>
            )}
            {updated && <p className="info-updated">最後更新：{updated}</p>}
        </InfoPage>
    );
};

export const ContactPage = () => {
    const email = contactEmail();
    return (
        <InfoPage title="聯絡我們">
            <Section id="contact-how" title="聯絡方式">
                {email ? (
                    <>
                        <p>有問題、建議，或想詢問你的資料，歡迎來信：</p>
                        <p><a className="info-email" href={`mailto:${email}`}>{email}</a></p>
                    </>
                ) : (
                    <p>聯絡方式籌備中。</p>
                )}
            </Section>
            <Section id="contact-more" title="先看看這些">
                <p><Link to="/help">使用說明</Link>與<Link to="/privacy">隱私與資料</Link>可能已經回答你的問題。</p>
            </Section>
        </InfoPage>
    );
};
