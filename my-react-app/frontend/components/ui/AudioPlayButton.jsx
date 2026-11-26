import { useEffect, useRef } from 'react';
import { Button } from 'react-bootstrap';
import { CirclePlay, RotateCcw } from 'lucide-react';
import { Link, useInRouterContext } from 'react-router-dom';
import { announce } from '@utils/announce';
import { withNext } from '../_auth/redirectTarget';
import '../../static/css/ui/audioPlayButton.css';

// 單詞發音鈕（P2-5、P2-6），詞卡與詳情面板共用，有三種狀態：
// - 閒置：播放圖示，點了開始播放。
// - 播放中：波形加環形進度（長度跟音檔一樣），按鈕名稱變成「停止播放」，再按一次就停。
// - 失敗：不再讓按鈕直接消失；按鈕變成帶「重試」字樣的重試鈕（詞卡與面板都有），面板再多一行「發音載入失敗」。
// 三種狀態永遠是同一個外層加同一顆 Button（只換內容與名稱），按鈕不會被卸載重建，鍵盤焦點留在原處。
// 狀態變化用 announce() 讀給螢幕閱讀器；波形與環在減少動態時改靜態（見 audioPlayButton.css）。
// 稽核 WP-10 驗證後：authRequired（失敗原因是 401／403，訪客要登入才能播）時不給重試鈕（重試永遠不會成功），
// 改成「登入後才能播放」連結，登入後回到目前頁面。
function LoginToPlay({ name }) {
  const inRouter = useInRouterContext();
  const href = withNext('/login', `${window.location.pathname}${window.location.search}`);
  const props = { className: 'yy-audio-login', 'aria-label': `登入後才能播放「${name}」的發音` };
  return (
    <span className="yy-audio-control" data-state="auth">
      {inRouter ? <Link to={href} {...props}>登入後才能播放</Link> : <a href={href} {...props}>登入後才能播放</a>}
    </span>
  );
}

export default function AudioPlayButton({
  name, playing = false, duration = 0, failed = false, authRequired = false,
  onPlay, onStop, onRetry, size = 20, showStatus = false,
}) {
  // 初始值就是目前狀態：剛掛上來（例如打開詳情面板）時不要補一次公告
  const prev = useRef({ playing, failed });
  useEffect(() => {
    if (playing && !prev.current.playing) announce(`正在播放「${name}」`);
    if (failed && !prev.current.failed) {
      announce(authRequired ? `「${name}」的發音登入後才能播放` : `「${name}」的發音載入失敗，可以按重試`, { assertive: true });
    }
    prev.current = { playing, failed };
  }, [playing, failed, authRequired, name]);

  if (failed && authRequired) return <LoginToPlay name={name} />;

  const label = failed
    ? `發音載入失敗，重試播放「${name}」的發音`
    : playing ? `停止播放「${name}」的發音` : `播放「${name}」的發音`;
  const ringStyle = duration > 0 ? { '--yy-audio-dur': `${duration}s` } : undefined;

  return (
    <span className="yy-audio-control" data-state={failed ? 'failed' : playing ? 'playing' : 'idle'}>
      {failed && showStatus && <span className="yy-audio-failed-text">發音載入失敗</span>}
      <Button
        type="button"
        variant="link"
        className={`yy-audio-btn${playing && !failed ? ' is-playing' : ''}`}
        aria-label={label}
        onClick={failed ? onRetry : playing ? onStop : onPlay}
      >
        {failed ? (
          <>
            <RotateCcw size={size} className="yy-icon" aria-hidden="true" />
            <span className="yy-audio-retry-text">重試</span>
          </>
        ) : playing ? (
          <span className="yy-audio-glyph" style={{ width: size + 8, height: size + 8 }} aria-hidden="true">
            <svg className="yy-audio-ring" viewBox="0 0 32 32">
              <circle className="yy-audio-ring-track" cx="16" cy="16" r="14" />
              <circle className={`yy-audio-ring-fill${duration > 0 ? ' has-duration' : ''}`} cx="16" cy="16" r="14" pathLength="100" style={ringStyle} />
            </svg>
            <span className="yy-audio-wave"><i /><i /><i /><i /></span>
          </span>
        ) : (
          <CirclePlay size={size} className="yy-icon word-card-icon" aria-hidden="true" />
        )}
      </Button>
    </span>
  );
}
