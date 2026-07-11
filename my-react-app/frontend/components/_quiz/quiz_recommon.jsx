import { Outlet } from "react-router-dom";
import { TRIBE_FULL_NAME_BY_SLUG } from "../../src/constants/tribes";

const Recommon = ({ tribe = "tayal" }) => {
    return (
        <>
            <h2 className="quiz-title">{(TRIBE_FULL_NAME_BY_SLUG[tribe] ?? TRIBE_FULL_NAME_BY_SLUG.tayal)} 進階推薦測驗</h2>
            <Outlet />
        </>

    );
};
export default Recommon;