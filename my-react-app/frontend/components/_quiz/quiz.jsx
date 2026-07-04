import "../../static/css/_quiz/quiz.css"
import { Outlet } from "react-router-dom";

const TRIBE_TITLE = {
    tayal: "泰雅語線上測驗",
    amis: "阿美語線上測驗",
    bunun: "布農語線上測驗",
    kavalan: "噶瑪蘭語線上測驗",
};

const Quiz = ({ tribe = "tayal" }) => {

    return (
        <>
            <h2 className="quiz-title">{TRIBE_TITLE[tribe] ?? TRIBE_TITLE.tayal}</h2>
            <Outlet />
        </>
    );
};
export default Quiz;