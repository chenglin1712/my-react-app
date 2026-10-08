import { Link } from 'react-router-dom';

// 後台網址打錯（或功能已搬移）時顯示在內容區，側邊欄與麵包屑照常可用。
export default function AdminNotFound() {
    return (
        <div className="admin-page">
            <div className="admin-page-heading">
                <div>
                    <h1>找不到這個管理頁面</h1>
                    <p>網址可能輸入錯誤，或這個功能已經移到別處。可以從左側選單選擇功能，或回到儀表板。</p>
                </div>
                <Link className="btn btn-danger" to="/admin">回到儀表板</Link>
            </div>
        </div>
    );
}
