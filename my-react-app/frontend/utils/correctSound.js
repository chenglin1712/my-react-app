import correctAudio from "../static/assets/_quiz/correct.mp3";

/**
 * 答對題目時播放的音效，原本 5 個 _quiz_questions 題型元件
 * （wordMatch／wordTranslation／sentenceOrder／sentenceFill／sentenceSpeak）
 * 各自 import 同一顆 correct.mp3、各自 new Audio(...).play() 一次，邏輯完全相同。
 */
export function playCorrectSound() {
  new Audio(correctAudio).play();
}
