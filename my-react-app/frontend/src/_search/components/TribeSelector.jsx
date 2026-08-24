const TribeSelector = ({ tribes, selectedTribe, onTribeChange }) => (
  <div className="tribe-selector" role="group" aria-label="選擇族語">
    {tribes.map(name => (
      <button
        type="button"
        key={name}
        className={`tribe-btn${selectedTribe === name ? ' active' : ''}`}
        data-tribe={name}
        aria-pressed={selectedTribe === name}
        onClick={() => onTribeChange(name)}
      >
        {name}族語
      </button>
    ))}
  </div>
);

export default TribeSelector;
