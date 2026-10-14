import PropTypes from "prop-types";
import { useEffect, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";

// 題目音檔的播放／暫停鈕：取代各瀏覽器外觀不一的原生 <audio controls>。
// 音檔在按下播放時才建立，換題（呼叫端用 key 重建）或卸載時停止。
export default function QuizAudioButton({ src }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => () => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  const toggle = () => {
    if (!src) return;
    if (!audioRef.current) {
      const audio = new Audio(src);
      audio.addEventListener("ended", () => setPlaying(false));
      audio.addEventListener("error", () => { setPlaying(false); setFailed(true); });
      audioRef.current = audio;
    }
    const audio = audioRef.current;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    setFailed(false);
    setPlaying(true);
    Promise.resolve(audio.play()).catch(() => { setPlaying(false); setFailed(true); });
  };

  return (
    <span className="quiz-audio-wrap">
      <button
        type="button"
        className={`quiz-audio-toggle${playing ? " is-playing" : ""}`}
        onClick={toggle}
      >
        {playing ? <Pause size={18} aria-hidden="true" /> : <Play size={18} aria-hidden="true" />}
        {playing ? "暫停" : "播放題目音檔"}
      </button>
      {failed && <span className="quiz-audio-error" role="alert">音檔暫時無法播放</span>}
    </span>
  );
}

QuizAudioButton.propTypes = {
  src: PropTypes.string,
};
