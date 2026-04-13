import Game_Start from "../../components/_game/game_start";
import "../../static/css/_game/index.css";
import { useAuth } from "../userServives/authContext";
import PermissionProtect from "../userServives/permissionProtect";

const AmisGame = () => {
    const { userData } = useAuth();

    return (
        <div className="background">
            <h1 className="game-title">Sowal no Pangcah - 阿美族語</h1>
            {userData == null ?
                (<PermissionProtect />) :
                (
                    <div className="game-background">
                        <Game_Start tribe="amis" />
                    </div>
                )
            }
        </div>
    );
};

export default AmisGame;
