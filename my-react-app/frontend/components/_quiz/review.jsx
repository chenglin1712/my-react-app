import "../../static/css/_quiz/review.css"
import React, { useState, useEffect } from "react";
import { CircleHelp, CheckCircle, XCircle, Play, Check } from "lucide-react";
import { getCurrentSituation, countScore, getQuizById } from "../../src/userServives/uploadDb"
import Comp_page from "./review_page"
import Comp_discussion from "./review_discussion"
import Comp_atayalAI from "./review_AI"

const Review = ({ }) => {
    const [situations, setSituations] = useState([]);
    const [loading, setLoading] = useState(true);
    const navs = ["測驗紀錄", "討論", "泰雅助手"];
    const [navIndex, setNavIndex] = useState(0);
    const [showIntro, setShowIntro] = useState(false);

    const [selectedQuiz, setSelectedQuiz] = useState(null);
    const [selectedQuestion, setSelectedQuestion] = useState(null);

    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = 5;

    const totalPages = Math.ceil(situations.length / pageSize);
    const startIndex = (currentPage - 1) * pageSize;
    const paginatedSituations = situations.slice(startIndex, startIndex + pageSize);

    const labels = ["A", "B", "C"];

    useEffect(() => {
        const fetchSituations = async () => {
            try {
                const data = await getCurrentSituation();
                setSituations(data);
            } catch (err) {
                console.error("載入失敗：", err);
            } finally {
                setLoading(false);
            }
        };

        fetchSituations();
    }, []);

    const getScoreClass = (score) => {
        if (score >= 70) return "score-good";
        return "score-bad";
    };

    const viewQuiz = async (quizId, results, answers) => {
        const quizData = await getQuizById(quizId);
        // console.log(quizData);
        if (quizData) {
            const enrichedQuiz = {
                ...quizData,
                results,
                answers
            };
            // console.log(enrichedQuiz);
            setSelectedQuiz(enrichedQuiz);
            setSelectedQuestion(null);
            setNavIndex(0);
        }
    };

    const viewQuestion = async (q, idx) => {
        if (q) {
            // console.log(q);
            const enrichedQuestion = {
                ...q,
                userAnswer: selectedQuiz.answers[idx],
                isCorrect: selectedQuiz.results[idx].isCorrect,
                idx: idx
            };
            // console.log(enrichedQuestion);
            setSelectedQuestion(enrichedQuestion);
        }
    };

    return (
        <>
            <div className="review-header">
                <h2 className="review-title">重點複習</h2>
                <button className="review-intro-btn" onClick={() => { setShowIntro(!showIntro) }}>
                    <CircleHelp />說明
                </button>

                {showIntro && (
                    <div className="review-intro-box">
                        <p className="review-parts-title">功能說明</p>
                        <ul>
                            <li><strong>測驗紀錄：</strong>查看歷次測驗紀錄，點選「查看測驗」檢視詳細題目。</li>
                            <li><strong>討論：</strong>與其他使用者一同討論解題思路與學習心得。</li>
                            <li><strong>泰雅助手：</strong>AI智慧協助，針對題目進行解說、延伸學習。</li>
                        </ul>
                        <p className="review-hint">💡提示：若尚未選擇題目，「討論」與「泰雅助手」將無法使用。</p>
                    </div>
                )}
            </div>

            <div className="review-container">
                <div style={{ width: "50%" }}>
                    <div className="review-nav">
                        {navs.map((nav, index) => {
                            //關掉泰雅助手(index = 2)
                            const isDisabled = index == 2 || (index > 0 && !selectedQuestion);

                            return (
                                <div
                                    key={index}
                                    className={`nav-item ${navIndex === index ? "active" : ""} ${isDisabled ? "disabled" : ""}`}
                                    onClick={() => { if (!isDisabled) setNavIndex(index) }}
                                >
                                    {nav}
                                </div>
                            );
                        })}
                    </div>

                    <div className="review-table-container">

                        {!selectedQuiz ? (
                            <>
                                <table className="review-table">
                                    <thead>
                                        <tr>
                                            <th>測驗時間</th>
                                            <th>類型</th>
                                            <th>分數</th>
                                            <th style={{ width: "124.67px" }} />
                                        </tr>
                                    </thead>

                                    <tbody>
                                        {loading ? (
                                            <tr><td colSpan={4} style={{ textAlign: "center" }}>載入中...</td></tr>
                                        ) : situations.length === 0 ? (
                                            <tr><td colSpan={4} style={{ textAlign: "center" }}>尚無答題紀錄</td></tr>
                                        ) : (
                                            paginatedSituations.map((s) => {
                                                let score = countScore(s.results);
                                                return (
                                                    <React.Fragment key={s.quizId}>
                                                        <tr>
                                                            <td>{s.answeredAt.toDate().toLocaleString().split(" ")[0]}</td>
                                                            <td>{s.quizType}</td>
                                                            <td>
                                                                <span className={`${getScoreClass(score)}`}>
                                                                    {score}
                                                                </span></td>
                                                            <td>
                                                                <button className="view-btn" onClick={() => { viewQuiz(s.quizId, s.results, s.answers) }} >查看測驗</button>
                                                            </td>
                                                        </tr>
                                                    </React.Fragment>
                                                );
                                            })
                                        )}
                                    </tbody>
                                </table>

                                <Comp_page
                                    currentPage={currentPage}
                                    totalPages={totalPages}
                                    onPageChange={setCurrentPage}
                                />
                            </>
                        ) : (
                            <div className="review-quiz-detail">
                                {navIndex === 0 && (
                                    <>
                                        <div className="review-quiz-header">
                                            <button className="back-btn" onClick={() => setSelectedQuiz(null)}>← 返回</button>
                                            <h3>{selectedQuiz.title} {selectedQuiz.createdAt.toDate().toLocaleString().split(" ")[0]}</h3>
                                        </div>

                                        <div className="quiz-questions">
                                            <table className="review-table">
                                                <thead>
                                                    <tr>
                                                        <th>　　</th>
                                                        <th>題目</th>
                                                        <th>　　</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {selectedQuiz.data.map((q, idx) => {
                                                        const result = selectedQuiz.results?.[idx];
                                                        const isCorrect = result?.isCorrect;
                                                        return (
                                                            <tr key={idx}>
                                                                <td>
                                                                    {idx + 1}
                                                                    {isCorrect === true && <CheckCircle size={16} color="#388e3c" />}
                                                                    {isCorrect === false && <XCircle size={16} color="#d32f2f" />}
                                                                </td>
                                                                <td>{q.question_ab}</td>
                                                                <td>
                                                                    <button
                                                                        className="view-btn"
                                                                        onClick={() => { viewQuestion(q, idx); }}
                                                                    >
                                                                        查看題目
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </>
                                )}

                                {navIndex === 1 && (<Comp_discussion />)}
                                {navIndex === 2 && (<Comp_atayalAI />)}
                            </div>
                        )}
                    </div>
                </div>

                <div className="quiz-question-detail">
                    {selectedQuestion ? (
                        <>
                            <div className="review-q">
                                <div className={`review-question-card`}>

                                    <div className="review-question-header">
                                        <h4>題目{selectedQuestion.idx + 1}</h4>
                                        {selectedQuestion.isCorrect ? (
                                            <CheckCircle className="icon-correct" size={26} />
                                        ) : (
                                            <XCircle className="icon-wrong" size={26} />
                                        )}
                                    </div>

                                    <hr className="review-divider" />

                                    <div className="review-question-body">
                                        <div className="question-content">
                                            <button
                                                className="play-btn"
                                                onClick={() => {
                                                    const audio = new Audio(selectedQuestion.audio);
                                                    audio.play();
                                                }}
                                            >
                                                <Play size={20} />
                                            </button>
                                            <div>
                                                <p className="question-ab">{selectedQuestion.question_ab}</p>
                                                <p className="question-ch">{selectedQuestion.question_ch}</p>
                                            </div>
                                        </div>
                                        {selectedQuestion.images ? (
                                        <div className="answer-row answer-images">
                                            <div className="answer-block">
                                                <span>我的答案</span>
                                                <div className="answer-options">
                                                    {labels.map((label, idx) => {
                                                        const imgSrc = selectedQuestion.images[label];
                                                        const isUserChoice = selectedQuestion.userAnswer === idx + 1;
                                                        const isCorrect = selectedQuestion.answer === idx + 1;

                                                        return (
                                                            <div key={label}>
                                                                <div className={`option-img-wrapper ${isUserChoice ? "user-choice" : ""}`}>
                                                                    <img src={imgSrc} alt={`選項 ${label}`} className="option-img" />
                                                                    <span className="option-label">{label}</span>
                                                                </div>

                                                                {isCorrect && <span className="correct-tip"><Check size={14} /> 正確答案</span>}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                        ) : (
                                        <div className="answer-row">
                                            <p>你的答案：<strong>{selectedQuestion.userAnswer === 1 ? "O（符合）" : selectedQuestion.userAnswer === 2 ? "X（不符合）" : "未作答"}</strong></p>
                                            <p>正確答案：<strong>{selectedQuestion.answer === 1 ? "O（符合）" : "X（不符合）"}</strong></p>
                                        </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <button className="review-q-btn" onClick={() => { setSelectedQuestion(null); }}>取消</button>
                        </>
                    ) : (
                        <div className="review-q">
                            <div className="review-empty-container">尚未選擇題目</div>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};
export default Review;