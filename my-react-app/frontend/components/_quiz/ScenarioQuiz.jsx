import { useEffect, useState } from 'react';
import { Alert, Button, Spinner } from 'react-bootstrap';
import {
    ArrowLeft,
    CheckCircle2,
    RefreshCw,
    XCircle,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { apiGet, trackEvent } from '../../utils/apiClient';
import { TRIBE_FULL_NAME_BY_SLUG } from '../../src/constants/tribes';
import '../../static/css/_quiz/scenario_quiz.css';

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

export default function ScenarioQuiz({ tribe = 'tayal' }) {
    const navigate = useNavigate();
    const basePath = tribe === 'tayal' ? '/quiz' : `/quiz/${tribe}`;

    const [questions, setQuestions] = useState([]);
    const [intro, setIntro] = useState('');
    const [currentIndex, setCurrentIndex] = useState(0);
    const [selectedAnswer, setSelectedAnswer] = useState(null);
    const [score, setScore] = useState(0);
    const [finished, setFinished] = useState(false);
    const [requestKey, setRequestKey] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;

        setLoading(true);
        setError('');
        setQuestions([]);
        setIntro('');
        setCurrentIndex(0);
        setSelectedAnswer(null);
        setScore(0);
        setFinished(false);

        (async () => {
            try {
                const data = await apiGet(
                    `/crawler/situation-quiz/?tribe=${encodeURIComponent(tribe)}`,
                );
                const part = data.parts?.find(
                    (item) => item.type === 'situation',
                ) ?? data.parts?.[0];

                if (active) {
                    setQuestions(part?.questions ?? []);
                    setIntro(part?.intro ?? '');
                }
            } catch (err) {
                if (active) setError(err.message);
            } finally {
                if (active) setLoading(false);
            }
        })();

        return () => {
            active = false;
        };
    }, [tribe, requestKey]);

    const currentQuestion = questions[currentIndex];
    const isCorrect = (
        selectedAnswer !== null
        && selectedAnswer === currentQuestion?.answer
    );

    const selectAnswer = (answer) => {
        if (!currentQuestion || selectedAnswer !== null) return;

        const correct = answer === currentQuestion.answer;

        setSelectedAnswer(answer);
        if (correct) setScore((value) => value + 1);

        trackEvent('quiz_answer', {
            tribe,
            payload: {
                item_kind: 'situation',
                item_id: currentQuestion.item_id,
                correct,
            },
        });
    };

    const goNext = () => {
        if (selectedAnswer === null) return;

        if (currentIndex >= questions.length - 1) {
            setFinished(true);
            return;
        }

        setCurrentIndex((value) => value + 1);
        setSelectedAnswer(null);
    };

    const retry = () => {
        setRequestKey((value) => value + 1);
    };

    if (loading) {
        return (
            <main className="scenario-quiz-page">
                <div className="scenario-quiz-loading">
                    <Spinner animation="border" variant="danger" />
                    <span>正在準備情境題…</span>
                </div>
            </main>
        );
    }

    if (error) {
        return (
            <main className="scenario-quiz-page">
                <section className="scenario-quiz-state-card">
                    <Alert variant="danger">{error}</Alert>
                    <div className="scenario-quiz-state-actions">
                        <Button variant="outline-secondary" onClick={() => navigate(basePath)}>
                            <ArrowLeft size={17} aria-hidden="true" />
                            回到測驗選單
                        </Button>
                        <Button variant="danger" onClick={retry}>
                            <RefreshCw size={17} aria-hidden="true" />
                            重新載入
                        </Button>
                    </div>
                </section>
            </main>
        );
    }

    if (questions.length === 0) {
        return (
            <main className="scenario-quiz-page">
                <section className="scenario-quiz-state-card">
                    <h2>目前沒有可練習的情境題</h2>
                    <p>此族語尚未有審核通過的題目，請稍後再試。</p>
                    <div className="scenario-quiz-state-actions">
                        <Button variant="outline-secondary" onClick={() => navigate(basePath)}>
                            <ArrowLeft size={17} aria-hidden="true" />
                            回到測驗選單
                        </Button>
                        <Button variant="danger" onClick={retry}>
                            <RefreshCw size={17} aria-hidden="true" />
                            重新載入
                        </Button>
                    </div>
                </section>
            </main>
        );
    }

    if (finished) {
        return (
            <main className="scenario-quiz-page">
                <section className="scenario-quiz-summary">
                    <div className="scenario-quiz-summary-icon">
                        <CheckCircle2 size={42} aria-hidden="true" />
                    </div>
                    <p className="scenario-quiz-eyebrow">練習完成</p>
                    <h2>
                        {questions.length} 題中答對 {score} 題
                    </h2>
                    <p>
                        答對率
                        {' '}
                        <strong>
                            {Math.round((score / questions.length) * 100)}%
                        </strong>
                    </p>
                    <div className="scenario-quiz-summary-actions">
                        <Button variant="outline-secondary" onClick={() => navigate(basePath)}>
                            <ArrowLeft size={17} aria-hidden="true" />
                            回到測驗選單
                        </Button>
                        <Button variant="danger" onClick={retry}>
                            <RefreshCw size={17} aria-hidden="true" />
                            重新練習
                        </Button>
                    </div>
                </section>
            </main>
        );
    }

    return (
        <main className="scenario-quiz-page">
            <div className="scenario-quiz-heading">
                <div>
                    <p className="scenario-quiz-eyebrow">
                        {TRIBE_FULL_NAME_BY_SLUG[tribe] ?? tribe}
                    </p>
                    <h2>情境對話練習</h2>
                </div>
                <Button
                    variant="link"
                    className="scenario-quiz-exit"
                    onClick={() => navigate(basePath)}
                >
                    <ArrowLeft size={17} aria-hidden="true" />
                    離開練習
                </Button>
            </div>

            <section className="scenario-quiz-card">
                <div className="scenario-quiz-progress-header">
                    <span>
                        第 {currentIndex + 1} 題，共 {questions.length} 題
                    </span>
                    <span>已答對 {score} 題</span>
                </div>

                <div
                    className="scenario-quiz-progress"
                    role="progressbar"
                    aria-label="作答進度"
                    aria-valuemin="0"
                    aria-valuemax={questions.length}
                    aria-valuenow={currentIndex + 1}
                >
                    <div
                        style={{
                            width: `${((currentIndex + 1) / questions.length) * 100}%`,
                        }}
                    />
                </div>

                {intro && (
                    <p className="scenario-quiz-intro">{intro}</p>
                )}

                <div className="scenario-quiz-question">
                    <span>生活情境</span>
                    <h3>{currentQuestion.scenario_ch}</h3>
                </div>

                <div className="scenario-quiz-options">
                    {currentQuestion.options.map((option, index) => {
                        const answer = index + 1;
                        const selected = selectedAnswer === answer;
                        const correctOption = (
                            selectedAnswer !== null
                            && currentQuestion.answer === answer
                        );
                        const wrongSelected = (
                            selected
                            && selectedAnswer !== currentQuestion.answer
                        );

                        return (
                            <button
                                key={`${currentQuestion.item_id}-${answer}`}
                                type="button"
                                className={[
                                    'scenario-quiz-option',
                                    selected ? 'selected' : '',
                                    correctOption ? 'correct' : '',
                                    wrongSelected ? 'incorrect' : '',
                                ].filter(Boolean).join(' ')}
                                disabled={selectedAnswer !== null}
                                onClick={() => selectAnswer(answer)}
                            >
                                <span className="scenario-quiz-option-label">
                                    {OPTION_LABELS[index] ?? answer}
                                </span>
                                <span className="scenario-quiz-option-copy">
                                    <strong>{option.foreign}</strong>
                                    {selectedAnswer !== null && (
                                        <small>{option.chinese}</small>
                                    )}
                                </span>
                                {correctOption && (
                                    <CheckCircle2
                                        className="scenario-quiz-option-result"
                                        size={21}
                                        aria-label="正確答案"
                                    />
                                )}
                                {wrongSelected && (
                                    <XCircle
                                        className="scenario-quiz-option-result"
                                        size={21}
                                        aria-label="你的答案不正確"
                                    />
                                )}
                            </button>
                        );
                    })}
                </div>

                {selectedAnswer !== null && (
                    <div
                        className={`scenario-quiz-feedback ${isCorrect ? 'correct' : 'incorrect'}`}
                        role="status"
                    >
                        {isCorrect ? (
                            <>
                                <CheckCircle2 size={20} aria-hidden="true" />
                                <div>
                                    <strong>答對了！</strong>
                                    <span>這是在此情境下最適合的回應。</span>
                                </div>
                            </>
                        ) : (
                            <>
                                <XCircle size={20} aria-hidden="true" />
                                <div>
                                    <strong>再留意一下這個情境。</strong>
                                    <span>正確答案已標示在上方。</span>
                                </div>
                            </>
                        )}
                    </div>
                )}

                <div className="scenario-quiz-navigation">
                    <Button
                        variant="danger"
                        disabled={selectedAnswer === null}
                        onClick={goNext}
                    >
                        {currentIndex === questions.length - 1
                            ? '查看結果'
                            : '下一題'}
                    </Button>
                </div>
            </section>
        </main>
    );
}
