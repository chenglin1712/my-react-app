import { Link } from "react-router-dom";
import GameIntro from "../GameIntro";

export default function IntroScreen({ config, error, loading, onStart, tribe }) {
  return (
    <div className="pron-intro">
      <GameIntro lines={config.lines} onStart={onStart} loading={loading} error={error}>
        {/* 錄音隱私說明全文保留，放在開始鈕下面（錄音前一定看得到） */}
        <p className="pron-intro-privacy-hint">
          錄音只用來評分，不會自動公開；比對完成後你可以自己選擇要不要分享到社群示範發音頁面。
        </p>
        <Link className="pron-community-entry-link" to={`/game/pronunciation/${tribe}/community`}>
          聽聽看其他人的示範發音
        </Link>
      </GameIntro>
    </div>
  );
}
