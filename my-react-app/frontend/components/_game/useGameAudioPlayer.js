import useAuthorizedAudioPlayback from "../../hooks/useAuthorizedAudioPlayback";

/**
 * listening_game.jsx／sentence_game.jsx／pronunciation_game.jsx 共用的「播放單一
 * 音檔＋追蹤是否正在播放」邏輯，疊在 hooks/useAuthorizedAudioPlayback.js 上——
 * 那支原本是給 _quiz_questions 用的最小共用邏輯（世代防呆＋unmount 清理），
 * 這裡只是換一個可設定的 audioBaseUrl，並且不記住失敗的音檔（換一題就是換了
 * 語音來源，沒理由讓這一題失敗永久卡住下一次重試）。
 */
export function useGameAudioPlayer(audioBaseUrl) {
  const { isPlaying, playAudio, stopAudio } = useAuthorizedAudioPlayback({
    audioBaseUrl,
    rememberFailures: false,
  });

  return { isPlaying, play: playAudio, stop: stopAudio };
}
