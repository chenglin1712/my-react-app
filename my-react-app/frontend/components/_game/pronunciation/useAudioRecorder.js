import { useRef, useState } from "react";

/**
 * 麥克風錄音的狀態機（idle → recording → recorded → submitted），從
 * pronunciation_game.jsx 抽出來。playUserAudio 播放的是使用者自己剛錄好的
 * 本機 blob URL（不是後端資源），不需要走 utils/authAudio.js 的授權音檔
 * wrapper，直接用原生 Audio 播放即可。
 */
export function useAudioRecorder(onError) {
  const [recState, setRecState] = useState("idle");
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);

  const mediaRecorder = useRef(null);
  const chunks = useRef([]);
  const stream = useRef(null);

  const reset = () => {
    setRecState("idle");
    setAudioBlob(null);
    setAudioUrl(null);
  };

  const start = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      mediaRecorder.current = new MediaRecorder(s);
      chunks.current = [];
      mediaRecorder.current.ondataavailable = (e) => chunks.current.push(e.data);
      mediaRecorder.current.onstop = () => {
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        setAudioBlob(blob);
        setAudioUrl(URL.createObjectURL(blob));
        setRecState("recorded");
      };
      mediaRecorder.current.start();
      setRecState("recording");
    } catch {
      onError?.("無法存取麥克風，請確認瀏覽器權限。");
    }
  };

  const stop = () => {
    mediaRecorder.current?.stop();
    // MediaRecorder.stop() 只是停止錄製，不會釋放底層 getUserMedia 拿到的
    // stream，瀏覽器分頁/系統的錄音中指示燈會持續亮著，使用者會誤以為還在
    // 錄音。停止 stream 上每個 track 才會真正釋放麥克風。
    stream.current?.getTracks().forEach((t) => t.stop());
  };

  const playUserAudio = () => {
    if (audioUrl) new Audio(audioUrl).play();
  };

  return { recState, setRecState, audioBlob, audioUrl, reset, start, stop, playUserAudio };
}
