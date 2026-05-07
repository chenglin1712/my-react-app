import SentenceGame from "../../components/_game/sentence_game";
import "../../static/css/_game/index.css";
import { useAuth } from "../userServives/authContext";
import PermissionProtect from "../userServives/permissionProtect";

const PaiwanSentenceGame = () => {
    const { userData } = useAuth();

    return (
        <div className="background">
            <h1 className="game-title">Lmuhuw PAIWAN - 排灣句型練習</h1>
            {userData == null ? (
                <PermissionProtect />
            ) : (
                <div className="game-background">
                    <SentenceGame tribe="paiwan" />
                </div>
            )}
        </div>
    );
};

export default PaiwanSentenceGame;
