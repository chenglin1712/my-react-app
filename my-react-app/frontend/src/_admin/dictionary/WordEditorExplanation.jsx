import { Button, Form } from 'react-bootstrap';
import {
    ArrowDown,
    ArrowUp,
    ImagePlus,
    Plus,
    Trash2,
} from 'lucide-react';
import MediaUploadField from './MediaUploadField';
import WordEditorSentence from './WordEditorSentence';

const emptyImage = () => ({
    id: null,
    image_url: '',
});

export const emptySentence = () => ({
    id: null,
    external_id: '',
    original_sentence: '',
    chinese_sentence: '',
    english_sentence: '',
    audios: [],
    anaphoras: [],
});

function TaxonomyChecks({
    legend,
    values,
    options,
    disabled,
    onChange,
}) {
    const toggle = (id) => {
        onChange(
            values.includes(id)
                ? values.filter((value) => value !== id)
                : [...values, id],
        );
    };

    return (
        <fieldset
            className="dictionary-taxonomy-field"
            disabled={disabled}
        >
            <legend>{legend}</legend>
            <div className="dictionary-checkbox-grid">
                {options.length > 0 ? options.map((option) => (
                    <Form.Check
                        key={option.id}
                        id={`${legend}-${option.id}`}
                        type="checkbox"
                        label={option.name}
                        checked={values.includes(option.id)}
                        onChange={() => toggle(option.id)}
                    />
                )) : (
                    <span className="dictionary-muted">沒有可選項目</span>
                )}
            </div>
        </fieldset>
    );
}

export default function WordEditorExplanation({
    explanation,
    path,
    index,
    count,
    tribeId,
    taxonomies,
    disabled,
    update,
    addChild,
    removeChild,
    moveChild,
}) {
    const explanationPath = [
        ...path,
        {
            field: 'explanations',
            key: explanation._key,
        },
    ];

    return (
        <section className="dictionary-nested-card dictionary-explanation-card">
            <div className="dictionary-nested-heading">
                <h2>解釋 {index + 1}</h2>

                {!disabled && (
                    <div className="dictionary-row-actions">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline-secondary"
                            disabled={index === 0}
                            aria-label={`上移解釋 ${index + 1}`}
                            onClick={() => moveChild(
                                path,
                                'explanations',
                                explanation._key,
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
                            aria-label={`下移解釋 ${index + 1}`}
                            onClick={() => moveChild(
                                path,
                                'explanations',
                                explanation._key,
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
                                'explanations',
                                explanation._key,
                            )}
                        >
                            <Trash2 size={15} />
                            刪除解釋
                        </Button>
                    </div>
                )}
            </div>

            <div className="dictionary-form-grid">
                <Form.Group
                    className="dictionary-field"
                    controlId={`explanation-chinese-${explanation._key}`}
                >
                    <Form.Label>中文解釋</Form.Label>
                    <Form.Control
                        as="textarea"
                        rows={3}
                        disabled={disabled}
                        value={explanation.chinese_explanation}
                        onChange={(event) => update(explanationPath, {
                            chinese_explanation: event.target.value,
                        })}
                    />
                </Form.Group>

                <Form.Group
                    className="dictionary-field"
                    controlId={`explanation-english-${explanation._key}`}
                >
                    <Form.Label>英文解釋</Form.Label>
                    <Form.Control
                        as="textarea"
                        rows={3}
                        disabled={disabled}
                        value={explanation.english_explanation}
                        onChange={(event) => update(explanationPath, {
                            english_explanation: event.target.value,
                        })}
                    />
                </Form.Group>
            </div>

            <div className="dictionary-taxonomy-grid">
                <TaxonomyChecks
                    legend={`分類（解釋 ${index + 1}）`}
                    values={explanation.category_ids}
                    options={taxonomies.category}
                    disabled={disabled}
                    onChange={(categoryIds) => update(explanationPath, {
                        category_ids: categoryIds,
                    })}
                />

                <TaxonomyChecks
                    legend={`詞類（解釋 ${index + 1}）`}
                    values={explanation.pos_ids}
                    options={taxonomies.part_of_speech}
                    disabled={disabled}
                    onChange={(posIds) => update(explanationPath, {
                        pos_ids: posIds,
                    })}
                />

                <TaxonomyChecks
                    legend={`焦點（解釋 ${index + 1}）`}
                    values={explanation.focus_ids}
                    options={taxonomies.focus}
                    disabled={disabled}
                    onChange={(focusIds) => update(explanationPath, {
                        focus_ids: focusIds,
                    })}
                />
            </div>

            <div className="dictionary-child-section">
                <div className="dictionary-child-heading">
                    <h3>解釋圖片</h3>
                    {!disabled && (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline-primary"
                            onClick={() => addChild(
                                explanationPath,
                                'images',
                                emptyImage,
                            )}
                        >
                            <ImagePlus size={15} />
                            新增圖片
                        </Button>
                    )}
                </div>

                {explanation.images.length === 0 && (
                    <p className="dictionary-empty-note">尚未新增圖片。</p>
                )}

                {explanation.images.map((image, imageIndex) => {
                    const imagePath = [
                        ...explanationPath,
                        {
                            field: 'images',
                            key: image._key,
                        },
                    ];

                    return (
                        <div
                            className="dictionary-media-row"
                            key={image._key}
                        >
                            <MediaUploadField
                                kind="image"
                                label={`解釋圖片 ${imageIndex + 1}`}
                                value={image.image_url}
                                disabled={disabled}
                                onChange={(imageUrl) => update(imagePath, {
                                    image_url: imageUrl,
                                })}
                            />

                            {!disabled && (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="outline-danger"
                                    onClick={() => removeChild(
                                        explanationPath,
                                        'images',
                                        image._key,
                                    )}
                                >
                                    <Trash2 size={15} />
                                    刪除圖片
                                </Button>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="dictionary-child-section">
                <div className="dictionary-child-heading">
                    <h3>例句</h3>
                    {!disabled && (
                        <Button
                            type="button"
                            size="sm"
                            variant="outline-primary"
                            onClick={() => addChild(
                                explanationPath,
                                'sentences',
                                emptySentence,
                            )}
                        >
                            <Plus size={15} />
                            新增例句
                        </Button>
                    )}
                </div>

                {explanation.sentences.length === 0 && (
                    <p className="dictionary-empty-note">尚未新增例句。</p>
                )}

                {explanation.sentences.map((sentence, sentenceIndex) => (
                    <WordEditorSentence
                        key={sentence._key}
                        sentence={sentence}
                        path={explanationPath}
                        index={sentenceIndex}
                        count={explanation.sentences.length}
                        tribeId={tribeId}
                        disabled={disabled}
                        update={update}
                        addChild={addChild}
                        removeChild={removeChild}
                        moveChild={moveChild}
                    />
                ))}
            </div>
        </section>
    );
}
