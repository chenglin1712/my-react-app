import ListeningGame from "../../components/_game/listening_game";
import "../../static/css/_game/index.css";
import { useAuth } from "../userServives/authContext";
import PermissionProtect from "../userServives/permissionProtect";

const TayalListeningGame = () => {
    const { userData } = useAuth();

    return (
        <div className="background">
            <h1 className="game-title">Misaniq ATAYAL - 泰雅聽力</h1>
            {userData == null ?
                (<PermissionProtect />) :
                (
                    <div className="game-background">
                        <ListeningGame tribe="tayal" />
                    </div>
                )
            }
        </div>
    );
};

export default TayalListeningGame;
