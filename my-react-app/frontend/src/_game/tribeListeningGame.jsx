import { useParams } from "react-router-dom";
import ListeningGame from "../../components/_game/listening_game";
import "../../static/css/_game/index.css";
import { useAuth } from "../userServives/authContext";
import PermissionProtect from "../userServives/permissionProtect";

const TITLES = {
    tayal: "Misaniq ATAYAL - 泰雅聽力",
    amis: "Misaniq PANGCAH - 阿美族語聽力",
    bunun: "Misaniq BUNUN - 布農族語聽力",
    kavalan: "Misaniq KAVALAN - 噶瑪蘭族語聽力",
    paiwan: "Misaniq PAIWAN - 排灣族語聽力",
};

const TribeListeningGame = () => {
    const { tribe } = useParams();
    const { userData } = useAuth();

    return (
        <div className="background">
            <h1 className="game-title">{TITLES[tribe] || TITLES.tayal}</h1>
            {userData == null ? (
                <PermissionProtect />
            ) : (
                <div className="game-background">
                    <ListeningGame tribe={tribe} />
                </div>
            )}
        </div>
    );
};

export default TribeListeningGame;
