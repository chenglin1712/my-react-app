import { Outlet } from "react-router-dom";
const Recommon = () => {
    return (
        <>
            <h2 className="quiz-title">泰雅語線上測驗</h2>
            <Outlet />
        </>
        
    );
};
export default Recommon;