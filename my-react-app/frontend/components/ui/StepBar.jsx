// 步驟流程條：菱形數字徽章 + 虛線連接，current 態與 done 態皆變赭紅實色。
const StepBar = ({ steps, current }) => (
  <div className="yy-stepbar">
    {steps.map((label, i) => {
      const num = i + 1;
      const active = current === num;
      const done = current > num;
      return (
        <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
          <div className="yy-step">
            <div className={`yy-step-diamond${active ? ' active' : ''}${done ? ' done' : ''}`}>
              <span>{num}</span>
            </div>
            <span className="yy-step-label">{label}</span>
          </div>
          {num < steps.length && <div className="yy-step-connector" />}
        </div>
      );
    })}
  </div>
);

export default StepBar;
