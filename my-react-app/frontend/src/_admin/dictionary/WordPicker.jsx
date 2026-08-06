import {
    useEffect,
    useId,
    useRef,
    useState,
} from 'react';
import { Form, Spinner } from 'react-bootstrap';
import { Link2, Search } from 'lucide-react';
import { listWords } from './dictionaryApi';

const DEBOUNCE_MS = 300;

export default function WordPicker({
    tribeId,
    onSelect,
    wordId = null,
    wordName = '',
    disabled = false,
    label = '連結詞條',
}) {
    const inputId = useId();
    const requestSequence = useRef(0);
    const [query, setQuery] = useState(wordName || '');
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [open, setOpen] = useState(false);

    useEffect(() => {
        setQuery(wordName || '');
    }, [wordId, wordName]);

    useEffect(() => {
        const keyword = query.trim();

        if (
            disabled
            || !tribeId
            || !keyword
            || (wordId && keyword === wordName)
        ) {
            requestSequence.current += 1;
            setResults([]);
            setLoading(false);
            setOpen(false);
            return undefined;
        }

        const sequence = requestSequence.current + 1;
        requestSequence.current = sequence;

        const timeout = window.setTimeout(async () => {
            setLoading(true);
            setError('');

            try {
                const response = await listWords({
                    tribe_id: tribeId,
                    keyword,
                    page: 1,
                    page_size: 20,
                });

                if (requestSequence.current !== sequence) return;

                setResults(response.results ?? []);
                setOpen(true);
            } catch (err) {
                if (requestSequence.current !== sequence) return;

                setResults([]);
                setOpen(false);
                setError(err.message);
            } finally {
                if (requestSequence.current === sequence) {
                    setLoading(false);
                }
            }
        }, DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timeout);
        };
    }, [
        disabled,
        query,
        tribeId,
        wordId,
        wordName,
    ]);

    const chooseWord = (word) => {
        requestSequence.current += 1;
        setQuery(word.name);
        setResults([]);
        setOpen(false);
        setError('');

        onSelect({
            word_id: word.id,
            word_name: word.name,
        });
    };

    const changeQuery = (event) => {
        const nextQuery = event.target.value;

        setQuery(nextQuery);
        setError('');
        setOpen(Boolean(nextQuery.trim()));

        /*
         * 使用者修改已選詞條的顯示文字時，原本的 word_id 不能繼續
         * 留在 payload，否則畫面顯示 A、實際卻仍連到 B。
         */
        if (wordId) {
            onSelect({
                word_id: null,
                word_name: null,
            });
        }
    };

    return (
        <div className="dictionary-word-picker">
            <Form.Label htmlFor={inputId}>{label}</Form.Label>

            <div className="dictionary-word-picker-input">
                <Search size={17} aria-hidden="true" />
                <Form.Control
                    id={inputId}
                    value={query}
                    autoComplete="off"
                    disabled={disabled || !tribeId}
                    placeholder={
                        tribeId
                            ? '輸入詞形前綴搜尋'
                            : '請先選擇族語'
                    }
                    onChange={changeQuery}
                    onFocus={() => {
                        if (results.length > 0) setOpen(true);
                    }}
                    aria-autocomplete="list"
                    aria-expanded={open}
                    aria-controls={`${inputId}-results`}
                />

                {loading && (
                    <Spinner
                        animation="border"
                        size="sm"
                        aria-label="搜尋詞條中"
                    />
                )}
            </div>

            {wordId && (
                <div className="dictionary-word-picker-selection">
                    <Link2 size={14} aria-hidden="true" />
                    已連結：{wordName || wordId}
                </div>
            )}

            {error && (
                <div
                    className="dictionary-word-picker-error"
                    role="alert"
                >
                    {error}
                </div>
            )}

            {open && !loading && (
                <div
                    id={`${inputId}-results`}
                    className="dictionary-word-picker-results"
                    role="listbox"
                >
                    {results.length > 0 ? (
                        results.map((word) => (
                            <button
                                key={word.id}
                                type="button"
                                role="option"
                                aria-selected={word.id === wordId}
                                className="dictionary-word-picker-option"
                                /*
                                 * 用 onMouseDown 可在輸入框 blur 前完成選取，
                                 * 避免候選清單先關閉而吞掉 click。
                                 */
                                onMouseDown={(event) => {
                                    event.preventDefault();
                                    chooseWord(word);
                                }}
                            >
                                <strong>{word.name}</strong>
                                {word.dialect && <span>{word.dialect}</span>}
                                {word.pinyin && <small>{word.pinyin}</small>}
                            </button>
                        ))
                    ) : (
                        <div className="dictionary-word-picker-empty">
                            找不到符合的詞條
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
