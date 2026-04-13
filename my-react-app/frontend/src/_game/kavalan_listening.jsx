import ListeningGame from "../../components/_game/listening_game";
import "../../static/css/_game/index.css";
import { useAuth } from "../userServives/authContext";
import PermissionProtect from "../userServives/permissionProtect";

const KavalanListeningGame = () => {
    const { userData } = useAuth();

    return (
        <div className="background">
            <h1 className="game-title">Misaniq KAVALAN - 葛瑪蘭族語聽力</h1>
            {userData == null ?
                (<PermissionProtect />) :
                (
                    <div className="game-background">
                        <ListeningGame tribe="kavalan" />
                    </div>
                )
            }
        </div>
    );
};

export default KavalanListeningGame;
