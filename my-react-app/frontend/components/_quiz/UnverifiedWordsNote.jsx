import PropTypes from "prop-types";
import { Fragment } from "react";
import { dictionaryHref } from "../../utils/dictionaryLink";

// 回覆後的族語詞驗證（路線圖 #18）：回覆裡有辭典查無的詞形時，在回覆下方提醒。
// 措辭只說「查無此詞形」，不說「這是錯的」：詞形變化、人名、借詞都可能不在辭典裡。回覆本身不會被改動。
const UnverifiedWordsNote = ({ words, tribe }) => {
    const valid = (Array.isArray(words) ? words : []).filter((w) => typeof w === "string" && w);
    if (valid.length === 0) return null;

    return (
        <p className="unverified-note" role="note">
            <span className="unverified-note-lead">辭典查無此詞形：</span>
            {valid.map((word, index) => (
                <Fragment key={word}>
                    {index > 0 && "、"}
                    <a
                        href={dictionaryHref(word, tribe)}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`在辭典查看「${word}」（另開新分頁）`}
                    >
                        {word}
                    </a>
                </Fragment>
            ))}
            。可能是詞形變化、人名或拼寫有誤，請再查辭典或請教老師。
        </p>
    );
};

UnverifiedWordsNote.propTypes = {
    words: PropTypes.arrayOf(PropTypes.string),
    tribe: PropTypes.string.isRequired,
};

export default UnverifiedWordsNote;
