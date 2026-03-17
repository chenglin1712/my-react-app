import "../../static/css/_home/functionBtn.css"
import quizBtn from "../../static/assets/_home/Btn1.webp"
import cameraBtn from "../../static/assets/_home/Btn2.webp"
import gameBtn from "../../static/assets/_home/Btn3.webp"
import { GripHorizontal } from "lucide-react";
import { useNavigate } from "react-router-dom";

const FunctionBtn = ({ }) => {
    const navigate = useNavigate();
    return (
        <>
            <div className="btn-title-container">
                <GripHorizontal size={30} style={{ color: "#8B0000", marginRight: "5px" }} />
                <h2 className="btn-title">功能模組</h2>
            </div>
            <div className="card-container">
                <div className="card">
                    <img src={cameraBtn} />
                    <div className="card-content">
                        <h2>影像辨識</h2>
                        <p>影像辨識詞彙學習模組中，使用者可透過攝像頭擷取目標物件，系統將進行影像辨識，檢索對應的泰雅族語詞彙、語音及語義，辨識出的詞彙也可依個人喜好儲存於個人詞語庫。</p>
                        <button onClick={() => navigate('/camera')}>立即前往</button>
                    </div>
                </div>
                <div className="card">
                    <img src={gameBtn} />
                    <div className="card-content">
                        <h2>詞彙遊戲</h2>
                        <p>動態詞彙遊戲模組旨在強化使用者對詞語定義與單詞拼寫的連結，使用者需在橫豎交錯的填字格中輸入對應的族語詞彙。系統將記錄使用者的錯誤答案，並在後續測驗中強化練習，提升學習成效。</p>
                        <button onClick={() => navigate('/game')}>立即前往</button>
                    </div>
                </div>
                <div className="card">
                    <img src={quizBtn} />
                    <div className="card-content">
                        <h2>測驗學習</h2>
                        <p>AI適性測驗學習模組測驗將根據使用者的語言能力，動態調整測驗題目，提供個人化語言評估、加強學習策略。透過AI生成適應性題目，確保學習內容能動態適應使用者的進度。</p>
                        <button onClick={() => navigate('/quiz')}>立即前往</button>
                    </div>
                </div>
            </div>
        </>
    );
};
export default FunctionBtn;