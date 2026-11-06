import '../../static/css/ui/stepBar.css';

// 步驟流程條：菱形數字徽章 + 虛線連接，current 態與 done 態皆變赭紅實色。
// 語意是有序清單（ol）；目前這一步標 aria-current="step"，完成的步驟在菱形裡顯示勾號，
// 並用看不見的文字讓報讀器也知道「已完成」，不再只靠顏色與陰影區分。
//
// variant="segments"（Apple 化步驟 4-4）：分段進度條。每一步是一小段橫條，走過與目前這一步填滿，
// 標籤在橫條下方；完成的步驟標籤前面有勾號、目前這一步標籤加粗，狀態不只靠顏色。預設仍是菱形。
const StepBar = ({ steps, current, ariaLabel = '步驟', variant = 'diamond' }) => variant === 'segments' ? (
  <ol className="yy-stepbar yy-stepbar--segments" aria-label={ariaLabel}>
    {steps.map((label, i) => {
      const num = i + 1;
      const active = current === num;
      const done = current > num;
      return (
        <li
          key={label}
          className={`yy-segstep${active ? ' is-active' : ''}${done ? ' is-done' : ''}`}
          aria-current={active ? 'step' : undefined}
        >
          <span className="yy-segstep-bar" aria-hidden="true"><span className="yy-segstep-fill" /></span>
          <span className="yy-segstep-label">
            <span className="yy-segstep-num" aria-hidden="true">{done ? '✓' : num}</span>
            {label}
            {done && <span className="visually-hidden">（已完成）</span>}
            {active && <span className="visually-hidden">（目前步驟）</span>}
          </span>
        </li>
      );
    })}
  </ol>
) : (
  <ol className="yy-stepbar" aria-label={ariaLabel}>
    {steps.map((label, i) => {
      const num = i + 1;
      const active = current === num;
      const done = current > num;
      return (
        <li
          key={label}
          className="yy-step-item"
          aria-current={active ? 'step' : undefined}
        >
          <div className="yy-step">
            <div className={`yy-step-diamond${active ? ' active' : ''}${done ? ' done' : ''}`}>
              <span aria-hidden="true">{done ? '✓' : num}</span>
            </div>
            <span className="yy-step-label">
              {label}
              {done && <span className="visually-hidden">（已完成）</span>}
              {active && <span className="visually-hidden">（目前步驟）</span>}
            </span>
          </div>
          {num < steps.length && <div className="yy-step-connector" aria-hidden="true" />}
        </li>
      );
    })}
  </ol>
);

export default StepBar;
