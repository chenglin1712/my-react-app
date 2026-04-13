import ListeningGame from "../../components/_game/listening_game";
import "../../static/css/_game/index.css";
import { useAuth } from "../userServives/authContext";
import PermissionProtect from "../userServives/permissionProtect";

const BununListeningGame = () => {
    const { userData } = useAuth();

    return (
        <div className="background">
            <h1 className="game-title">Misaniq BUNUN - 布農族語聽力</h1>
            {userData == null ?
                (<PermissionProtect />) :
                (
                    <div className="game-background">
                        <ListeningGame tribe="bunun" />
                    </div>
                )
            }
        </div>
    );
};

export default BununListeningGame;
