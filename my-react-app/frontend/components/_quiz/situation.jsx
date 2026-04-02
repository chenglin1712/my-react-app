import { useEffect, useState } from "react";
import SituationJudy1 from "./situation_0judy_1.jsx";
import SituationJudy2 from "./situation_0judy_2.jsx";
import SituationJudy3 from "./situation_0judy_3.jsx";
import Filter from "./situation_filter"; //篩選
import { getUserSituation } from "../../src/userServives/uploadDb"
import "../../static/css/_quiz/situation.css";

const Situation = () => {
  const [selectedTypes, setSelectedTypes] = useState("所有");
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
      <h2 className="situation-header">答題情形</h2>

      <div className="situation-filter-wrapper">
        <Filter
          selectedTypes={selectedTypes}
          setSelectedTypes={setSelectedTypes}
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
