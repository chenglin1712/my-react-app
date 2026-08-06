import { Button, Form } from 'react-bootstrap';
import {
    ArrowDown,
    ArrowUp,
    FileAudio,
    Plus,
    Trash2,
} from 'lucide-react';
import MediaUploadField from './MediaUploadField';
import WordPicker from './WordPicker';

const emptyAudio = () => ({
    id: null,
    external_id: '',
    file_id: '',
    audio_class: '',
});

const emptyAnaphora = () => ({
    id: null,
    is_highlight: false,
    is_symbol: false,
    items: [],
});

const emptyAnaphoraItem = () => ({
    id: null,
    name: '',
    word_id: null,
    word_name: null,
});

export default function WordEditorSentence({
    sentence,
    path,
    index,
    count,
    tribeId,
    disabled,
    update,
    addChild,
    removeChild,
    moveChild,
}) {
    const sentencePath = [
        ...path,
        {
            field: 'sentences',
            key: sentence._key,
        },
    ];

    return (
        <section className="dictionary-nested-card dictionary-sentence-card">
            <div className="dictionary-nested-heading">
                <h4>例句 {index + 1}</h4>

                {!disabled && (
                    <div className="dictionary-row-actions">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline-secondary"
                            disabled={index === 0}
                            aria-label={`上移例句 ${index + 1}`}
                            onClick={() => moveChild(
                                path,
                                'sentences',
                                sentence._key,
                                -1,
                            )}
                        >
                            <ArrowUp size={15} />
                        </Button>

                        <Button
                            type="button"
                            size="sm"
                            variant="outline-secondary"
                            disabled={index === count - 1}
                            aria-label={`下移例句 ${index + 1}`}
                            onClick={() => moveChild(
                                path,
                                'sentences',
                                sentence._key,
                                1,
                            )}
                        >
                            <ArrowDown size={15} />
                        </Button>

                        <Button
                            type="button"
                            size="sm"
                            variant="outline-danger"
                            onClick={() => removeChild(
                                path,
                                'sentences',
                                sentence._key,
                            )}
                        >
                            <Trash2 size={15} />
                            刪除例句
                        </Button>
                    </div>
                )}
            </div>

            <Form.Group
                className="dictionary-field"
                controlId={`sentence-original-${sentence._key}`}
            >
                <Form.Label>原文</Form.Label>
                <Form.Control
                    as="textarea"
                    rows={2}
                    disabled={disabled}
                    value={sentence.original_sentence}
                    onChange={(event) => update(sentencePath, {
                        original_sentence: event.target.value,
                    })}
                />
            </Form.Group>

            <div className="dictionary-form-grid">
                <Form.Group
                    className="dictionary-field"
                    controlId={`sentence-chinese-${sentence._key}`}
                >
                    <Form.Label>中譯</Form.Label>
                    <Form.Control
                        as="textarea"
                        rows={2}
                        disabled={disabled}
                        value={sentence.chinese_sentence}
                        onChange={(event) => update(sentencePath, {
                            chinese_sentence: event.target.value,
                        })}
                    />
                </Form.Group>

                <Form.Group
                    className="dictionary-field"
                    controlId={`sentence-english-${sentence._key}`}
                >
                    <Form.Label>英譯</Form.Label>
                    <Form.Control
                        as="textarea"
                        rows={2}
                        disabled={disabled}
                        value={sentence.english_sentence}
                        onChange={(event) => update(sentencePath, {
                            english_sentence: event.target.value,
                        })}
                    />
                </Form.Group>
            </div>

            <div className="dictionary-child-section">
                <div className="dictionary-child-heading">
                    <h5>例句音檔</h5>
                    {!disabled && (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline-primary"
                            onClick={() => addChild(
                                sentencePath,
                                'audios',
                                emptyAudio,
                            )}
                        >
                            <FileAudio size={15} />
                            新增例句音檔
                        </Button>
                    )}
                </div>

                {sentence.audios.length === 0 && (
                    <p className="dictionary-empty-note">尚未新增音檔。</p>
                )}

                {sentence.audios.map((audio, audioIndex) => {
                    const audioPath = [
                        ...sentencePath,
                        {
                            field: 'audios',
                            key: audio._key,
                        },
                    ];

                    return (
                        <div
                            className="dictionary-media-row"
                            key={audio._key}
                        >
                            <MediaUploadField
                                kind="audio"
                                label={`例句音檔 ${audioIndex + 1}`}
                                value={audio.file_id}
                                disabled={disabled}
                                onChange={(fileId) => update(audioPath, {
                                    file_id: fileId,
                                })}
                            />

                            <Form.Group
                                className="dictionary-field"
                                controlId={`sentence-audio-class-${audio._key}`}
                            >
                                <Form.Label>音檔分類</Form.Label>
                                <Form.Control
                                    disabled={disabled}
                                    value={audio.audio_class}
                                    onChange={(event) => update(audioPath, {
                                        audio_class: event.target.value,
                                    })}
                                />
                            </Form.Group>

                            {!disabled && (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline-danger"
                                    onClick={() => removeChild(
                                        sentencePath,
                                        'audios',
                                        audio._key,
                                    )}
                                >
                                    <Trash2 size={15} />
                                    刪除音檔
                                </Button>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="dictionary-child-section">
                <div className="dictionary-child-heading">
                    <h5>標註</h5>
                    {!disabled && (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline-primary"
                            onClick={() => addChild(
                                sentencePath,
                                'anaphoras',
                                emptyAnaphora,
                            )}
                        >
                            <Plus size={15} />
                            新增標註
                        </Button>
                    )}
                </div>

                {sentence.anaphoras.length === 0 && (
                    <p className="dictionary-empty-note">尚未新增標註。</p>
                )}

                {sentence.anaphoras.map((anaphora, anaphoraIndex) => {
                    const anaphoraPath = [
                        ...sentencePath,
                        {
                            field: 'anaphoras',
                            key: anaphora._key,
                        },
                    ];

                    return (
                        <section
                            className="dictionary-anaphora-card"
                            key={anaphora._key}
                        >
                            <div className="dictionary-child-heading">
                                <h6>標註 {anaphoraIndex + 1}</h6>

                                {!disabled && (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline-danger"
                                        onClick={() => removeChild(
                                            sentencePath,
                                            'anaphoras',
                                            anaphora._key,
                                        )}
                                    >
                                        <Trash2 size={15} />
                                        刪除標註
                                    </Button>
                                )}
                            </div>

                            <div className="dictionary-inline-checks">
                                <Form.Check
                                    id={`anaphora-highlight-${anaphora._key}`}
                                    type="checkbox"
                                    label="醒目標示"
                                    disabled={disabled}
                                    checked={anaphora.is_highlight}
                                    onChange={(event) => update(anaphoraPath, {
                                        is_highlight: event.target.checked,
                                    })}
                                />

                                <Form.Check
                                    id={`anaphora-symbol-${anaphora._key}`}
                                    type="checkbox"
                                    label="符號"
                                    disabled={disabled}
                                    checked={anaphora.is_symbol}
                                    onChange={(event) => update(anaphoraPath, {
                                        is_symbol: event.target.checked,
                                    })}
                                />
                            </div>

                            <div className="dictionary-child-heading">
                                <strong>標註項目</strong>

                                {!disabled && (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline-primary"
                                        onClick={() => addChild(
                                            anaphoraPath,
                                            'items',
                                            emptyAnaphoraItem,
                                        )}
                                    >
                                        <Plus size={15} />
                                        新增標註項目
                                    </Button>
                                )}
                            </div>

                            {anaphora.items.length === 0 && (
                                <p className="dictionary-empty-note">
                                    尚未新增標註項目。
                                </p>
                            )}

                            {anaphora.items.map((item, itemIndex) => {
                                const itemPath = [
                                    ...anaphoraPath,
                                    {
                                        field: 'items',
                                        key: item._key,
                                    },
                                ];

                                return (
                                    <div
                                        className="dictionary-anaphora-item"
                                        key={item._key}
                                    >
                                        <Form.Group
                                            className="dictionary-field"
                                            controlId={`anaphora-item-name-${item._key}`}
                                        >
                                            <Form.Label>
                                                項目文字 {itemIndex + 1}
                                            </Form.Label>
                                            <Form.Control
                                                disabled={disabled}
                                                value={item.name}
                                                onChange={(event) => update(
                                                    itemPath,
                                                    { name: event.target.value },
                                                )}
                                            />
                                        </Form.Group>

                                        <WordPicker
                                            tribeId={tribeId}
                                            wordId={item.word_id}
                                            wordName={item.word_name ?? ''}
                                            disabled={disabled}
                                            label={`連結詞條 ${itemIndex + 1}`}
                                            onSelect={({
                                                word_id: wordId,
                                                word_name: wordName,
                                            }) => update(itemPath, {
                                                word_id: wordId,
                                                word_name: wordName,
                                            })}
                                        />

                                        <div className="dictionary-linked-word">
                                            <span>已選詞條</span>
                                            {item.word_id ? (
                                                <strong>
                                                    {item.word_name || item.word_id}
                                                </strong>
                                            ) : (
                                                <span className="dictionary-unlinked">
                                                    未連結
                                                </span>
                                            )}
                                        </div>

                                        {!disabled && (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="outline-danger"
                                                onClick={() => removeChild(
                                                    anaphoraPath,
                                                    'items',
                                                    item._key,
                                                )}
                                            >
                                                <Trash2 size={15} />
                                                刪除項目
                                            </Button>
                                        )}
                                    </div>
                                );
                            })}
                        </section>
                    );
                })}
            </div>
        </section>
    );
}
