import "../../static/css/_home/calendar.css"
import DateReminder from "./dateReminder"

const Template = ({ examInfo }) => {
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
                            examInfo.map((item, index) => (
                                <div className="exam-card" key={index}>
                                    <div className="exam-card-header">
                                        <span className="exam-date">{item.start_date}</span>
                                    </div>
                                    <div className="exam-card-body">
                                        <a
                                            href={item.detail}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="exam-link"
                                        >
                                            {item.title}
                                        </a>
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
export default Template;