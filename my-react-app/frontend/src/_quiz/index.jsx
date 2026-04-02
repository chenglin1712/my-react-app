import { Outlet } from "react-router-dom";
import SideBar from "../../components/_quiz/sideBar"
import "../../static/css/_quiz/index.css"
import PermissionProtect from "../userServives/permissionProtect"
import { useAuth } from "../userServives/authContext"

const App = () => {
    const { userData } = useAuth();

    return (
        <div className="quiz-body">
            {userData == null ? (
                <PermissionProtect />
            ) : (
                <>
                    <SideBar />
                    <div className={`quiz-content-container`}>
                        <Outlet />
                    </div>
                </>
            )}
        </div>
    );
};
export default App;
