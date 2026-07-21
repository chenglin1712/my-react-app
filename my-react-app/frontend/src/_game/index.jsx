import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "../../static/css/_game/index.css";
import { TRIBES } from "../constants/tribes";
import DiamondBadge from "../../components/ui/DiamondBadge";

const GAMES = [
  {
    id: "vocabulary",
    title: "詞彙遊戲",
    subtitle: "TNINUN",
    emoji: "🧵",
    desc: "從族語詞彙中挑選正確對應，訓練詞彙記憶能力。",
    headerBg: "linear-gradient(90deg,#9E1B24,#D9A227,#9E1B24)",
  },
  {
    id: "listening",
    title: "聽力遊戲",
    subtitle: "MISANIQ",
    emoji: "🎧",
    desc: "聆聽族語發音，辨識正確詞彙，訓練耳朵的敏銳度。",
    headerBg: "linear-gradient(90deg,#1F3A5C,#2C6E7F,#1F3A5C)",
  },
  {
    id: "pronunciation",
    title: "發音練習",
    subtitle: "QMISAN",
    emoji: "🎤",
    desc: "跟著發音範本錄音，AI 即時評分你的發音準確度。",
    headerBg: "linear-gradient(90deg,#D9A227,#9E1B24,#D9A227)",
  },
  {
    id: "sentence",
    title: "句型練習",
    subtitle: "LMUHUW",
    emoji: "📖",
    desc: "閱讀族語例句，選出正確的中文意思，訓練句型理解能力。",
    headerBg: "linear-gradient(90deg,#4B6B3A,#D9A227,#4B6B3A)",
  },
];

const GameZonePage = () => {
  const navigate = useNavigate();
  const [activeGame, setActiveGame] = useState(null);
  const [activeTribe, setActiveTribe] = useState(null);

  const activeGameData = GAMES.find((g) => g.id === activeGame);
  const activeTribeData = TRIBES.find((t) => t.slug === activeTribe);

  const selectGame = (id) => {
    setActiveGame(id);
    setActiveTribe(null);
  };

  const startChallenge = () => {
    if (!activeGame || !activeTribe) return;
    navigate(`/game/${activeGame}/${activeTribe}`);
  };

  return (
    <div className="yy-page gamehub-page">
      <section className="yy-hero gamehub-hero">
        <span className="gamehub-blob gamehub-blob--gold" />
        <span className="gamehub-blob gamehub-blob--blue" />
        <div className="yy-fade-up">
          <span className="yy-eyebrow">◆ GAME ZONE ◆</span>
          <h1 className="gamehub-title">遊戲專區</h1>
          <p className="gamehub-desc">透過遊戲，輕鬆學習原住民族語。</p>
        </div>
      </section>

      <div className="yy-divider" />

      <section className="gamehub-grid-section">
        <div className="gamehub-grid">
          {GAMES.map((g) => {
            const active = activeGame === g.id;
            return (
              <div
                key={g.id}
                role="button"
                tabIndex={0}
                className="yy-card yy-fade-up gamehub-card"
                style={{ boxShadow: active ? '7px 7px 0 var(--yy-gold)' : undefined }}
                onClick={() => selectGame(g.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectGame(g.id); } }}
              >
                <div className="gamehub-card-head" style={{ background: g.headerBg }}>
                  <div className="gamehub-card-emoji">{g.emoji}</div>
                  <div>
                    <h3 className="gamehub-card-title">{g.title}</h3>
                    <span className="gamehub-card-subtitle">{g.subtitle}</span>
                  </div>
                </div>
                <div className="gamehub-card-body">
                  <p>{g.desc}</p>
                  <span className={`gamehub-card-badge${active ? ' active' : ''}`}>立即遊玩</span>
                </div>
              </div>
            );
          })}
        </div>

        {activeGameData && (
          <div className="yy-card yy-fade-up gamehub-panel">
            <div className="gamehub-panel-head">
              <h3>{activeGameData.title} · 選擇族語</h3>
              <button
                type="button"
                className="yy-btn-outline"
                onClick={() => { setActiveGame(null); setActiveTribe(null); }}
              >← 返回遊戲專區</button>
            </div>
            <p className="gamehub-panel-sub">選擇族語，開始挑戰</p>

            <div className="gamehub-tribe-grid">
              {TRIBES.map((t) => {
                const active = activeTribe === t.slug;
                return (
                  <div
                    key={t.slug}
                    role="button"
                    tabIndex={0}
                    className="gamehub-tribe-card"
                    style={{
                      boxShadow: active ? '5px 5px 0 var(--yy-gold)' : undefined,
                      transform: `scale(${active ? 1.05 : 1})`,
                    }}
                    onClick={() => setActiveTribe(t.slug)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveTribe(t.slug); } }}
                  >
                    <DiamondBadge color={t.color} size={40} fontSize={14} style={{ margin: '0 auto 10px' }}>{t.name}</DiamondBadge>
                    <div className="gamehub-tribe-name">{t.name}族語</div>
                  </div>
                );
              })}
            </div>

            {activeTribeData && (
              <div className="yy-fade-up gamehub-confirm">
                <DiamondBadge color={activeTribeData.color} size={56} fontSize={18} style={{ margin: '0 auto 12px' }}>{activeTribeData.name}</DiamondBadge>
                <h4>{activeTribeData.name}族語 {activeGameData.title}</h4>
                <p>準備好了嗎？點擊下方開始挑戰</p>
                <button type="button" className="yy-btn-primary" onClick={startChallenge}>開始挑戰 ▸</button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};

export default GameZonePage;
