import { Link } from "react-router-dom";
import "../../static/css/_info/index.css";

// 頁尾三個入口（使用說明、隱私與資料、聯絡我們）的內容頁。
//
// 內容原則：只寫程式碼能證實的事。隱私說明是依目前系統實際行為整理的草稿，
// 措辭尚待行政局或法務確認；確認完成後把 PRIVACY_IS_DRAFT 改成 false 即可拿掉頁首的草稿標示。
const PRIVACY_IS_DRAFT = true;

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

export const PrivacyPage = () => (
    <InfoPage title="隱私與資料" lead="說明這個網站收集哪些資料、用在哪裡、保存多久。">
        {PRIVACY_IS_DRAFT && (
            <p className="info-draft" role="note">
                草稿：本頁依目前系統實際運作整理，措辭尚待行政局或法務確認。
            </p>
        )}
        <Section id="privacy-account" title="帳號資料">
            <p>註冊時會保存你的使用者名稱、電子郵件、身分、頭像網址與加入日期，以及你的收藏與答錯紀錄，另外會記錄你的登入／上線狀態與最後狀態變更時間。這些資料存放在 Google 的 Firebase 服務，用來讓你登入並保存學習進度。</p>
            <p>筆記預設只存在你的瀏覽器裡；只有你選擇分享的筆記，才會存到 Firebase。</p>
        </Section>
        <Section id="privacy-features" title="使用功能時傳送的內容">
            <ul>
                <li>影像辨識：你選擇的圖片會傳送到 Google 的影像辨識服務，取得辨識結果；辨識出的標籤文字可能再送到 Google 的翻譯服務。</li>
                <li>翻譯與 AI 助手：你輸入的文字會傳送到 AI 服務處理，用來產生翻譯或回答。</li>
                <li>發音遊戲：錄音用來評分，不會自動公開；評分完成後，是否分享到社群示範發音頁由你自己選擇。選擇分享後，錄音會上傳到 Firebase，其他使用者可以聽到，分數較高的錄音也可能被選為其他人練習時的參考發音。</li>
            </ul>
        </Section>
        <Section id="privacy-guest" title="未登入的試用">
            <p>未登入使用翻譯試用時，為了限制每天的次數、避免被大量濫用，系統會把瀏覽器代號和連線來源 IP 各自轉換成雜湊值（無法直接還原成原本的內容），連同日期、當天的使用次數和更新時間一起保存。這份次數表不保存明文 IP。</p>
            <p>這些紀錄原則上只保留 3 天，超過的紀錄會由系統定期清除；實際刪除的時間可能稍有延遲。</p>
            <p>一般的網站伺服器存取紀錄另有保存期限，不屬於上述次數表。</p>
        </Section>
        <Section id="privacy-contact" title="你的資料">
            <p>對你的資料有疑問，或想詢問、更正、刪除，請見<Link to="/contact">聯絡我們</Link>。</p>
        </Section>
    </InfoPage>
);

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
