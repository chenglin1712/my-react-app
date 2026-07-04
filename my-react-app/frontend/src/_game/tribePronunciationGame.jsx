import { useParams } from "react-router-dom";
import PronunciationGame from "../../components/_game/pronunciation_game";
import "../../static/css/_game/index.css";
import { useAuth } from "../userServives/authContext";
import PermissionProtect from "../userServives/permissionProtect";

const TITLES = {
    tayal: "Qmisan ATAYAL - 泰雅發音練習",
    amis: "Qmisan PANGCAH - 阿美族語發音練習",
    bunun: "Qmisan BUNUN - 布農族語發音練習",
    kavalan: "Qmisan KAVALAN - 葛瑪蘭族語發音練習",
    paiwan: "Qmisan PAIWAN - 排灣族語發音練習",
};

const TribePronunciationGame = () => {
    const { tribe } = useParams();
    const { userData } = useAuth();

    return (
        <div className="background">
            <h1 className="game-title">{TITLES[tribe] || TITLES.tayal}</h1>
            {userData == null ? (
                <PermissionProtect />
            ) : (
                <div className="game-background">
                    <PronunciationGame tribe={tribe} />
                </div>
            )}
        </div>
    );
};

export default TribePronunciationGame;
