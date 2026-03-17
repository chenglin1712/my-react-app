import "../../static/css/_quiz/situation_filter.css";
import { useState } from "react";

const Filter = ({ selectedTypes, setSelectedTypes, selectedDate, setSelectedDate }) => {
  const [dateMode, setDateMode] = useState("all"); // "all" | "day"
  const types = [
    { key: "所有", label: "所有" },
    // { key: "是非題", label: "是非題" },
    // { key: "選擇題", label: "選擇題" },
    // { key: "配合題", label: "配合題" },
    // { key: "閱讀填空", label: "閱讀填空" },
  ];

  const timeTypes = [
    { id: "all", label: "全部時間" },
    { id: "day", label: "單日" }
  ];

  return (
    <div className="filter-container">
      <div className="filter-date-mode">
        {timeTypes.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`filter-mode-btn ${dateMode === item.id ? "active" : ""}`}
            onClick={() => {
              setDateMode(item.id);
              setSelectedDate({ start: "", end: "" });
            }}
          >
            {item.label}
          </button>
        ))}
        <input
          type="date"
          value={selectedDate.start}
          onChange={(e) =>
            setSelectedDate({ start: e.target.value, end: e.target.value })
          }
          className="filter-date-input"
          disabled={dateMode === "all"}
        />
      </div>
      <select
        className="filter-select"
        value={selectedTypes}
        onChange={(e) => setSelectedTypes(e.target.value)}
      >
        {types.map((item) => (
          <option key={item.key} value={item.key}>
            {item.label}
          </option>
        ))}
      </select>
    </div>
  );
};

export default Filter;
