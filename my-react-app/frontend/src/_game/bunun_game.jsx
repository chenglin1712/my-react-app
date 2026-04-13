import Game_Start from "../../components/_game/game_start";
import "../../static/css/_game/index.css";
import { useAuth } from "../userServives/authContext";
import PermissionProtect from "../userServives/permissionProtect";

const BununGame = () => {
    const { userData } = useAuth();

    return (
        <div className="background">
            <h1 className="game-title">Lus&apos;an Bunun - 布農之聲</h1>
            {userData == null ?
                (<PermissionProtect />) :
                (
                    <div className="game-background">
                        <Game_Start tribe="bunun" />
                    </div>
                )
            }
        </div>
    );
};

export default BununGame;
