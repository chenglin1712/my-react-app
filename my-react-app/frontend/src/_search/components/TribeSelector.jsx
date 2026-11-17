import TribeSegmented from '../../../components/ui/TribeSegmented';

// 族語選擇器（Apple 化步驟 4-2、P3-2）：共用的分段控制，選取指示塊用彈簧滑動、選取有勾、← → 可換、窄螢幕可橫向捲動。
// 外層 .tribe-selector 只負責置中與上下間距。
const TribeSelector = ({ tribes, selectedTribe, onTribeChange }) => (
  <div className="tribe-selector">
    <TribeSegmented
      label="選擇族語"
      items={tribes.map((name) => ({ value: name, label: `${name}族語` }))}
      value={selectedTribe}
      onChange={onTribeChange}
    />
  </div>
);

export default TribeSelector;
