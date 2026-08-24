import { useEffect, useState } from "react";
import SituationSummary from "./situation_0judy_1.jsx";
import SituationLine from "./situation_0judy_2.jsx";
import SituationDashboard from "./situation_0judy_3.jsx";
import { getUserSituation } from "../../src/userServives/uploadDb"
import "../../static/css/_quiz/situation.css";

// 篩選面板（situation_filter.jsx）目前完全沒有接到資料：getUserSituation()
// 不吃任何篩選參數，這裡拿到的也是「已經算好的彙總資料」（等級/雷達圖/
// 月平均正確率...），不是逐次作答紀錄，前端沒辦法在這裡對彙總結果做真正
// 的日期/題型篩選。與其留著一個看起來能篩選、實際上什麼都不會變的面板，
// 先整個拿掉；之後如果要做真正的篩選，需要後端提供對應的彙總查詢，不是
// 這裡加幾行 .filter() 能解決的。

const Situation = () => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [summaryData, setSummaryData] = useState(null);
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        setLoadError(false);
        const situationData = await getUserSituation();
        setSummaryData(situationData);
      } catch (error) {
        console.error("載入資料發生錯誤:", error);
        setSummaryData(null);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  return (
    <div className="situation-container">
      {/* userSituation 是跨族語的單一彙總文件（見 getUserSituation），不是
          分族語存的，這裡不顯示特定族語名稱，避免讓人誤以為這份資料只涵蓋
          某一個族語。 */}
      <h2 className="situation-header">答題情形</h2>

      {loading ? (
        <div className="loading-box">資料載入中...</div>
      ) : loadError ? (
        <div className="no-data-box">載入資料時發生錯誤，請稍後再試。</div>
      ) : summaryData ? (
        <div className="situation-line-wrapper">
          <SituationSummary
            summary={{
              level: summaryData.level,
              speed: summaryData.speed,
              advice: summaryData.advice,
            }}
            radarData={summaryData.radarData}
          />
          <SituationLine data={summaryData.monthlyAccuracy} />
          <SituationDashboard
            data={summaryData.accuracyByType}
            typeRatio={summaryData.questionTypeDistribution}
          />
        </div>
      ) : (
        <div className="no-data-box">尚無答題紀錄</div>
      )}
    </div>
  );
};

export default Situation;
