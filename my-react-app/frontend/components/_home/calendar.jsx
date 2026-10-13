import "../../static/css/_home/calendar.css"
import DateReminder from "./dateReminder"
import ExternalLink from "../ui/ExternalLink"

const CertificationSection = ({ examInfo }) => {
    return (
        <div className="secWrap-half">
            <div className="secRow">

                <div className="cleft-half">
                    <div className="mt-4">
                        <DateReminder />
                    </div>
                </div>

                <div className="cright-half">
                    <div className="exam-section">
                        <h2 className="exam-title">族語認證最新公告</h2>
                        {examInfo.length === 0 ? (
                            <p>目前沒有任何公告。</p>
                        ) : (
                            examInfo.map((item) => (
                                <div className="exam-card" key={item.id}>
                                    <div className="exam-card-header">
                                        <span className="exam-date">{item.start_date}</span>
                                    </div>
                                    <div className="exam-card-body">
                                        <ExternalLink href={item.detail} className="exam-link">
                                            {item.title}
                                        </ExternalLink>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
export default CertificationSection;