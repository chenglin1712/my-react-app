import { frequencyToStarCount } from '../../utils/frequencyStars';

/**
 * 詞頻星等顯示元件，原本 WordCard.jsx（_search／_camera 共用）與
 * _favorite/index.jsx 各自維護一份幾乎逐行相同的渲染邏輯，這裡合併成一份。
 */
const StarRating = ({ frequency }) => {
  if (frequency === null || frequency === undefined) return null;
  const starCount = frequencyToStarCount(frequency);

  return (
    <>
      {[...Array(starCount)].map((_, i) => (
        <span key={i}>
          <svg xmlns="http://www.w3.org/2000/svg" height="20" width="20" viewBox="0 0 640 640"><path fill="#FCC603" d="M341.5 45.1C337.4 37.1 329.1 32 320.1 32C311.1 32 302.8 37.1 298.7 45.1L225.1 189.3L65.2 214.7C56.3 216.1 48.9 222.4 46.1 231C43.3 239.6 45.6 249 51.9 255.4L166.3 369.9L141.1 529.8C139.7 538.7 143.4 547.7 150.7 553C158 558.3 167.6 559.1 175.7 555L320.1 481.6L464.4 555C472.4 559.1 482.1 558.3 489.4 553C496.7 547.7 500.4 538.8 499 529.8L473.7 369.9L588.1 255.4C594.5 249 596.7 239.6 593.9 231C591.1 222.4 583.8 216.1 574.8 214.7L415 189.3L341.5 45.1z" /></svg>
        </span>
      ))}
      {/* frequency 可能是 0（有效值，非缺值——缺值已在函式開頭 return null），
          JSX 裡 {frequency && ...} 這種寫法在 frequency 為 0 時會把 0 本身
          當成文字節點渲染出來（0 是 falsy 但不是 null/undefined/false，
          React 仍會印出字面上的 "0"），改用三元判斷式避免這個問題。 */}
      {frequency ? <span style={{ marginLeft: '2px', color: '#666' }}>（{frequency}）</span> : null}
    </>
  );
};

export default StarRating;
