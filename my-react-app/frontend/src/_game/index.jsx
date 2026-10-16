import { Spool, Headphones, Mic, BookOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../../static/css/_game/index.css";
import { TRIBES, COMING_SOON_LABEL, tribeHasFeature } from "../constants/tribes";
import DiamondBadge from "../../components/ui/DiamondBadge";
import { scrollBehavior } from "../hooks/useReducedMotion";

const GAMES = [
  {
    id: "vocabulary",
    title: "詞彙遊戲",
    subtitle: "TNINUN",
    Icon: Spool,
    desc: "從族語詞彙中挑選正確對應，訓練詞彙記憶能力。",
    headerBg: "linear-gradient(90deg,var(--yy-red),var(--yy-gold),var(--yy-red))",
  },
  {
    id: "listening",
    title: "聽力遊戲",
    subtitle: "MISANIQ",
    Icon: Headphones,
    desc: "聆聽族語發音，辨識正確詞彙，訓練耳朵的敏銳度。",
    headerBg: "linear-gradient(90deg,var(--yy-blue),var(--yy-blue-light),var(--yy-blue))",
  },
  {
    id: "pronunciation",
    title: "發音練習",
    subtitle: "QMISAN",
    Icon: Mic,
    desc: "跟著發音範本錄音，AI 即時評分你的發音準確度。",
    headerBg: "linear-gradient(90deg,var(--yy-gold),var(--yy-red),var(--yy-gold))",
  },
  {
    id: "sentence",
    title: "句型練習",
    subtitle: "LMUHUW",
    Icon: BookOpen,
    desc: "閱讀族語例句，選出正確的中文意思，訓練句型理解能力。",
    headerBg: "linear-gradient(90deg,var(--yy-green),var(--yy-gold),var(--yy-green))",
  },
];

const GameZonePage = () => {
  const navigate = useNavigate();
  const [activeGame, setActiveGame] = useState(null);
  const [activeTribe, setActiveTribe] = useState(null);

  const panelHeadingRef = useRef(null);

  // 選了遊戲後，選擇族語的面板在四張卡片之下，可能在畫面外：捲到面板並把焦點移到標題，
  // 鍵盤與報讀器使用者才知道下面多了東西。
  useEffect(() => {
    if (!activeGame) return;
    const heading = panelHeadingRef.current;
    if (!heading) return;
    heading.focus({ preventScroll: true });
    heading.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
  }, [activeGame]);

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
          <span className="yy-eyebrow">GAME ZONE</span>
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
                className={`yy-card yy-fade-up gamehub-card${active ? ' is-selected' : ''}`}
              >
                <div className="gamehub-card-head" style={{ "--gamehub-head-band": g.headerBg }}>
                  <div className="gamehub-card-icon" aria-hidden="true"><g.Icon size={28} strokeWidth={2.25} /></div>
                  <div>
                    {/* 真正的按鈕放在標題裡，用偽元素撐滿整張卡片，整張卡都點得到，鍵盤與報讀器看到的是一個有 aria-pressed 的按鈕 */}
                    <h3 className="gamehub-card-title">
                      <button
                        type="button"
                        className="gamehub-card-btn"
                        aria-pressed={active}
                        onClick={() => selectGame(g.id)}
                      >
                        {g.title}
                      </button>
                    </h3>
                    <span className="gamehub-card-subtitle">{g.subtitle}</span>
                  </div>
                </div>
                <div className="gamehub-card-body">
                  <p>{g.desc}</p>
                  <span className={`gamehub-card-badge${active ? ' active' : ''}`} aria-hidden="true">
                    {active ? '✓ 已選擇' : '選這個'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {activeGameData && (
          <div className="yy-card yy-fade-up gamehub-panel">
            <div className="gamehub-panel-head">
              <h3 ref={panelHeadingRef} tabIndex={-1}>{activeGameData.title} · 選擇族語</h3>
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
                const soon = !tribeHasFeature(t.slug, activeGame);
                return (
                  <button
                    key={t.slug}
                    type="button"
                    className={`gamehub-tribe-card${active ? ' is-selected' : ''}${soon ? ' is-soon' : ''}`}
                    aria-pressed={active}
                    aria-disabled={soon || undefined}
                    onClick={() => { if (!soon) setActiveTribe(t.slug); }}
                  >
                    <DiamondBadge as="span" color={t.color} textColor={t.textColor} size={40} fontSize={14} style={{ margin: '0 auto 10px' }}>{t.name}</DiamondBadge>
                    <span className="gamehub-tribe-name">{t.name}族語{active && <span aria-hidden="true"> ✓</span>}</span>
                    {soon && <span className="gamehub-tribe-soon">{COMING_SOON_LABEL}</span>}
                  </button>
                );
              })}
            </div>

            {activeTribeData && (
              <div className="yy-fade-up gamehub-confirm">
                <DiamondBadge color={activeTribeData.color} textColor={activeTribeData.textColor} size={56} fontSize={18} style={{ margin: '0 auto 12px' }}>{activeTribeData.name}</DiamondBadge>
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
