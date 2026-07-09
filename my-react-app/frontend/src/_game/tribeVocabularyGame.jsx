import { useParams } from "react-router-dom";
import Game_Start from "../../components/_game/game_start";
import "../../static/css/_game/index.css";
import { useAuth } from "../userServives/authContext";
import PermissionProtect from "../userServives/permissionProtect";

const TITLES = {
    tayal: "Tninun ATAYAL - 編織泰雅",
    amis: "Sowal no Pangcah - 阿美族語",
    bunun: "Lus'an Bunun - 布農之聲",
    kavalan: "Sinawlan Kavalan - 噶瑪蘭之語",
    paiwan: "Kasiaman Paiwan - 排灣的驕傲",
};

const TribeVocabularyGame = () => {
    const { tribe } = useParams();
    const { userData } = useAuth();

    return (
        <div className="background">
            <h1 className="game-title">{TITLES[tribe] || TITLES.tayal}</h1>
            {userData == null ? (
                <PermissionProtect />
            ) : (
                <div className="game-background">
                    <Game_Start tribe={tribe} />
                </div>
            )}
        </div>
    );
};

export default TribeVocabularyGame;
