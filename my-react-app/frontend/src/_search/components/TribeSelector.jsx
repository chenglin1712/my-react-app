const TribeSelector = ({ tribes, selectedTribe, onTribeChange }) => (
  <div className="tribe-selector">
    {tribes.map(name => (
      <button
        key={name}
        className={`tribe-btn${selectedTribe === name ? ' active' : ''}`}
        data-tribe={name}
        onClick={() => onTribeChange(name)}
      >
        {name}族語
      </button>
    ))}
  </div>
);

export default TribeSelector;
