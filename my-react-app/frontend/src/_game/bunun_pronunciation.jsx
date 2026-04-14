import PronunciationGame from "../../components/_game/pronunciation_game";
import "../../static/css/_game/index.css";
import { useAuth } from "../userServives/authContext";
import PermissionProtect from "../userServives/permissionProtect";

const BununPronunciationGame = () => {
    const { userData } = useAuth();

    return (
        <div className="background">
            <h1 className="game-title">Qmisan BUNUN - 布農族語發音練習</h1>
            {userData == null ?
                (<PermissionProtect />) :
                (
                    <div className="game-background">
                        <PronunciationGame tribe="bunun" />
                    </div>
                )
            }
        </div>
    );
};

export default BununPronunciationGame;
