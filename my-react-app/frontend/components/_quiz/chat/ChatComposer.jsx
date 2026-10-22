// 兩個助手共用的輸入列（路線圖 #36）：文字輸入框加上輸入法安全的 Enter 送出。
// 版面由呼叫端決定：className 是外層容器、inputClassName 是輸入框，leading（例如拍照鈕）放在輸入框前面，
// children（送出／停止鈕）放在後面。等待回覆時不 disabled 輸入框，只標 aria-busy，焦點才不會掉回 body（審查項 P1-6）。

// 組字中（注音、拼音）的 Enter 是選字，不是送出；keyCode 229 是部分瀏覽器（Safari）組字結束後那一下 Enter 的標記。
const isSubmitKey = (event) => event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229;

export default function ChatComposer({
    value, onChange, onSubmit, placeholder, label, busy = false,
    className, inputClassName, inputRef, describedBy, leading = null, children,
}) {
    return (
        <div className={className}>
            {leading}
            <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={onChange}
                onKeyDown={(event) => { if (isSubmitKey(event)) onSubmit(); }}
                placeholder={placeholder}
                className={inputClassName}
                aria-label={label}
                aria-describedby={describedBy}
                aria-busy={busy}
            />
            {children}
        </div>
    );
}
