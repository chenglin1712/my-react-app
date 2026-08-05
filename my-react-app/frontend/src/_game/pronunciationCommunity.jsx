import { useParams } from "react-router-dom";
import PronunciationCommunity from "../../components/_game/pronunciation/PronunciationCommunity";
import "../../static/css/_game/index.css";
import { useAuth } from "../userServives/authContext";
import PermissionProtect from "../userServives/permissionProtect";

const TITLES = {
    tayal: "Qmisan ATAYAL - 泰雅族語社群示範發音",
    amis: "Qmisan PANGCAH - 阿美族語社群示範發音",
    bunun: "Qmisan BUNUN - 布農族語社群示範發音",
    kavalan: "Qmisan KAVALAN - 噶瑪蘭族語社群示範發音",
    paiwan: "Qmisan PAIWAN - 排灣族語社群示範發音",
};

const TribePronunciationCommunity = () => {
    const { tribe } = useParams();
    const { userData } = useAuth();

    return (
        <div className="background">
            <h1 className="game-title">{TITLES[tribe] || TITLES.tayal}</h1>
            {userData == null ? (
                <PermissionProtect />
            ) : (
                <div className="game-background">
                    <PronunciationCommunity />
                </div>
            )}
        </div>
    );
};

export default TribePronunciationCommunity;
