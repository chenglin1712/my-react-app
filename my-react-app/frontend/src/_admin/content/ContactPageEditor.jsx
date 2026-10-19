import SitePageEditor from './SitePageEditor';

export default function ContactPageEditor() {
    return (
        <SitePageEditor
            endpoint="/adminapi/contact-page/"
            title="聯絡我們"
            publicPath="/contact"
            tip="要放電子信箱：選取信箱文字，按連結，網址填 mailto:信箱，例如 mailto:help@example.org。"
        />
    );
}
