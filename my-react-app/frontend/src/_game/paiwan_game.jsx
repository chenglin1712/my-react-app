import Game_Start from "../../components/_game/game_start";
import "../../static/css/_game/index.css";
import { useAuth } from "../userServives/authContext";
import PermissionProtect from "../userServives/permissionProtect";

const PaiwanGame = () => {
    const { userData } = useAuth();

    return (
        <div className="background">
            <h1 className="game-title">Kasiaman Paiwan - 排灣的驕傲</h1>
            {userData == null ?
                (<PermissionProtect />) :
                (
                    <div className="game-background">
                        <Game_Start tribe="paiwan" />
                    </div>
                )
            }
        </div>
    );
};

export default PaiwanGame;
