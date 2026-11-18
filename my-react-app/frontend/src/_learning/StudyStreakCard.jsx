import { Flame, Target, Trophy } from "lucide-react";
import { confirmAction } from "@components/ui/ConfirmDialog";
import { useStudyStats } from "./useStudyStats";
import { clearActivity } from "./studyStreak";
import "../../static/css/_learning/studyStreak.css";

/**
 * 學習動機卡（P6-4）：連續學習天數、今日目標、下一個里程碑。
 * 規格與隱私見 studyStreak.js：只存在這台裝置、台灣時間午夜換日。
 * 沒有任何紀錄時只顯示「開始你的第一天」，不用 0 或假數字充數。
 * 進度條只動 transform；目標達成與里程碑用文字說明，不只靠顏色；下方那行說明是 role=status，數字一變報讀器就會唸。
 */
export default function StudyStreakCard({ uid }) {
  const stats = useStudyStats(uid);
  if (!uid) return null;

  const handleClear = async () => {
    const ok = await confirmAction({
      title: "清除學習紀錄？",
      message: <p className="mb-0">這台裝置上的連續天數與今日進度會歸零，無法復原。收藏、筆記與測驗成績不受影響。</p>,
      confirmLabel: "清除紀錄",
      cancelLabel: "先不要",
    });
    if (ok) clearActivity(uid);
  };

  const ratio = Math.min(1, stats.today / stats.goal);

  return (
    <section className="study-card" aria-labelledby="study-card-title">
      <div className="study-card-head">
        <h2 id="study-card-title" className="study-card-title">學習紀錄</h2>
        {stats.hasAny && (
          <button type="button" className="study-card-clear" onClick={handleClear}>清除紀錄</button>
        )}
      </div>

      {!stats.hasAny ? (
        <p className="study-card-empty">開始你的第一天：完成一次測驗、玩一局遊戲，或收藏一個詞，就會開始記錄。</p>
      ) : (
        <>
          <ul className="study-stats">
            <li className="study-stat">
              <Flame size={20} aria-hidden="true" />
              <span className="study-stat-num">{stats.streak}</span>
              <span className="study-stat-label">連續天數</span>
            </li>
            <li className="study-stat">
              <Target size={20} aria-hidden="true" />
              <span className="study-stat-num">{stats.today} / {stats.goal}</span>
              <span className="study-stat-label">今日目標</span>
            </li>
            <li className="study-stat">
              <Trophy size={20} aria-hidden="true" />
              <span className="study-stat-num">{stats.best}</span>
              <span className="study-stat-label">最長連續</span>
            </li>
          </ul>

          <div
            className="study-bar"
            role="progressbar"
            aria-label="今日學習目標"
            aria-valuemin={0}
            aria-valuemax={stats.goal}
            aria-valuenow={Math.min(stats.today, stats.goal)}
            aria-valuetext={`今天已完成 ${stats.today} 次，目標 ${stats.goal} 次`}
          >
            <span className="study-bar-fill" style={{ transform: `scaleX(${ratio})` }} />
          </div>

          <p className="study-card-note" role="status">
            {stats.reachedMilestone
              ? `達成里程碑：連續學習 ${stats.reachedMilestone} 天！`
              : stats.goalMet
                ? "今天的目標完成了，明天繼續。"
                : stats.today === 0 && stats.streak > 0
                  ? `今天還沒學習，現在開始就能把連續 ${stats.streak} 天接下去。`
                  : `再完成 ${stats.goal - stats.today} 次就達成今天的目標。`}
            {stats.nextMilestone && !stats.reachedMilestone ? ` 距離 ${stats.nextMilestone} 天里程碑還有 ${stats.daysToNext} 天。` : ""}
          </p>
        </>
      )}
      <p className="study-card-privacy">只記錄在這台裝置，換裝置或清除瀏覽器資料就會歸零。一天以台灣時間午夜為界。</p>
    </section>
  );
}
