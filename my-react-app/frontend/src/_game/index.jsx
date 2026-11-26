import { Spool, Headphones, Mic, BookOpen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../../static/css/_game/index.css";
import { TRIBES, COMING_SOON_LABEL, tribeHasFeature } from "../constants/tribes";
import { scrollBehavior } from "../hooks/useReducedMotion";
import AbstractCover from "@components/ui/AbstractCover";
import { confirmAction } from "@components/ui/ConfirmDialog";
import { clearProgress, currentStreak, hasAnyProgress, readProgress } from "./gameProgress";
import useCardTilt from "./useCardTilt";

const GAMES = [
  {
    id: "vocabulary",
    title: "詞彙遊戲",
    subtitle: "TNINUN",
    Icon: Spool,
    desc: "從族語詞彙中挑選正確對應，訓練詞彙記憶能力。",
    cover: { layout: "pairs", tone: 1 },
    featured: true, // bento 大圖卡：版面上佔左側整欄
  },
  {
    id: "listening",
    title: "聽力遊戲",
    subtitle: "MISANIQ",
    Icon: Headphones,
    desc: "聆聽族語發音，辨識正確詞彙，訓練耳朵的敏銳度。",
    cover: { layout: "voice", tone: 2 },
  },
  {
    id: "pronunciation",
    title: "發音練習",
    subtitle: "QMISAN",
    Icon: Mic,
    desc: "跟著發音範本錄音，AI 即時評分你的發音準確度。",
    cover: { layout: "voice", tone: 3 },
  },
  {
    id: "sentence",
    title: "句型練習",
    subtitle: "LMUHUW",
    Icon: BookOpen,
    desc: "閱讀族語例句，選出正確的中文意思，訓練句型理解能力。",
    cover: { layout: "cross", tone: 4 },
  },
];

// 「06/18」這種短日期；日期壞掉就不顯示
const shortDate = (ms) => {
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
};

const GameZonePage = () => {
  const navigate = useNavigate();
  const tilt = useCardTilt();
  // 個人進度只存在這台裝置（見 gameProgress.js）；進頁面時讀一次就好
  const [progress, setProgress] = useState(readProgress);
  const streak = currentStreak(progress.days);
  const anyProgress = hasAnyProgress(progress);
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
        <div className="yy-fade-up">
          <h1 className="gamehub-title">遊戲專區</h1>
          <p className="gamehub-desc">透過遊戲，輕鬆學習原住民族語。</p>
          {streak > 0 && <p className="gamehub-streak">已連續 {streak} 天有玩遊戲</p>}
          {!anyProgress && (
            <p className="gamehub-empty">還沒有遊戲紀錄。玩完一局後，這裡會記下每款遊戲的最高分和連續天數。</p>
          )}
        </div>
      </section>

      <div className="yy-divider" />

      <section className="gamehub-grid-section">
        <div className="gamehub-grid">
          {GAMES.map((g) => {
            const active = activeGame === g.id;
            const mine = progress.games[g.id];
            const lastTribe = TRIBES.find((t) => t.slug === mine?.lastTribe);
            const lastDate = mine?.lastAt != null ? shortDate(mine.lastAt) : null;
            return (
              <div
                key={g.id}
                className={`yy-card yy-fade-up gamehub-card${g.featured ? ' gamehub-card--feature' : ''}${active ? ' is-selected' : ''}`}
                data-cover-host
                onPointerMove={tilt.onPointerMove}
                onPointerLeave={tilt.onPointerLeave}
              >
                <AbstractCover layout={g.cover.layout} tone={g.cover.tone} className="gamehub-card-cover" />
                <div className="gamehub-card-head">
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
                  {g.featured && (
                    <span className="gamehub-card-art" aria-hidden="true"><g.Icon size={160} strokeWidth={1.25} /></span>
                  )}
                  <p>{g.desc}</p>
                  {/* 沒有紀錄的欄位就不顯示（不用 0 或假資料充數） */}
                  {mine && (mine.best != null || lastDate) && (
                    <p className="gamehub-card-progress">
                      {mine.best != null && <span>最高分 {mine.best}{g.id === "pronunciation" ? " 分" : "%"}</span>}
                      {lastDate && <span>上次玩{lastTribe ? ` ${lastTribe.name}族語` : ""} · {lastDate}</span>}
                    </p>
                  )}
                  <span className={`gamehub-card-badge${active ? ' active' : ''}`} aria-hidden="true">
                    {active ? '✓ 已選擇' : '選這個'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        <p className="gamehub-privacy">
          個人進度只存在這台裝置的瀏覽器，不會上傳或同步到伺服器；清除瀏覽器資料、使用無痕視窗或換裝置就不會有。
          {anyProgress && (
            <button type="button" className="gamehub-privacy-clear" onClick={async () => {
              // 稽核 FE5-18：最高分與連續天數只存在這台裝置，刪了就沒有備份，要先確認
              const ok = await confirmAction({
                title: "清除遊戲進度？",
                message: <p className="mb-0">最高分與連續天數都會被刪除，無法復原。</p>,
                confirmLabel: "清除",
                cancelLabel: "先不要",
              });
              if (!ok) return;
              clearProgress();
              setProgress(readProgress());
            }}>
              清除我的遊戲進度
            </button>
          )}
        </p>

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
                    <span className="gamehub-tribe-mark" aria-hidden="true">{t.name}</span>
                    <span className="gamehub-tribe-name">{t.name}族語{active && <span aria-hidden="true"> ✓</span>}</span>
                    {soon && <span className="gamehub-tribe-soon">{COMING_SOON_LABEL}</span>}
                  </button>
                );
              })}
            </div>

            {activeTribeData && (
              <div className="yy-fade-up gamehub-confirm">
                <span className="gamehub-tribe-mark gamehub-tribe-mark--lg" aria-hidden="true">{activeTribeData.name}</span>
                <h4>{activeTribeData.name}族語 {activeGameData.title}</h4>
                <p>準備好了嗎？點選下方開始挑戰</p>
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
