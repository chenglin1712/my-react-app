/**
 * 逐字進場：每個字各自由下往上彈出，依序延遲（預設每字 45ms）。
 *
 * 螢幕閱讀器會把每個 <span> 當成單獨的字，所以字元層一律 aria-hidden，
 * 並由外層元素（例如 <h1 aria-label="…">）提供完整的文字。
 * 樣式在 theme-v2.css（.yy-char）；降低動態偏好下由全域規則直接到終態。
 */
const CharReveal = ({ text, start = 0, step = 0.045 }) => (
    <>
        {Array.from(text).map((char, index) => (
            <span
                key={index}
                className="yy-char"
                aria-hidden="true"
                style={{ animationDelay: `${(start + index * step).toFixed(3)}s` }}
            >
                {char}
            </span>
        ))}
    </>
);

export default CharReveal;
