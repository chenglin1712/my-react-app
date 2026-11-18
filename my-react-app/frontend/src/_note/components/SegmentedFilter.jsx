import { useId } from "react";

/**
 * 分享區的「我的／最新／熱門」分段控制（P5-6）。
 * 用原生 radio 群組：方向鍵移動並選取、Tab 只停在目前這一項，報讀器唸「單選按鈕，第 n 項，共 3 項」，不必自己寫鍵盤處理。
 * 滑動指示器只動 transform（--i 是目前選到第幾項）；選中的項目另有粗體與前面的勾，不只靠顏色；
 * 偏好減少動態時指示器直接跳過去（CSS 裡的 prefers-reduced-motion）。
 */
export default function SegmentedFilter({ options, value, onChange, ariaLabel }) {
  const name = useId();
  const index = Math.max(0, options.findIndex((option) => option.key === value));
  return (
    <div
      className="ns-seg"
      role="radiogroup"
      aria-label={ariaLabel}
      style={{ "--count": options.length, "--i": index }}
    >
      <span className="ns-seg-thumb" aria-hidden="true" />
      {options.map((option) => (
        <label key={option.key} className={`ns-seg-item${option.key === value ? " is-active" : ""}`}>
          <input
            type="radio"
            className="ns-seg-input"
            name={name}
            value={option.key}
            checked={option.key === value}
            onChange={() => onChange(option.key)}
          />
          <span className="ns-seg-label">{option.label}</span>
        </label>
      ))}
    </div>
  );
}
