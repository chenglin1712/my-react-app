export default function IntroScreen({ config, error, loading, onStart }) {
  return (
    <div className="pron-intro">
      {config.lines.map((line, i) => (
        <p key={i} className="pron-intro-line">{line}</p>
      ))}
      {error && <p className="pron-error">{error}</p>}
      <button className="pron-btn-primary" onClick={onStart} disabled={loading}>
        {loading ? "載入中..." : "開始"}
      </button>
    </div>
  );
}
