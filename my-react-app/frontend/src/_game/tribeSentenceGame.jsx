import TribeGamePage from "./TribeGamePage";
import SentenceGame from "../../components/_game/sentence_game";

const TITLES = {
    tayal: "Lmuhuw ATAYAL - 泰雅句型練習",
    amis: "Lmuhuw AMIS - 阿美句型練習",
    bunun: "Lmuhuw BUNUN - 布農句型練習",
    kavalan: "Lmuhuw KAVALAN - 噶瑪蘭句型練習",
    paiwan: "Lmuhuw PAIWAN - 排灣句型練習",
};

const TribeSentenceGame = () => (
    <TribeGamePage titles={TITLES} fallbackPath="/game/sentence" GameComponent={SentenceGame} />
);

export default TribeSentenceGame;
