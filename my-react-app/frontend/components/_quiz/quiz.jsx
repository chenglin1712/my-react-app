import "../../static/css/_quiz/quiz.css"
import { Outlet } from "react-router-dom";
import { TRIBE_FULL_NAME_BY_SLUG } from "../../src/constants/tribes";

const Quiz = ({ tribe = "tayal" }) => {

    return (
        <>
            <h2 className="quiz-title">{(TRIBE_FULL_NAME_BY_SLUG[tribe] ?? TRIBE_FULL_NAME_BY_SLUG.tayal)}線上測驗</h2>
            <Outlet />
        </>
    );
};
export default Quiz;