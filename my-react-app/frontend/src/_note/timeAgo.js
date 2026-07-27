export function timeAgo(ts) {
  if (!ts) return "";
  const ms = (ts.seconds ? ts.seconds * 1000 : ts) - 0;
  const diff = Date.now() - ms;
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);
  if (sec < 60) return "剛剛";
  if (min < 60) return `${min} 分鐘前`;
  if (hr < 24) return `${hr} 小時前`;
  if (day === 1) return "昨天";
  return `${day} 天前`;
}
