import { Outlet } from "react-router-dom";
import { TRIBE_FULL_NAME_BY_SLUG } from "../../src/constants/tribes";

// 檔名／路由都叫 "recommon"，其實是 "recommend(ed)" 的拼字錯誤，但已經
// 沿用在檔名、route path（/recommon）等多處，可能是既有 deep link，
// 這裡只改元件內部名稱，不動檔名／路由。
const RecommendedQuizLayout = ({ tribe = "tayal" }) => {
    return (
        <>
            <h2 className="quiz-title">{(TRIBE_FULL_NAME_BY_SLUG[tribe] ?? TRIBE_FULL_NAME_BY_SLUG.tayal)} 進階推薦測驗</h2>
            <Outlet />
        </>

    );
};
export default RecommendedQuizLayout;