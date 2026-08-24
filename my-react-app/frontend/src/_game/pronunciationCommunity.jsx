import TribeGamePage from "./TribeGamePage";
import PronunciationCommunity from "../../components/_game/pronunciation/PronunciationCommunity";

const TITLES = {
    tayal: "Qmisan ATAYAL - 泰雅族語社群示範發音",
    amis: "Qmisan PANGCAH - 阿美族語社群示範發音",
    bunun: "Qmisan BUNUN - 布農族語社群示範發音",
    kavalan: "Qmisan KAVALAN - 噶瑪蘭族語社群示範發音",
    paiwan: "Qmisan PAIWAN - 排灣族語社群示範發音",
};

const TribePronunciationCommunity = () => (
    <TribeGamePage titles={TITLES} fallbackPath="/game/pronunciation" GameComponent={PronunciationCommunity} />
);

export default TribePronunciationCommunity;
