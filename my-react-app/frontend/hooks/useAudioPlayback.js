import { useState, useRef, useCallback } from 'react';
import { createAuthorizedAudio } from "../utils/authAudio";
import { apiPost } from "../utils/apiClient";

// 單詞發音／整句發音的播放狀態與邏輯，原本在 _search/index.jsx 裡，抽出來讓頁面
// 元件不用管音檔播放的細節（generation token 取消機制、失敗記錄等）。原本住在
// _search/hooks/ 底下，但 _camera/result.jsx 也在用——「搜尋頁專用」的 hook
// 事實上已經是跨功能共用依賴，搬到這裡（跟 utils/authAudio.js 同一層）比較符合
// 實際的共用範圍。
export default function useAudioPlayback(selectedTribe, onError) {
  // 只用來暫停「上一首」播放中的音檔，畫面上不會顯示，改用 ref 存放
  // 這樣就不會每次播放音檔都觸發整個元件重新 render，
  // 也讓 playAudio/playSentence 可以用 useCallback 穩定住函式參照
  const audioRef = useRef(null);
  const playbackGenRef = useRef(0);
  const [failedAudio, setFailedAudio] = useState(new Set());

  const playAudio = useCallback(async (fileId) => {
    if (!fileId || failedAudio.has(fileId)) return;

    // 取消任何進行中的句子播放。myGen 記下這次呼叫的世代編號：
    // createAuthorizedAudio（真正的網路請求 + getIdToken()）是非同步的，
    // 這段等待期間使用者可能又點了別的單字，讓 playbackGenRef.current
    // 被那次更新的呼叫繼續往前推進——沿用 playSentence() 已經有的作法，
    // 每個非同步斷點之後都要重新比對 myGen 是否還是最新，不是的話就當這次
    // 呼叫已經過期，不能再播放或覆蓋 audioRef.current。
    const myGen = (playbackGenRef.current += 1);
    if (playbackGenRef.currentAudio) {
      playbackGenRef.currentAudio.pause();
      // pause() 不會觸發 createAuthorizedAudio 內建的 ended/error revoke，
      // 手動中斷播放要自己呼叫，不然快速切換發音時前一個 blob URL 永遠不會被釋放。
      playbackGenRef.currentAudio.revokeObjectUrl?.();
      playbackGenRef.currentAudio = null;
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.revokeObjectUrl?.();
    }

    const proxyUrl = import.meta.env.VITE_API_SEARCH_AUDIO_URL + fileId;
    let newAudio;
    try {
      newAudio = await createAuthorizedAudio(proxyUrl);
    } catch {
      if (playbackGenRef.current === myGen) {
        setFailedAudio(prev => new Set([...prev, fileId]));
      }
      return;
    }

    if (playbackGenRef.current !== myGen) {
      // 這段等待期間已經有更新的呼叫覆蓋掉這次請求：不要播放、也不要動
      // audioRef.current（可能已經是新一次呼叫設定的音檔），把剛拿到、
      // 用不到的 blob URL 直接釋放掉。
      newAudio.revokeObjectUrl?.();
      return;
    }

    newAudio.onerror = () => {
      if (playbackGenRef.current === myGen) {
        setFailedAudio(prev => new Set([...prev, fileId]));
      }
    };

    audioRef.current = newAudio;
    newAudio.play().catch(() => {
      // play() 進行中如果被更新一次呼叫的 pause() 中斷，瀏覽器會用
      // AbortError reject 這個 promise——那不是真正的播放失敗，只有這次
      // 呼叫仍是最新一次時才算數，否則會把明明正常的音檔永久標記成失敗。
      if (playbackGenRef.current === myGen) {
        setFailedAudio(prev => new Set([...prev, fileId]));
      }
    });
  }, [failedAudio]);

  const playSentence = useCallback(async (sentence) => {
    // 取得本次播放的 generation token，後續每步確認是否已被取消
    const myGen = (playbackGenRef.current += 1);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.revokeObjectUrl?.();
    }
    try {
      const data = await apiPost(import.meta.env.VITE_API_SENTENCE_AUDIO_URL, { sentence, tribe: selectedTribe });
      const tokens = data.audioTokens || [];
      if (tokens.length === 0 || playbackGenRef.current !== myGen) return;
      for (const { fileId } of tokens) {
        if (playbackGenRef.current !== myGen) break;
        const proxyUrl = import.meta.env.VITE_API_SEARCH_AUDIO_URL + fileId;
        let a;
        try {
          a = await createAuthorizedAudio(proxyUrl);
        } catch {
          continue;
        }
        await new Promise((resolve) => {
          playbackGenRef.currentAudio = a;
          a.onended = resolve;
          a.onerror = resolve;
          a.play().catch(resolve);
        });
      }
      playbackGenRef.currentAudio = null;
    } catch (e) {
      console.error('playSentence error:', e);
      onError?.('句子語音播放失敗，請稍後再試');
    }
  }, [selectedTribe, onError]);

  return { playAudio, playSentence, failedAudio };
}
