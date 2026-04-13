import ListeningGame from "../../components/_game/listening_game";
import "../../static/css/_game/index.css";
import { useAuth } from "../userServives/authContext";
import PermissionProtect from "../userServives/permissionProtect";

const PaiwanListeningGame = () => {
    const { userData } = useAuth();

    return (
        <div className="background">
            <h1 className="game-title">Misaniq PAIWAN - 排灣族語聽力</h1>
            {userData == null ?
                (<PermissionProtect />) :
                (
                    <div className="game-background">
                        <ListeningGame tribe="paiwan" />
                    </div>
                )
            }
        </div>
    );
};

export default PaiwanListeningGame;
