import { useNavigate } from "react-router-dom";
import permissionAnimation from "../animations/permission restriction.json"
import "../../static/css/userServives/permissionProtect.css"
import { useLottieAnimation } from "@hooks/useLottieAnimation";

const PermissionProtect = () => {
    const navigate = useNavigate();

    //加載動畫
    const animation = useLottieAnimation({ animationData: permissionAnimation });

    return (
        <div className="permission-container">
            <div className="permission-title-container">
                <h3 className="permission-title">請先登入才可使用此功能</h3>
                <button onClick={() => navigate('/login')}>前往登入</button>
            </div>
            <div className="permission-animation-container">
                <div ref={animation} className="permission-animation" />
            </div>
        </div>
    );
};
export default PermissionProtect;