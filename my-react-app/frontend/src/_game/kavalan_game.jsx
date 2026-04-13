import Game_Start from "../../components/_game/game_start";
import "../../static/css/_game/index.css";
import { useAuth } from "../userServives/authContext";
import PermissionProtect from "../userServives/permissionProtect";

const KavalanGame = () => {
    const { userData } = useAuth();

    return (
        <div className="background">
            <h1 className="game-title">Sinawlan Kavalan - 葛瑪蘭之語</h1>
            {userData == null ?
                (<PermissionProtect />) :
                (
                    <div className="game-background">
                        <Game_Start tribe="kavalan" />
                    </div>
                )
            }
        </div>
    );
};

export default KavalanGame;
