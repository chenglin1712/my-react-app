import TribeGamePage from "./TribeGamePage";
import Game_Start from "../../components/_game/game_start";

const TITLES = {
    tayal: "Tninun ATAYAL - 編織泰雅",
    amis: "Sowal no Pangcah - 阿美族語",
    bunun: "Lus'an Bunun - 布農之聲",
    kavalan: "Sinawlan Kavalan - 噶瑪蘭之語",
    paiwan: "Kasiaman Paiwan - 排灣的驕傲",
};

const TribeVocabularyGame = () => (
    <TribeGamePage titles={TITLES} fallbackPath="/game/vocabulary" GameComponent={Game_Start} />
);

export default TribeVocabularyGame;
