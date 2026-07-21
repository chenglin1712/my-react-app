// 兩段式頁籤切換（登入/註冊、寫筆記/分享區）：active 態赭紅底。
const TabSwitch = ({ tabs, active, onChange }) => (
  <div className="yy-tabswitch">
    {tabs.map((tab) => (
      <button
        type="button"
        key={tab.key}
        className={`yy-tabswitch__tab${active === tab.key ? ' active' : ''}`}
        onClick={() => onChange(tab.key)}
      >
        {tab.label}
      </button>
    ))}
  </div>
);

export default TabSwitch;
