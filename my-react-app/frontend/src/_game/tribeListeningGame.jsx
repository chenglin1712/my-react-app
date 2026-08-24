import TribeGamePage from "./TribeGamePage";
import ListeningGame from "../../components/_game/listening_game";

const TITLES = {
    tayal: "Misaniq ATAYAL - 泰雅聽力",
    amis: "Misaniq PANGCAH - 阿美族語聽力",
    bunun: "Misaniq BUNUN - 布農族語聽力",
    kavalan: "Misaniq KAVALAN - 噶瑪蘭族語聽力",
    paiwan: "Misaniq PAIWAN - 排灣族語聽力",
};

const TribeListeningGame = () => (
    <TribeGamePage titles={TITLES} fallbackPath="/game/listening" GameComponent={ListeningGame} />
);

export default TribeListeningGame;
