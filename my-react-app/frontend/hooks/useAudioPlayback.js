import { useCallback, useState } from 'react';
import { createAuthorizedAudio } from "../utils/authAudio";
import { apiPost } from "../utils/apiClient";
import useAuthorizedAudioPlayback from './useAuthorizedAudioPlayback';
import { apiUrl } from "../utils/apiUrls";

// 單詞發音／整句發音的播放狀態與邏輯，原本在 _search/index.jsx 裡，抽出來讓頁面
// 元件不用管音檔播放的細節（generation token 取消機制、失敗記錄等）。原本住在
// _search/hooks/ 底下，但 _camera/result.jsx 也在用——「搜尋頁專用」的 hook
// 事實上已經是跨功能共用依賴，搬到這裡（跟 utils/authAudio.js 同一層）比較符合
// 實際的共用範圍。
//
// 單一音檔的播放（generation token 取消機制、失敗記錄、unmount 清理）交給
// useAuthorizedAudioPlayback；這裡只再疊加 playSentence 的整句多段播放邏輯。
// 稽核 FE3-05：整句播放失敗原本只能交給呼叫端的 onError，單詞查詢頁傳的是查詢用的 setError，
// 失敗訊息就寫進頁面的主錯誤框：紅框的「重試」重跑查詢而不是重播，還把「查無結果」空狀態蓋掉。
// 現在另外回傳 sentenceFailure（哪一句、什麼原因），讓畫面在那一句旁邊就地顯示並提供「重播」；
// onError 仍保留給還在用的頁面（_translate），新的呼叫端不必再傳。
export const SENTENCE_FAILURE_REASON = Object.freeze({
  AUTH: 'auth', // 401／403：音檔代理要登入，訪客播不了
  FAILED: 'failed',
  EMPTY: 'empty', // 後端找不到這句可以串接的發音
});

const reasonOf = (err) => (err?.status === 401 || err?.status === 403 ? SENTENCE_FAILURE_REASON.AUTH : SENTENCE_FAILURE_REASON.FAILED);

export default function useAudioPlayback(selectedTribe, onError) {
  const { playAudio, stopAudio, retryAudio, playingId, playingDuration, failedAudio, beginPlayback, isCurrent, currentAudioRef } = useAuthorizedAudioPlayback();
  // { sentence, reason }：最近一次失敗的那一句；重播或播別句時清掉
  const [sentenceFailure, setSentenceFailure] = useState(null);

  const playSentence = useCallback(async (sentence) => {
    const myGen = beginPlayback();
    setSentenceFailure(null);
    const fail = (reason) => {
      if (isCurrent(myGen)) setSentenceFailure({ sentence, reason });
    };
    try {
      const data = await apiPost(apiUrl('SENTENCE_AUDIO'), { sentence, tribe: selectedTribe });
      const tokens = data.audioTokens || [];
      if (!isCurrent(myGen)) return;
      if (tokens.length === 0) {
        fail(SENTENCE_FAILURE_REASON.EMPTY);
        return;
      }
      let played = 0;
      let lastError = null;
      for (const { fileId } of tokens) {
        if (!isCurrent(myGen)) break;
        const proxyUrl = apiUrl('SEARCH_AUDIO') + fileId;
        let a;
        try {
          a = await createAuthorizedAudio(proxyUrl);
        } catch (e) {
          lastError = e;
          continue;
        }
        if (!isCurrent(myGen)) {
          a.revokeObjectUrl?.();
          break;
        }
        played += 1;
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
      // 每一段都載不到（例如音檔服務掛了）：使用者按了卻什麼都沒聽到，要告訴他
      if (played === 0 && lastError) fail(reasonOf(lastError));
    } catch (e) {
      console.error('playSentence error:', e);
      fail(reasonOf(e));
      onError?.('句子語音播放失敗，請稍後再試');
    }
  }, [selectedTribe, onError, beginPlayback, isCurrent, currentAudioRef]);

  return { playAudio, playSentence, stopAudio, retryAudio, playingId, playingDuration, failedAudio, sentenceFailure };
}
