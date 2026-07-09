import { Outlet } from "react-router-dom";

const TRIBE_TITLE = {
    tayal: "泰雅語 進階推薦測驗",
    amis: "阿美語 進階推薦測驗",
    bunun: "布農語 進階推薦測驗",
    kavalan: "噶瑪蘭語 進階推薦測驗",
    paiwan: "排灣語 進階推薦測驗",
};

const Recommon = ({ tribe = "tayal" }) => {
    return (
        <>
            <h2 className="quiz-title">{TRIBE_TITLE[tribe] ?? TRIBE_TITLE.tayal}</h2>
            <Outlet />
        </>

    );
};
export default Recommon;