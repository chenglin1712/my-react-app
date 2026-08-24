import TribeGamePage from "./TribeGamePage";
import PronunciationGame from "../../components/_game/pronunciation_game";

const TITLES = {
    tayal: "Qmisan ATAYAL - 泰雅發音練習",
    amis: "Qmisan PANGCAH - 阿美族語發音練習",
    bunun: "Qmisan BUNUN - 布農族語發音練習",
    kavalan: "Qmisan KAVALAN - 噶瑪蘭族語發音練習",
    paiwan: "Qmisan PAIWAN - 排灣族語發音練習",
};

const TribePronunciationGame = () => (
    <TribeGamePage titles={TITLES} fallbackPath="/game/pronunciation" GameComponent={PronunciationGame} />
);

export default TribePronunciationGame;
