import { useEffect, useRef, useState } from "react";

/**
 * 麥克風錄音的狀態機（idle → recording → recorded → submitted），從
 * pronunciation_game.jsx 抽出來。playUserAudio 播放的是使用者自己剛錄好的
 * 本機 blob URL（不是後端資源），不需要走 utils/authAudio.js 的授權音檔
 * wrapper，直接用原生 Audio 播放即可。
 *
 * 跟 components/_quiz_questions/sentenceSpeak.jsx（FR-4c）是同一類手刻錄音
 * 邏輯、同一類資源清理問題：錄音的 blob URL 沒有在換新錄音/unmount 時
 * revoke、卸載時沒有釋放還開著的麥克風、playUserAudio 每次呼叫都建立一個
 * 沒被追蹤的 Audio、getUserMedia 是非同步的，連點兩次「開始錄音」在還沒
 * 拿到麥克風權限前可能各自要到一支 stream。這裡套用同一套修法。
 */
export function useAudioRecorder(onError) {
  const [recState, setRecState] = useState("idle");
  const [audioBlob, setAudioBlob] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const audioUrlRef = useRef(null);
  const userAudioRef = useRef(null);
  const mountedRef = useRef(true);
  const startingRef = useRef(false);

  function releaseRecordingUrl() {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }

  function releaseStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseStream();
      userAudioRef.current?.pause();
      userAudioRef.current = null;
      releaseRecordingUrl();
    };
  }, []);

  const reset = () => {
    userAudioRef.current?.pause();
    userAudioRef.current = null;
    releaseRecordingUrl();
    setRecState("idle");
    setAudioBlob(null);
    setAudioUrl(null);
  };

  const start = async () => {
    // startingRef 是同步、立即更新的 ref，擋得住「getUserMedia 還沒回來前
    // 又點了一次」這種同一批次內的重複呼叫；純靠 recState（state）擋不住，
    // 因為兩次呼叫可能都讀到還沒更新的舊值。
    if (startingRef.current || recState === "recording") return;
    startingRef.current = true;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = s;
      mediaRecorderRef.current = new MediaRecorder(s);
      chunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (e) => chunksRef.current.push(e.data);
      mediaRecorderRef.current.onstop = () => {
        if (!mountedRef.current) return;
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        releaseRecordingUrl();
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        setAudioBlob(blob);
        setAudioUrl(url);
        setRecState("recorded");
      };
      mediaRecorderRef.current.start();
      setRecState("recording");
    } catch {
      onError?.("無法存取麥克風，請確認瀏覽器權限。");
    } finally {
      startingRef.current = false;
    }
  };

  const stop = () => {
    mediaRecorderRef.current?.stop();
    // MediaRecorder.stop() 只是停止錄製，不會釋放底層 getUserMedia 拿到的
    // stream，瀏覽器分頁/系統的錄音中指示燈會持續亮著，使用者會誤以為還在
    // 錄音。停止 stream 上每個 track 才會真正釋放麥克風。
    releaseStream();
  };

  const playUserAudio = () => {
    if (!audioUrl) return;
    userAudioRef.current?.pause();
    const audio = new Audio(audioUrl);
    userAudioRef.current = audio;
    audio.play().catch(() => {});
  };

  // 只給呼叫端一個語意化的狀態轉換（提交成功後標記為已提交），不直接暴露
  // setRecState——避免呼叫端把狀態機轉去不合法的狀態。
  const markSubmitted = () => setRecState("submitted");

  return { recState, audioBlob, audioUrl, reset, start, stop, playUserAudio, markSubmitted };
}
