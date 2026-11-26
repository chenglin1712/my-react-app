import { useState } from 'react';
import { Button } from 'react-bootstrap';
import { Heart } from 'lucide-react';
import '../../static/css/ui/favoriteButton.css';

// 收藏愛心鈕（P2-7），詞卡與詳情面板共用：
// - FE1-10：名稱固定為「收藏「詞」」、狀態只由 aria-pressed 表達。原本名稱只有「加入收藏／取消收藏」，
//   詞卡列表裡每顆都同名分不出是哪個詞；名稱又跟著狀態變，配上 aria-pressed 會念成「取消收藏，已按下」。
// - 按下「加入收藏」時愛心彈跳一下並填色：每按一次換一個 key 讓動畫重新播放（不靠 animationend，
//   減少動態或動畫被關掉時也不會卡住）。畫面立即更新（樂觀更新在 useFavorites）；寫入失敗時由它還原並說明。
// 減少動態時沒有彈跳，直接換成填色。
export default function FavoriteButton({ name, isFavorited, onToggle, size = 20, className = '' }) {
  const [popKey, setPopKey] = useState(0);

  return (
    <Button
      type="button"
      variant="link"
      className={`yy-fav-btn${isFavorited ? ' is-favorited' : ''}${className ? ` ${className}` : ''}`}
      aria-label={name ? `收藏「${name}」` : '收藏'}
      aria-pressed={isFavorited}
      data-word={name}
      onClick={(e) => {
        if (!isFavorited) setPopKey((k) => k + 1);
        onToggle?.(e);
      }}
    >
      <Heart
        key={popKey}
        size={size}
        className={`yy-icon yy-fav-heart${isFavorited && popKey > 0 ? ' is-pop' : ''}`}
        fill={isFavorited ? 'currentColor' : 'none'}
        aria-hidden="true"
      />
    </Button>
  );
}
