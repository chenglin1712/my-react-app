import "../../static/css/_quiz/quiz.css"
import { Outlet } from "react-router-dom";

const Quiz = ({ }) => {

    return (
        <>
            <h2 className="quiz-title">泰雅語線上測驗</h2>
            <Outlet />
        </>
    );
};
export default Quiz;