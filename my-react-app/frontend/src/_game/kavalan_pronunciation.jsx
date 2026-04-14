import PronunciationGame from "../../components/_game/pronunciation_game";
import "../../static/css/_game/index.css";
import { useAuth } from "../userServives/authContext";
import PermissionProtect from "../userServives/permissionProtect";

const KavalanPronunciationGame = () => {
    const { userData } = useAuth();

    return (
        <div className="background">
            <h1 className="game-title">Qmisan KAVALAN - 葛瑪蘭族語發音練習</h1>
            {userData == null ?
                (<PermissionProtect />) :
                (
                    <div className="game-background">
                        <PronunciationGame tribe="kavalan" />
                    </div>
                )
            }
        </div>
    );
};

export default KavalanPronunciationGame;
