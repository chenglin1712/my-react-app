import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import SituationJudy1 from "./situation_0judy_1.jsx";
import SituationJudy2 from "./situation_0judy_2.jsx";
import SituationJudy3 from "./situation_0judy_3.jsx";
import Filter from "./situation_filter"; //篩選
import { getUserSituation } from "../../src/userServives/uploadDb"
import { TRIBE_FULL_NAME_BY_SLUG } from "../../src/constants/tribes";
import "../../static/css/_quiz/situation.css";

const Situation = () => {
  // quiz_panel_submit.jsx 導頁過來時會帶 tribe，但 Firestore 的 userSituation
  // collection 目前是「每個使用者一筆彙總文件」，沒有依族語拆開存（見
  // firestore.rules 的 userSituation 規則只檢查 userId，且該 collection
  // 只由 repo 外的後端流程寫入），沒辦法在這裡加 query 條件做真正的分族語彙總
  // ——加了只會查到空結果。這裡先把 tribe 用在畫面標題上，讓「已鋪墊」的資料
  // 至少不是完全沒用到；真正要分族語彙總，需要先改寫入 userSituation 的後端邏輯。
  const location = useLocation();
  const tribe = location.state?.tribe;
  const tribeFullName = tribe ? TRIBE_FULL_NAME_BY_SLUG[tribe] : null;

  const [selectedTypes, setSelectedTypes] = useState("所有");
  // Filter 元件內部無條件讀 selectedDate.start，原本這裡完全沒傳這個 prop 進去，
  // 一定會噴 TypeError（Cannot read properties of undefined）讓整頁掛掉。
  const [selectedDate, setSelectedDate] = useState({ start: "", end: "" });
  const [loading, setLoading] = useState(true);

  const [summaryData, setSummaryData] = useState(null);
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const situationData = await getUserSituation();
        if (situationData) {
          setSummaryData(situationData);
        } else {
          setSummaryData(null);
        }
      } catch (error) {
        console.error("載入資料發生錯誤:", error);
        setSummaryData(null);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  return (
    <div className="situation-container">
      <h2 className="situation-header">{tribeFullName ? `${tribeFullName}答題情形` : "答題情形"}</h2>

      <div className="situation-filter-wrapper">
        <Filter
          selectedTypes={selectedTypes}
          setSelectedTypes={setSelectedTypes}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
        />
      </div>

      {loading ? (
        <div className="loading-box">資料載入中...</div>
      ) : summaryData ? (
        <div className="situation-line-wrapper">
          <SituationJudy1
            summary={{
              level: summaryData.level,
              difficulty: summaryData.level,
              speed: summaryData.speed,
              advice: summaryData.advice,
            }}
            radarData={summaryData.radarData}
          />
          <SituationJudy2 data={summaryData.monthlyAccuracy} />
          <SituationJudy3
            data={summaryData.accuracyByType}
            typeRatio={summaryData.questionTypeDistribution}
          />
        </div>
      ) : (
        <div className="no-data-box">無符合條件的資料</div>
      )}
    </div>
  );
};

export default Situation;
