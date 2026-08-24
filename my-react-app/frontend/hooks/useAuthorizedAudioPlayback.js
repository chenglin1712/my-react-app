import { useState, useRef, useCallback, useEffect } from 'react';
import { createAuthorizedAudio } from '../utils/authAudio';

// 播放單一授權音檔（單字/句子發音）的最小共用邏輯，從 useAudioPlayback.js 抽出來，
// 讓不需要 playSentence／apiPost 的呼叫端（_quiz_questions 的 5 個題型元件，
// 原本各自手刻幾乎一樣的一份）不用為了借用這段邏輯而背上不相關的依賴。
//
// 播放狀態只有兩件事：目前是第幾個世代（generationRef，每次開始新播放就 +1）、
// 目前唯一在播的音檔是誰（currentAudioRef）。所有非同步斷點回來後都要用
// isCurrent() 比對世代是否仍是最新，不是的話代表這次呼叫已經過期。
//
// audioBaseUrl／rememberFailures 是後來（_game/useGameAudioPlayer.js 想重用這裡
// 已經做好的世代防呆＋unmount 清理時）才加的參數，讓不同呼叫端可以指到不同的
// proxy 端點、決定失敗的音檔要不要記住不再重試：
// - 預設值（VITE_API_SEARCH_AUDIO_URL、rememberFailures=true）完全對應原本
//   useAudioPlayback.js／_quiz_questions 的行為，兩者都用預設值呼叫，不用改。
// - 遊戲類的播放（單字發音、聽力題目）換一顆音檔通常代表換了一題，沒理由永久
//   record 失敗的音檔 id，所以 useGameAudioPlayer 傳 rememberFailures:false。
function stopAndRelease(audio) {
  if (!audio) return;
  audio.pause();
  audio.currentTime = 0;
  audio.revokeObjectUrl?.();
}

export default function useAuthorizedAudioPlayback({
  audioBaseUrl = import.meta.env.VITE_API_SEARCH_AUDIO_URL,
  rememberFailures = true,
} = {}) {
  const generationRef = useRef(0);
  const currentAudioRef = useRef(null);
  const [failedAudio, setFailedAudio] = useState(new Set());
  const [isPlaying, setIsPlaying] = useState(false);

  const beginPlayback = useCallback(() => {
    generationRef.current += 1;
    stopAndRelease(currentAudioRef.current);
    currentAudioRef.current = null;
    setIsPlaying(false);
    return generationRef.current;
  }, []);

  const isCurrent = useCallback(
    (generation) => generationRef.current === generation,
    [],
  );

  const stopAudio = useCallback(() => {
    generationRef.current += 1;
    stopAndRelease(currentAudioRef.current);
    currentAudioRef.current = null;
    setIsPlaying(false);
  }, []);

  useEffect(() => {
    // unmount 時比照手動停止的路徑，停止並釋放目前音檔，不留下未釋放的 blob URL。
    return () => {
      stopAndRelease(currentAudioRef.current);
      currentAudioRef.current = null;
    };
  }, []);

  const playAudio = useCallback(async (fileId) => {
    if (!fileId || (rememberFailures && failedAudio.has(fileId))) return;

    const myGen = beginPlayback();
    const proxyUrl = audioBaseUrl + fileId;
    let newAudio;
    try {
      newAudio = await createAuthorizedAudio(proxyUrl);
    } catch {
      if (isCurrent(myGen) && rememberFailures) {
        setFailedAudio(prev => new Set([...prev, fileId]));
      }
      return;
    }

    if (!isCurrent(myGen)) {
      // 等待期間已經有更新的呼叫覆蓋掉這次請求：不要播放，把拿到、用不到的
      // blob URL 直接釋放掉。
      newAudio.revokeObjectUrl?.();
      return;
    }

    newAudio.onplay = () => {
      if (isCurrent(myGen)) setIsPlaying(true);
    };
    newAudio.onended = () => {
      if (isCurrent(myGen)) setIsPlaying(false);
    };
    newAudio.onerror = () => {
      if (isCurrent(myGen)) {
        setIsPlaying(false);
        if (rememberFailures) setFailedAudio(prev => new Set([...prev, fileId]));
      }
    };

    currentAudioRef.current = newAudio;
    newAudio.play().catch(() => {
      // play() 進行中如果被更新一次呼叫的 pause() 中斷，瀏覽器會用 AbortError
      // reject 這個 promise——那不是真正的播放失敗，只有這次呼叫仍是最新一次時才算數。
      if (isCurrent(myGen)) {
        setIsPlaying(false);
        if (rememberFailures) setFailedAudio(prev => new Set([...prev, fileId]));
      }
    });
  }, [failedAudio, rememberFailures, audioBaseUrl, beginPlayback, isCurrent]);

  return { playAudio, stopAudio, isPlaying, failedAudio, beginPlayback, isCurrent, currentAudioRef };
}
