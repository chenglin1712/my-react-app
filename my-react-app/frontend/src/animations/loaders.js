// 動畫 JSON 與 lottie 播放器都延遲載入（P1-22）：只在真的要播的時候才下載。
export const loadSuccessAnimation = () => import("./success.json").then((m) => m.default);
export const loadLoadingAnimation = () => import("./loading.json").then((m) => m.default);
