import SentenceGame from "../../components/_game/sentence_game";
import "../../static/css/_game/index.css";
import { useAuth } from "../userServives/authContext";
import PermissionProtect from "../userServives/permissionProtect";

const TayalSentenceGame = () => {
    const { userData } = useAuth();

    return (
        <div className="background">
            <h1 className="game-title">Lmuhuw ATAYAL - 泰雅句型練習</h1>
            {userData == null ? (
                <PermissionProtect />
            ) : (
                <div className="game-background">
                    <SentenceGame tribe="tayal" />
                </div>
            )}
        </div>
    );
};

export default TayalSentenceGame;
