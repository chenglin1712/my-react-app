import { Form } from 'react-bootstrap';

import MediaUploadField from './MediaUploadField';

/**
 * 詞條的基本欄位區塊（FE-7，原本 inline 寫在 WordEditor.jsx 的表單裡）。
 *
 * 純呈現：所有值都來自 tree、所有修改都透過 updateRoot／toggleSource 往上
 * 回報，這裡不持有任何狀態、也不知道任何 API。抽出來的理由不是「行數太多」，
 * 而是這一整塊只關心「詞條本身的欄位長什麼樣」，跟外層的載入/儲存/送審流程
 * 是兩件不同的事，混在同一個函式裡會讓兩邊都難讀。
 */
export default function WordBasicFields({
    tree,
    updateRoot,
    editable,
    taxonomies,
    toggleSource,
}) {
    return (
        <>
                <div className="dictionary-form-grid">
                    <Form.Group
                        className="dictionary-field"
                        controlId="dictionary-word-tribe"
                    >
                        <Form.Label>
                            族語 <span className="required-mark">*</span>
                        </Form.Label>
                        <Form.Select
                            required
                            disabled={!editable}
                            value={tree.tribe_id}
                            onChange={(event) => updateRoot(
                                'tribe_id',
                                event.target.value,
                            )}
                        >
                            <option value="">請選擇族語</option>
                            {taxonomies.tribes.map((tribe) => (
                                <option key={tribe.id} value={tribe.id}>
                                    {tribe.name}
                                </option>
                            ))}
                        </Form.Select>
                    </Form.Group>

                    <Form.Group
                        className="dictionary-field"
                        controlId="dictionary-word-name"
                    >
                        <Form.Label>
                            詞形 <span className="required-mark">*</span>
                        </Form.Label>
                        <Form.Control
                            required
                            disabled={!editable}
                            value={tree.name}
                            onChange={(event) => updateRoot(
                                'name',
                                event.target.value,
                            )}
                        />
                    </Form.Group>

                    <Form.Group
                        className="dictionary-field"
                        controlId="dictionary-word-dialect"
                    >
                        <Form.Label>方言別</Form.Label>
                        <Form.Control
                            disabled={!editable}
                            value={tree.dialect}
                            onChange={(event) => updateRoot(
                                'dialect',
                                event.target.value,
                            )}
                        />
                    </Form.Group>

                    <Form.Group
                        className="dictionary-field"
                        controlId="dictionary-word-pinyin"
                    >
                        <Form.Label>拼音</Form.Label>
                        <Form.Control
                            disabled={!editable}
                            value={tree.pinyin}
                            onChange={(event) => updateRoot(
                                'pinyin',
                                event.target.value,
                            )}
                        />
                    </Form.Group>

                    <Form.Group
                        className="dictionary-field"
                        controlId="dictionary-word-variant"
                    >
                        <Form.Label>變體</Form.Label>
                        <Form.Control
                            disabled={!editable}
                            value={tree.variant}
                            onChange={(event) => updateRoot(
                                'variant',
                                event.target.value,
                            )}
                        />
                    </Form.Group>

                    <Form.Group
                        className="dictionary-field"
                        controlId="dictionary-word-formation"
                    >
                        <Form.Label>構詞</Form.Label>
                        <Form.Control
                            disabled={!editable}
                            value={tree.formation_word}
                            onChange={(event) => updateRoot(
                                'formation_word',
                                event.target.value,
                            )}
                        />
                    </Form.Group>

                    <Form.Group
                        className="dictionary-field"
                        controlId="dictionary-word-derivative-root"
                    >
                        <Form.Label>衍生詞根</Form.Label>
                        <Form.Control
                            disabled={!editable}
                            value={tree.derivative_root}
                            onChange={(event) => updateRoot(
                                'derivative_root',
                                event.target.value,
                            )}
                        />
                    </Form.Group>

                    <Form.Group
                        className="dictionary-field"
                        controlId="dictionary-word-frequency"
                    >
                        <Form.Label>詞頻</Form.Label>
                        <Form.Control
                            type="number"
                            min="0"
                            disabled={!editable}
                            value={tree.frequency}
                            onChange={(event) => updateRoot(
                                'frequency',
                                event.target.value,
                            )}
                        />
                    </Form.Group>
                </div>

                <Form.Group
                    className="dictionary-field"
                    controlId="dictionary-word-note"
                >
                    <Form.Label>辭典備註</Form.Label>
                    <Form.Control
                        as="textarea"
                        rows={4}
                        disabled={!editable}
                        value={tree.dictionary_note}
                        onChange={(event) => updateRoot(
                            'dictionary_note',
                            event.target.value,
                        )}
                    />
                </Form.Group>

                <MediaUploadField
                    kind="image"
                    label="詞條圖片"
                    value={tree.word_img}
                    disabled={!editable}
                    onChange={(wordImg) => updateRoot(
                        'word_img',
                        wordImg,
                    )}
                />

                <fieldset
                    className="dictionary-field"
                    disabled={!editable}
                >
                    <legend>詞條屬性</legend>
                    <div className="dictionary-inline-checks">
                        <Form.Check
                            id="dictionary-is-derivative-root"
                            type="checkbox"
                            label="衍生詞根"
                            checked={tree.is_derivative_root}
                            onChange={(event) => updateRoot(
                                'is_derivative_root',
                                event.target.checked,
                            )}
                        />
                        <Form.Check
                            id="dictionary-is-image"
                            type="checkbox"
                            label="圖像詞條"
                            checked={tree.is_image}
                            onChange={(event) => updateRoot(
                                'is_image',
                                event.target.checked,
                            )}
                        />
                        <Form.Check
                            id="dictionary-is-zuzucidian"
                            type="checkbox"
                            label="族語辭典詞條"
                            checked={tree.is_zuzucidian}
                            onChange={(event) => updateRoot(
                                'is_zuzucidian',
                                event.target.checked,
                            )}
                        />
                        <Form.Check
                            id="dictionary-is-other-dialect"
                            type="checkbox"
                            label="其他方言"
                            checked={tree.is_other_dialect}
                            onChange={(event) => updateRoot(
                                'is_other_dialect',
                                event.target.checked,
                            )}
                        />
                    </div>
                </fieldset>

                <fieldset
                    className="dictionary-taxonomy-field"
                    disabled={!editable}
                >
                    <legend>資料來源</legend>
                    <div className="dictionary-checkbox-grid">
                        {taxonomies.source.map((source) => (
                            <Form.Check
                                key={source.id}
                                id={`dictionary-source-${source.id}`}
                                type="checkbox"
                                label={source.name}
                                checked={tree.source_ids.includes(source.id)}
                                onChange={() => toggleSource(source.id)}
                            />
                        ))}
                    </div>
                </fieldset>
        </>
    );
}
