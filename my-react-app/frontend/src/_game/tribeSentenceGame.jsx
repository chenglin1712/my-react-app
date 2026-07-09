import { useParams } from "react-router-dom";
import SentenceGame from "../../components/_game/sentence_game";
import "../../static/css/_game/index.css";
import { useAuth } from "../userServives/authContext";
import PermissionProtect from "../userServives/permissionProtect";

const TITLES = {
    tayal: "Lmuhuw ATAYAL - 泰雅句型練習",
    amis: "Lmuhuw AMIS - 阿美句型練習",
    bunun: "Lmuhuw BUNUN - 布農句型練習",
    kavalan: "Lmuhuw KAVALAN - 噶瑪蘭句型練習",
    paiwan: "Lmuhuw PAIWAN - 排灣句型練習",
};

const TribeSentenceGame = () => {
    const { tribe } = useParams();
    const { userData } = useAuth();

    return (
        <div className="background">
            <h1 className="game-title">{TITLES[tribe] || TITLES.tayal}</h1>
            {userData == null ? (
                <PermissionProtect />
            ) : (
                <div className="game-background">
                    <SentenceGame tribe={tribe} />
                </div>
            )}
        </div>
    );
};

export default TribeSentenceGame;
