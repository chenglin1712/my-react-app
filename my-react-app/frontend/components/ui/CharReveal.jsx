/**
 * 逐字進場：每個字各自由下往上彈出，依序延遲（預設每字 45ms）。
 *
 * 總延遲有上限 maxDelay（預設 0.4 秒，審查項 P2-83）：字數多時自動縮短每字的間隔，
 * 最後一個字最晚在 maxDelay 開始進場；超過 12 個字就不拆字，整句一起淡入。
 *
 * 螢幕閱讀器會把每個 <span> 當成單獨的字，所以字元層一律 aria-hidden，
 * 並由外層元素（例如 <h1 aria-label="…">）提供完整的文字。
 * 樣式在 theme-v2.css（.yy-char）；降低動態偏好下由全域規則直接到終態。
 */
const MAX_SPLIT_CHARS = 12;

const CharReveal = ({ text, start = 0, step = 0.045, maxDelay = 0.4 }) => {
    const chars = Array.from(text);
    if (chars.length > MAX_SPLIT_CHARS) {
        return (
            <span
                className="yy-char yy-char--line"
                aria-hidden="true"
                style={{ animationDelay: `${Math.min(start, maxDelay).toFixed(3)}s` }}
            >
                {text}
            </span>
        );
    }
    const gap = chars.length > 1 ? Math.min(step, Math.max(0, maxDelay - start) / (chars.length - 1)) : 0;
    return (
        <>
            {chars.map((char, index) => (
                <span
                    key={index}
                    className="yy-char"
                    aria-hidden="true"
                    style={{ animationDelay: `${Math.min(start + index * gap, maxDelay).toFixed(3)}s` }}
                >
                    {char}
                </span>
            ))}
        </>
    );
};

export default CharReveal;
