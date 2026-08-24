import { useCallback } from 'react';
import { createAuthorizedAudio } from "../utils/authAudio";
import { apiPost } from "../utils/apiClient";
import useAuthorizedAudioPlayback from './useAuthorizedAudioPlayback';

// 單詞發音／整句發音的播放狀態與邏輯，原本在 _search/index.jsx 裡，抽出來讓頁面
// 元件不用管音檔播放的細節（generation token 取消機制、失敗記錄等）。原本住在
// _search/hooks/ 底下，但 _camera/result.jsx 也在用——「搜尋頁專用」的 hook
// 事實上已經是跨功能共用依賴，搬到這裡（跟 utils/authAudio.js 同一層）比較符合
// 實際的共用範圍。
//
// 單一音檔的播放（generation token 取消機制、失敗記錄、unmount 清理）交給
// useAuthorizedAudioPlayback；這裡只再疊加 playSentence 的整句多段播放邏輯。
export default function useAudioPlayback(selectedTribe, onError) {
  const { playAudio, failedAudio, beginPlayback, isCurrent, currentAudioRef } = useAuthorizedAudioPlayback();

  const playSentence = useCallback(async (sentence) => {
    const myGen = beginPlayback();
    try {
      const data = await apiPost(import.meta.env.VITE_API_SENTENCE_AUDIO_URL, { sentence, tribe: selectedTribe });
      const tokens = data.audioTokens || [];
      if (tokens.length === 0 || !isCurrent(myGen)) return;
      for (const { fileId } of tokens) {
        if (!isCurrent(myGen)) break;
        const proxyUrl = import.meta.env.VITE_API_SEARCH_AUDIO_URL + fileId;
        let a;
        try {
          a = await createAuthorizedAudio(proxyUrl);
        } catch {
          continue;
        }
        if (!isCurrent(myGen)) {
          a.revokeObjectUrl?.();
          break;
        }
        currentAudioRef.current = a;
        await new Promise((resolve) => {
          a.onended = resolve;
          a.onerror = resolve;
          a.play().catch(resolve);
        });
        if (currentAudioRef.current === a) {
          currentAudioRef.current = null;
        }
      }
    } catch (e) {
      console.error('playSentence error:', e);
      onError?.('句子語音播放失敗，請稍後再試');
    }
  }, [selectedTribe, onError, beginPlayback, isCurrent, currentAudioRef]);

  return { playAudio, playSentence, failedAudio };
}
