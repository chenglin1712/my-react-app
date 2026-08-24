import { Outlet, useLocation } from "react-router-dom";
import SideBar from "../../components/_quiz/sideBar"
import "../../static/css/_quiz/index.css"
import ErrorBoundary from "../errorBoundary"

// /quiz 已經巢狀在 route.jsx 的 <Route element={<ProtectedLayout />}> 底下，
// 登入檢查在那裡已經做過一次——未登入時 ProtectedLayout 會直接顯示
// PermissionProtect，根本不會渲染到這裡的 <Outlet>，所以這裡不需要再重複
// 檢查一次 userData，避免兩處各自維護一份登入判斷邏輯、日後改其中一處卻漏改
// 另一處。
const QuizLayout = () => {
    const { pathname } = useLocation();

    return (
        <div className="quiz-body">
            <SideBar />
            {/* FE-4：實際的測驗引擎（四種題型 renderer、適性測驗、
                情境測驗）都掛在這個 Outlet 底下，而題目內容是後端
                資料驅動的——一筆格式不如預期的題目就可能讓 renderer
                丟例外。包一層 scoped boundary 讓側邊欄留著，使用者
                可以直接換一個測驗，不必整頁重載；resetKeys 用
                pathname，換題型/換頁時自動復原。 */}
            <div className="quiz-content-container">
                <ErrorBoundary
                    resetKeys={[pathname]}
                    fallback={({ reset }) => (
                        <div className="quiz-panel-error" role="alert">
                            <h2>這個測驗載入時發生問題</h2>
                            <p>可以重試一次，或從左側選單換一個測驗繼續。</p>
                            <button type="button" onClick={reset}>重新載入</button>
                        </div>
                    )}
                >
                    <Outlet />
                </ErrorBoundary>
            </div>
        </div>
    );
};
export default QuizLayout;
