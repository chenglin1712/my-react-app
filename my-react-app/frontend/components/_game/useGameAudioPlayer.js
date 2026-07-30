import { useCallback, useRef, useState } from "react";
import { createAuthorizedAudio } from "../../utils/authAudio";

/**
 * listening_game.jsx／sentence_game.jsx／pronunciation_game.jsx 共用的「播放單一
 * 音檔＋追蹤是否正在播放」邏輯。跟 frontend/hooks/useAudioPlayback.js 是不同用途：
 * 那支是搜尋頁「用 fileId 打後端 proxy、句子還要依序播多段」的邏輯，這裡只需要
 * 「audioBaseUrl + audioId 播一個音檔、追蹤 isPlaying 給按鈕換圖示」，兩邊需求不同、
 * 沒有勉強共用。
 *
 * play/stop 用 useCallback 包住，讓呼叫端可以放進自己 effect 的依賴陣列（例如切換
 * 題目時要停止播放），不用為了避免多餘重跑而關掉 exhaustive-deps 檢查。
 */
export function useGameAudioPlayer(audioBaseUrl) {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef(null);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      // pause() 不會觸發 authAudio.js 內建的 ended/error revoke，手動停止播放
      // 要自己呼叫，不然每停一次／切一次音檔就洩漏一個 blob URL（見
      // hooks/useAudioPlayback.js 同樣的做法）。
      audioRef.current.revokeObjectUrl?.();
    }
    setIsPlaying(false);
  }, []);

  const play = useCallback(async (audioId) => {
    if (!audioId) return;
    const url = audioBaseUrl + audioId;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.revokeObjectUrl?.();
    }
    let audio;
    try {
      audio = await createAuthorizedAudio(url);
    } catch {
      setIsPlaying(false);
      return;
    }
    audioRef.current = audio;
    audio.onplay = () => setIsPlaying(true);
    audio.onended = () => setIsPlaying(false);
    audio.onerror = () => setIsPlaying(false);
    audio.play().catch(() => setIsPlaying(false));
  }, [audioBaseUrl]);

  return { isPlaying, play, stop };
}
