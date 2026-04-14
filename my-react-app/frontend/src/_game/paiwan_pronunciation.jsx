import PronunciationGame from "../../components/_game/pronunciation_game";
import "../../static/css/_game/index.css";
import { useAuth } from "../userServives/authContext";
import PermissionProtect from "../userServives/permissionProtect";

const PaiwanPronunciationGame = () => {
    const { userData } = useAuth();

    return (
        <div className="background">
            <h1 className="game-title">Qmisan PAIWAN - 排灣族語發音練習</h1>
            {userData == null ?
                (<PermissionProtect />) :
                (
                    <div className="game-background">
                        <PronunciationGame tribe="paiwan" />
                    </div>
                )
            }
        </div>
    );
};

export default PaiwanPronunciationGame;
