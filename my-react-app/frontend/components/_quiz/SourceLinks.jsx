import PropTypes from "prop-types";
import { cleanSources } from "../../utils/cleanSources";

// 官方網站查證（路線圖 #19）：文化背景的回答引用了哪些官方網頁。回覆內文不含連結，來源統一顯示在這裡。
const SourceLinks = ({ sources }) => {
    const valid = cleanSources(sources);
    if (valid.length === 0) return null;

    return (
        <div className="source-links" role="note">
            <p className="source-links-lead">資料來源（官方網站）</p>
            <ul>
                {valid.map((source) => (
                    <li key={source.url}>
                        <a
                            href={source.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`${source.title}，${source.host}（另開新分頁）`}
                        >
                            {source.title}
                        </a>
                        {source.title !== source.host && <span className="source-links-host">{source.host}</span>}
                    </li>
                ))}
            </ul>
        </div>
    );
};

SourceLinks.propTypes = {
    sources: PropTypes.arrayOf(PropTypes.shape({
        title: PropTypes.string,
        url: PropTypes.string,
    })),
};

export default SourceLinks;
