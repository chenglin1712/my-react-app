import SentenceGame from "../../components/_game/sentence_game";
import "../../static/css/_game/index.css";
import { useAuth } from "../userServives/authContext";
import PermissionProtect from "../userServives/permissionProtect";

const KavalanSentenceGame = () => {
    const { userData } = useAuth();

    return (
        <div className="background">
            <h1 className="game-title">Lmuhuw KAVALAN - 葛瑪蘭句型練習</h1>
            {userData == null ? (
                <PermissionProtect />
            ) : (
                <div className="game-background">
                    <SentenceGame tribe="kavalan" />
                </div>
            )}
        </div>
    );
};

export default KavalanSentenceGame;
