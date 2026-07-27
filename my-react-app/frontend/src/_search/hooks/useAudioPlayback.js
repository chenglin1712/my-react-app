import { useState, useRef, useCallback } from 'react';
import { createAuthorizedAudio } from "../../../utils/authAudio";
import { apiPost } from "../../../utils/apiClient";

// 單詞發音／整句發音的播放狀態與邏輯，從 _search/index.jsx 抽出來，
// 讓頁面元件不用管音檔播放的細節（generation token 取消機制、失敗記錄等）。
export default function useAudioPlayback(selectedTribe, onError) {
  // 只用來暫停「上一首」播放中的音檔，畫面上不會顯示，改用 ref 存放
  // 這樣就不會每次播放音檔都觸發整個元件重新 render，
  // 也讓 playAudio/playSentence 可以用 useCallback 穩定住函式參照
  const audioRef = useRef(null);
  const playbackGenRef = useRef(0);
  const [failedAudio, setFailedAudio] = useState(new Set());

  const playAudio = useCallback(async (fileId) => {
    if (!fileId || failedAudio.has(fileId)) return;

    // 取消任何進行中的句子播放
    playbackGenRef.current += 1;
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
      setFailedAudio(prev => new Set([...prev, fileId]));
      return;
    }

    newAudio.onerror = () => {
      setFailedAudio(prev => new Set([...prev, fileId]));
    };

    newAudio.play().catch(() => {
      setFailedAudio(prev => new Set([...prev, fileId]));
    });

    audioRef.current = newAudio;
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
