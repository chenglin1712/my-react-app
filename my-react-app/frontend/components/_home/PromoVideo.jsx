import { useEffect, useRef, useState } from "react";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useReducedMotion } from "../../src/hooks/useReducedMotion";
import { formatClock } from "./promoVideoContent";
import "../../static/css/_home/promoVideo.css";

// 瀏覽器擋下自動播放（NotAllowedError）不是故障：停在暫停，控制列有播放鈕。
// 只有格式不支援才算失敗；來源本身載入失敗由 <video> 的 error 事件處理。
function playSafely(el, onUnsupported) {
    el.play()?.catch((error) => {
        if (error?.name === "NotSupportedError") onUnsupported();
    });
}

/**
 * 首頁宣傳影片（HOMEPAGE_CONTRACT.md 4.1、4.3，決定 D3）。
 * - 進入畫面才載入影片，離開畫面自動暫停；使用者自己按暫停、或影片已播完，就不會被自動續播。
 * - 靜音自動播放，旁邊有看得見的「開啟聲音」與「暫停」按鈕（44px，附文字）。
 * - 使用者設定減少動態：不自動播放，只顯示封面與播放鈕；按下去才載入並播放（有聲音）。
 * - 無法播放（available 為 false、載入或播放失敗）：留著封面，顯示文字說明與重試（缺檔時沒有重試），
 *   並展開逐字稿。字幕選填，有才掛上；標題、說明、逐字稿一律純文字。
 * 呼叫端傳入 pickPromoVideo() 整理過的資料，沒有影片時不渲染這個元件。
 */
const HomePromoVideo = ({ video }) => {
    const reduced = useReducedMotion();
    const stageRef = useRef(null);
    const videoRef = useRef(null);
    // 使用者自己按過暫停、或影片已播完：離開再回到畫面時不自動續播
    const userPausedRef = useRef(false);
    const endedRef = useRef(false);
    // 目前是否在畫面內：video 掛載後要不要自動播放，看的是掛載當下的最新狀態，不是觸發掛載時的狀態
    const inViewRef = useRef(false);
    // 這次載入是使用者按鈕觸發的（封面播放鈕、重試）：可以帶聲音播放，也不受是否在畫面內限制
    const userStartRef = useRef(false);
    const [mounted, setMounted] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [muted, setMuted] = useState(true);
    const [failed, setFailed] = useState(!video.playable);
    const [attempt, setAttempt] = useState(0);
    const [time, setTime] = useState(0);
    const [duration, setDuration] = useState(video.durationSeconds);

    // 進入畫面才載入並自動播放，離開畫面暫停
    useEffect(() => {
        const stage = stageRef.current;
        if (!stage || failed) return undefined;
        if (typeof IntersectionObserver === "undefined") {
            inViewRef.current = true;
            if (!reduced) setMounted(true);
            return undefined;
        }
        const observer = new IntersectionObserver(([entry]) => {
            const el = videoRef.current;
            inViewRef.current = entry.isIntersecting;
            if (entry.isIntersecting) {
                if (reduced) return;
                if (!el) setMounted(true);
                else if (!userPausedRef.current && !endedRef.current && el.paused) playSafely(el, () => setFailed(true));
            } else if (el && !el.paused) {
                el.pause();
            }
        }, { threshold: 0.25 });
        observer.observe(stage);
        return () => observer.disconnect();
    }, [reduced, failed]);

    // muted 屬性在不同瀏覽器對動態改值的處理不一，直接寫到元素上
    useEffect(() => {
        if (videoRef.current) videoRef.current.muted = muted;
    }, [muted, mounted, attempt]);

    // video 掛載後才決定要不要播放：使用者按的一定播；自動播放只在仍然看得到、且沒有要求減少動態時
    useEffect(() => {
        const el = videoRef.current;
        if (!el || failed) return;
        if (userStartRef.current || (inViewRef.current && !reduced)) playSafely(el, () => setFailed(true));
    }, [mounted, attempt, failed, reduced]);

    const togglePlay = () => {
        const el = videoRef.current;
        if (!el) {
            // 封面上的播放鈕（減少動態、或還沒進入畫面）：這是使用者的操作，可以直接帶聲音播放
            userPausedRef.current = false;
            endedRef.current = false;
            userStartRef.current = true;
            setMuted(false);
            setMounted(true);
            return;
        }
        if (el.paused) {
            userPausedRef.current = false;
            endedRef.current = false;
            playSafely(el, () => setFailed(true));
        } else {
            userPausedRef.current = true;
            el.pause();
        }
    };

    const toggleSound = () => {
        const el = videoRef.current;
        if (el) el.muted = !el.muted;
        setMuted((m) => !m);
    };

    const seek = (event) => {
        const next = Number(event.target.value);
        if (videoRef.current) videoRef.current.currentTime = next;
        setTime(next);
    };

    const retry = () => {
        userPausedRef.current = false;
        endedRef.current = false;
        userStartRef.current = true;
        setFailed(false);
        setPlaying(false);
        setTime(0);
        setAttempt((n) => n + 1);
        setMounted(true);
    };

    const total = duration || 0;
    const clock = `${formatClock(time)} / ${formatClock(total)}`;

    return (
        <section className="home-promo" aria-label="宣傳影片">
            <div className="home-promo__frame">
            <div className="home-promo__stage" ref={stageRef}>
                {mounted && !failed ? (
                    <video
                        key={attempt}
                        ref={videoRef}
                        className="home-promo__video"
                        src={video.videoUrl}
                        poster={video.coverUrl || undefined}
                        aria-label={video.title || "宣傳影片"}
                        muted={muted}
                        playsInline
                        preload="auto"
                        onPlay={() => { endedRef.current = false; setPlaying(true); }}
                        onPause={() => setPlaying(false)}
                        onEnded={() => { endedRef.current = true; setPlaying(false); }}
                        onError={() => { setFailed(true); setPlaying(false); }}
                        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
                        onLoadedMetadata={(e) => {
                            const next = e.currentTarget.duration;
                            if (Number.isFinite(next) && next > 0) setDuration(next);
                        }}
                    >
                        {video.captionUrl && (
                            <track kind="captions" srcLang="zh-Hant" label="繁體中文" src={video.captionUrl} default />
                        )}
                    </video>
                ) : (
                    video.coverUrl && <img className="home-promo__cover" src={video.coverUrl} alt="" decoding="async" fetchPriority="high" />
                )}
                {!mounted && !failed && (
                    <button type="button" className="home-promo__big-play" onClick={togglePlay} aria-label="播放宣傳影片">
                        <Play size={28} fill="currentColor" aria-hidden="true" />
                    </button>
                )}
                {/* 標題與說明疊在畫面左下（對齊設計稿）；底下有一層漸層，任何封面上文字對比都固定 */}
                {(video.title || video.description) && !playing && (
                    <div className="home-promo__cap">
                        {video.title && <h2 className="home-promo__title">{video.title}</h2>}
                        {video.description && <p className="home-promo__desc">{video.description}</p>}
                    </div>
                )}
            </div>
            </div>

            {/* 固定高度的控制列：影片載入前先佔位，進入畫面載入時版面不會跳動 */}
            <div className="home-promo__bar">
                {failed ? (
                    <p className="home-promo__error" role="status">
                        影片目前無法播放。
                        {video.playable && (
                            <button type="button" className="home-promo__btn" onClick={retry}>重試</button>
                        )}
                    </p>
                ) : mounted && (
                    <>
                        <button type="button" className="home-promo__btn" onClick={togglePlay}>
                            {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
                            <span>{playing ? "暫停" : "播放"}</span>
                        </button>
                        <button type="button" className="home-promo__btn" onClick={toggleSound}>
                            {muted ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
                            <span>{muted ? "開啟聲音" : "關閉聲音"}</span>
                        </button>
                        <input
                            type="range"
                            className="home-promo__seek"
                            aria-label="播放進度"
                            aria-valuetext={clock}
                            min={0}
                            max={total || 1}
                            step={1}
                            value={Math.min(time, total || 1)}
                            disabled={!total}
                            onChange={seek}
                        />
                        <span className="home-promo__clock yy-tabular" aria-hidden="true">{clock}</span>
                    </>
                )}
            </div>

            {video.transcript && (
                <details className="home-promo__transcript" open={failed || undefined}>
                    <summary>逐字稿</summary>
                    <p>{video.transcript}</p>
                </details>
            )}
        </section>
    );
};

/**
 * 後台還沒設定宣傳影片時的示意卡（對齊設計稿）：純裝飾、沒有可按的東西，
 * 不放假的播放鈕；版面先佔好，之後上傳影片就換成上面的播放器。
 */
export const HomePromoPlaceholder = () => (
    <section className="home-promo home-promo--placeholder" aria-label="宣傳影片（尚未上傳）">
        <div className="home-promo__frame">
            <div className="home-promo__stage">
                <span className="home-promo__pill">示意影片</span>
                <span className="home-promo__big-play home-promo__big-play--static" aria-hidden="true">
                    <Play size={28} fill="currentColor" aria-hidden="true" />
                </span>
                <div className="home-promo__cap">
                    <h2 className="home-promo__title">宣傳影片</h2>
                    <p className="home-promo__desc">這裡之後放正式影片</p>
                </div>
            </div>
        </div>
    </section>
);

export default HomePromoVideo;
