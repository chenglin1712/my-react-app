// 步驟流程條：菱形數字徽章 + 虛線連接，current 態與 done 態皆變赭紅實色。
// 語意是有序清單（ol）；目前這一步標 aria-current="step"，完成的步驟在菱形裡顯示勾號，
// 並用看不見的文字讓報讀器也知道「已完成」，不再只靠顏色與陰影區分。
const StepBar = ({ steps, current, ariaLabel = '步驟' }) => (
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
