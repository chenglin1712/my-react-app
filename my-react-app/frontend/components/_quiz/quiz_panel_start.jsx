import "../../static/css/_quiz/quiz_panel_start.css"
import { useNavigate } from "react-router-dom";
import RecommonImg from "../../static/assets/_quiz/recommon.png"
import StepBar from "../ui/StepBar";
import { QUIZ_LEVELS } from "./quizLevels";

const QUIZ_STEPS = ["選擇族語", "選擇等級", "開始作答", "成績單"];

const Panel_Start = ({ tribe = "tayal" }) => {
    const navigate = useNavigate();
    const basePath = tribe === "tayal" ? "/quiz" : `/quiz/${tribe}`;

    return (
        <div className="panel-start-container">
            <div style={{ marginBottom: 22 }}>
                <StepBar steps={QUIZ_STEPS} current={2} />
            </div>

            <div className="panel-start-card">
                <p className="panel-subtitle">請選擇你的測驗等級</p>

                <div className="level-selection">
                    {QUIZ_LEVELS.map((level) => (
                        <div
                            key={level.id}
                            className={`level-card level-${level.id} ${level.disabled ? "disabled" : ""}`}
                        >
                            {level.recommended && (
                                <img src={RecommonImg} alt="推薦等級" className="level-recommend-img" />
                            )}

                            <div className="level-card-icon">
                                <span className="level-icon-text">{level.short}</span>
                            </div>

                            <div className="level-card-title">{level.name}</div>

                            <div className="level-card-info">
                                <span style={{ color: "#8B0000", border: "1px solid #8B0000" }}>{level.typeLabel}</span>
                                <span>預計時間：{level.estimatedTime}</span>
                            </div>

                            <button
                                className="level-card-btn"
                                disabled={level.disabled}
                                onClick={() => navigate(`${basePath}/${level.id}`)}
                            >
                                {level.disabled ? "尚未開放" : "選擇"}
                            </button>
                        </div>
                    ))}
                </div>

                <div className="scenario-entry">
                    <div>
                        <span className="scenario-entry-badge">非官方分級練習</span>
                        <h3>生活情境對話</h3>
                        <p>
                            閱讀生活情境，從四個族語對話選項中選出最合適的回應，
                            每題作答後立即查看答案。
                        </p>
                    </div>
                    <button
                        type="button"
                        className="scenario-entry-btn"
                        onClick={() => navigate(`${basePath}/scenario`)}
                    >
                        開始情境練習
                    </button>
                </div>
            </div>

        </div>
    );
};
export default Panel_Start;