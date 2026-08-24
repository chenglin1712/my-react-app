import { Link } from "react-router-dom";

export default function IntroScreen({ config, error, loading, onStart, tribe }) {
  return (
    <div className="pron-intro">
      {config.lines.map((line, i) => (
        <p key={i} className="pron-intro-line">{line}</p>
      ))}
      <p className="pron-intro-privacy-hint">
        錄音只用來評分，不會自動公開；比對完成後你可以自己選擇要不要分享到社群示範發音頁面。
      </p>
      {error && <p className="pron-error" role="alert">{error}</p>}
      <button type="button" className="pron-btn-primary" onClick={onStart} disabled={loading}>
        {loading ? "載入中..." : "開始"}
      </button>
      <Link className="pron-community-entry-link" to={`/game/pronunciation/${tribe}/community`}>
        聽聽看其他人的示範發音
      </Link>
    </div>
  );
}
