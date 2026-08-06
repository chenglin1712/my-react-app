"""P4 辭典管理的請求驗證。

詞條整棵樹是 6 層巢狀的 dict/list 結構，不是 Django model，沒有
ModelSerializer 可用。比照既有 QuizClozePassageSerializer.blanks 的做法
（那也是一個 JSONField，用 .validate() 手動檢查 dict 形狀，而不是疊一份
6 層深的巢狀 DRF Serializer）——這裡只做「形狀對不對、型別對不對、必填
有沒有帶」這種結構性檢查；taxonomy id 是否真的存在、標註連結的詞條是否
存在且同族語，這些需要查 dictionary_db 的深層驗證留給
dictionary_write.apply_word_tree() 在真正寫入時做（見該檔案說明：核准
是唯一真正動到 dictionary_db 的時機，深層驗證天生就需要一次資料庫往返，
不值得為了「送審前先驗證」另外做一套 dry-run 機制）。
"""
from rest_framework import serializers

from config.grammar_affixes import VALID_AFFIX_TYPES


def _require_str(value, field, errors, allow_blank=False, required=True):
    if value is None:
        if required:
            errors[field] = '為必填'
        return
    if not isinstance(value, str):
        errors[field] = '必須是字串'
    elif not allow_blank and not value.strip():
        errors[field] = '不能空白'


def _require_list(value, field, errors):
    if value is not None and not isinstance(value, list):
        errors[field] = '必須是陣列'
        return False
    return True


def _require_int_id_list(value, field, errors):
    """給 category_ids／pos_ids／focus_ids／source_ids／affix_ids 這種
    「主檔 id 陣列」共用——只檢查是陣列還不夠，元素型別不對（例如字串）會
    一路撐過結構檢查，撐到 dictionary_write.py 對整數欄位下 `IN` 查詢時才
    被資料庫拒絕，變成沒被攔住的未預期例外而不是乾淨的 400（codex 獨立
    審查抓到的缺口）。`bool` 特別排除是因為 Python 的 `isinstance(True, int)`
    是 `True`，一個誤傳的布林值不該被這裡放行當成合法 id。"""
    if not _require_list(value, field, errors):
        return
    for index, item in enumerate(value or []):
        if isinstance(item, bool) or not isinstance(item, int):
            errors[f'{field}[{index}]'] = '必須是整數'


def _validate_anaphora_item(item, index, errors_prefix, errors):
    if not isinstance(item, dict):
        errors[f'{errors_prefix}[{index}]'] = '格式錯誤'
        return
    if 'word_id' in item and item['word_id'] is not None and not isinstance(item['word_id'], str):
        errors[f'{errors_prefix}[{index}].word_id'] = '必須是字串或 null'
    _require_str(item.get('name'), f'{errors_prefix}[{index}].name', errors, allow_blank=True, required=False)


def _validate_anaphora(item, index, errors_prefix, errors):
    if not isinstance(item, dict):
        errors[f'{errors_prefix}[{index}]'] = '格式錯誤'
        return
    items = item.get('items', [])
    if not _require_list(items, f'{errors_prefix}[{index}].items', errors):
        return
    for i, sub in enumerate(items):
        _validate_anaphora_item(sub, i, f'{errors_prefix}[{index}].items', errors)


def _validate_sentence(item, index, errors_prefix, errors):
    if not isinstance(item, dict):
        errors[f'{errors_prefix}[{index}]'] = '格式錯誤'
        return
    _require_str(item.get('original_sentence'), f'{errors_prefix}[{index}].original_sentence',
                  errors, allow_blank=True, required=False)
    audios = item.get('audios', [])
    if _require_list(audios, f'{errors_prefix}[{index}].audios', errors):
        for i, audio in enumerate(audios):
            if not isinstance(audio, dict):
                errors[f'{errors_prefix}[{index}].audios[{i}]'] = '格式錯誤'
    anaphoras = item.get('anaphoras', [])
    if _require_list(anaphoras, f'{errors_prefix}[{index}].anaphoras', errors):
        for i, ana in enumerate(anaphoras):
            _validate_anaphora(ana, i, f'{errors_prefix}[{index}].anaphoras', errors)


def _validate_explanation(item, index, errors):
    prefix = f'explanations[{index}]'
    if not isinstance(item, dict):
        errors[prefix] = '格式錯誤'
        return
    _require_str(item.get('chinese_explanation'), f'{prefix}.chinese_explanation',
                  errors, allow_blank=True, required=False)
    for field in ('category_ids', 'pos_ids', 'focus_ids'):
        _require_int_id_list(item.get(field, []), f'{prefix}.{field}', errors)
    images = item.get('images', [])
    if _require_list(images, f'{prefix}.images', errors):
        for i, img in enumerate(images):
            if not isinstance(img, dict):
                errors[f'{prefix}.images[{i}]'] = '格式錯誤'
    sentences = item.get('sentences', [])
    if _require_list(sentences, f'{prefix}.sentences', errors):
        for i, sent in enumerate(sentences):
            _validate_sentence(sent, i, f'{prefix}.sentences', errors)


def validate_word_tree_payload(payload):
    """回傳 (cleaned_payload, errors)。errors 為空字典代表驗證通過。

    不用 DRF Serializer 是因為這個結構的巢狀深度跟「陣列裡每個元素的形狀
    因為子陣列而不同」使得宣告式的 Serializer 定義比手動遞迴檢查更難讀，
    也更難維護（跟 QuizClozePassageSerializer.blanks 選擇手動驗證的理由
    一致）。
    """
    errors = {}
    if not isinstance(payload, dict):
        return None, {'detail': '請求格式錯誤'}

    _require_str(payload.get('tribe_id'), 'tribe_id', errors)
    _require_str(payload.get('name'), 'name', errors)

    for field in ('dialect', 'pinyin', 'variant', 'formation_word', 'derivative_root',
                  'dictionary_note', 'word_img'):
        if field in payload and payload[field] is not None and not isinstance(payload[field], str):
            errors[field] = '必須是字串'

    if 'frequency' in payload and payload['frequency'] is not None and not isinstance(payload['frequency'], int):
        errors['frequency'] = '必須是整數'

    for field in ('is_derivative_root', 'is_image', 'is_zuzucidian', 'is_other_dialect'):
        if field in payload and payload[field] is not None and not isinstance(payload[field], bool):
            errors[field] = '必須是布林值'

    _require_int_id_list(payload.get('source_ids', []), 'source_ids', errors)

    audios = payload.get('audios', [])
    if _require_list(audios, 'audios', errors):
        for i, audio in enumerate(audios):
            if not isinstance(audio, dict):
                errors[f'audios[{i}]'] = '格式錯誤'

    explanations = payload.get('explanations', [])
    if _require_list(explanations, 'explanations', errors):
        for i, exp in enumerate(explanations):
            _validate_explanation(exp, i, errors)

    if errors:
        return None, errors
    return payload, {}


# ---------------------------------------------------------------------------
# 批次匯入（P4.4）：跟 validate_word_tree_payload 幾乎同一份形狀，差異只有
# 三處——(1) 頂層多一個選填的 `id`（有帶代表精準指定要更新哪一筆既有詞條，
# 不帶則由 dictionary_import.py 依詞形在同族語內比對）；(2) 分類主檔用
# `source_names`／`category_names`／`pos_names`／`focus_names`（人工編輯
# 檔案時不可能記得 category.id=7 是「植物」）；(3) 標註項目用 `word_name`
# 取代 `word_id`。其餘欄位（含每一層的巢狀 `id`）跟一般詞條樹 payload
# 完全相同語意，讓對帳邏輯（_reconcile_children）能正常運作——這是刻意
# 讓「匯出 → 手動編輯 → 重新匯入」不會每次都churn 掉全部子節點的 id。
# ---------------------------------------------------------------------------

def _validate_bundle_anaphora_item(item, index, errors_prefix, errors):
    if not isinstance(item, dict):
        errors[f'{errors_prefix}[{index}]'] = '格式錯誤'
        return
    _require_str(item.get('word_name'), f'{errors_prefix}[{index}].word_name', errors,
                  allow_blank=True, required=False)
    _require_str(item.get('name'), f'{errors_prefix}[{index}].name', errors, allow_blank=True, required=False)


def _validate_bundle_anaphora(item, index, errors_prefix, errors):
    if not isinstance(item, dict):
        errors[f'{errors_prefix}[{index}]'] = '格式錯誤'
        return
    items = item.get('items', [])
    if not _require_list(items, f'{errors_prefix}[{index}].items', errors):
        return
    for i, sub in enumerate(items):
        _validate_bundle_anaphora_item(sub, i, f'{errors_prefix}[{index}].items', errors)


def _validate_bundle_sentence(item, index, errors_prefix, errors):
    if not isinstance(item, dict):
        errors[f'{errors_prefix}[{index}]'] = '格式錯誤'
        return
    _require_str(item.get('original_sentence'), f'{errors_prefix}[{index}].original_sentence',
                  errors, allow_blank=True, required=False)
    audios = item.get('audios', [])
    if _require_list(audios, f'{errors_prefix}[{index}].audios', errors):
        for i, audio in enumerate(audios):
            if not isinstance(audio, dict):
                errors[f'{errors_prefix}[{index}].audios[{i}]'] = '格式錯誤'
    anaphoras = item.get('anaphoras', [])
    if _require_list(anaphoras, f'{errors_prefix}[{index}].anaphoras', errors):
        for i, ana in enumerate(anaphoras):
            _validate_bundle_anaphora(ana, i, f'{errors_prefix}[{index}].anaphoras', errors)


def _validate_bundle_explanation(item, index, errors):
    prefix = f'explanations[{index}]'
    if not isinstance(item, dict):
        errors[prefix] = '格式錯誤'
        return
    _require_str(item.get('chinese_explanation'), f'{prefix}.chinese_explanation',
                  errors, allow_blank=True, required=False)
    for field in ('category_names', 'pos_names', 'focus_names'):
        value = item.get(field, [])
        if value is not None and not isinstance(value, list):
            errors[f'{prefix}.{field}'] = '必須是陣列'
    images = item.get('images', [])
    if _require_list(images, f'{prefix}.images', errors):
        for i, img in enumerate(images):
            if not isinstance(img, dict):
                errors[f'{prefix}.images[{i}]'] = '格式錯誤'
    sentences = item.get('sentences', [])
    if _require_list(sentences, f'{prefix}.sentences', errors):
        for i, sent in enumerate(sentences):
            _validate_bundle_sentence(sent, i, f'{prefix}.sentences', errors)


def validate_word_bundle_entry(payload):
    """回傳 (cleaned_payload, errors)，形狀比照 validate_word_tree_payload
    的說明，差異見本節開頭註解。"""
    errors = {}
    if not isinstance(payload, dict):
        return None, {'detail': '格式錯誤'}

    if 'id' in payload and payload['id'] is not None and not isinstance(payload['id'], str):
        errors['id'] = '必須是字串或 null'
    _require_str(payload.get('name'), 'name', errors)

    for field in ('dialect', 'pinyin', 'variant', 'formation_word', 'derivative_root',
                  'dictionary_note', 'word_img'):
        if field in payload and payload[field] is not None and not isinstance(payload[field], str):
            errors[field] = '必須是字串'

    if 'frequency' in payload and payload['frequency'] is not None and not isinstance(payload['frequency'], int):
        errors['frequency'] = '必須是整數'

    for field in ('is_derivative_root', 'is_image', 'is_zuzucidian', 'is_other_dialect'):
        if field in payload and payload[field] is not None and not isinstance(payload[field], bool):
            errors[field] = '必須是布林值'

    source_names = payload.get('source_names', [])
    if source_names is not None and not isinstance(source_names, list):
        errors['source_names'] = '必須是陣列'

    audios = payload.get('audios', [])
    if _require_list(audios, 'audios', errors):
        for i, audio in enumerate(audios):
            if not isinstance(audio, dict):
                errors[f'audios[{i}]'] = '格式錯誤'

    explanations = payload.get('explanations', [])
    if _require_list(explanations, 'explanations', errors):
        for i, exp in enumerate(explanations):
            _validate_bundle_explanation(exp, i, errors)

    if errors:
        return None, errors
    return payload, {}


def validate_import_bundle_structure(data):
    """步驟一「上傳」的結構檢查：只確認 schema/version/tribe/words 的
    外層形狀，以及逐筆詞條呼叫 validate_word_bundle_entry() 做結構檢查
    （不查資料庫——查資料庫解析名稱/判斷新建或更新是預檢報告，也就是
    dictionary_import.resolve_import_bundle() 的工作）。

    回傳 (tribe_slug, words, row_errors)：row_errors 是 {row_index: errors}，
    非空詞條層級的錯誤不會擋掉上傳本身——匯入工作先建立起來，讓使用者
    在「檢視解析結果」步驟就能看到哪幾列結構有問題，不用重新上傳一次。
    只有最外層（schema/version/tribe/words 本身）有問題才會直接擋掉上傳。
    """
    if not isinstance(data, dict):
        return None, None, {'detail': '請求格式錯誤'}

    top_errors = {}
    if data.get('schema') != 'dictionary_word_bundle':
        top_errors['schema'] = '不支援的檔案格式（schema 必須是 "dictionary_word_bundle"）'
    if data.get('version') != 1:
        top_errors['version'] = '不支援的版本（目前僅支援 version 1）'
    _require_str(data.get('tribe'), 'tribe', top_errors)
    words = data.get('words')
    if not isinstance(words, list):
        top_errors['words'] = '必須是陣列'
    elif len(words) == 0:
        top_errors['words'] = '至少需要一筆詞條'

    if top_errors:
        return None, None, top_errors

    row_errors = {}
    for index, word in enumerate(words):
        _cleaned, errors = validate_word_bundle_entry(word)
        if errors:
            row_errors[index] = errors

    return data.get('tribe'), words, row_errors


def _validate_grammar_example(item, index, errors):
    prefix = f'examples[{index}]'
    if not isinstance(item, dict):
        errors[prefix] = '格式錯誤'
        return
    for field in ('tribe_text', 'chinese_text', 'analysis'):
        _require_str(item.get(field), f'{prefix}.{field}', errors, allow_blank=True, required=False)
    linked_words = item.get('linked_words', [])
    if _require_list(linked_words, f'{prefix}.linked_words', errors):
        for i, link in enumerate(linked_words):
            if not isinstance(link, dict):
                errors[f'{prefix}.linked_words[{i}]'] = '格式錯誤'
            elif 'word_id' in link and link['word_id'] is not None and not isinstance(link['word_id'], str):
                errors[f'{prefix}.linked_words[{i}].word_id'] = '必須是字串或 null'


def _validate_grammar_rule(item, index, errors):
    prefix = f'rules[{index}]'
    if not isinstance(item, dict):
        errors[prefix] = '格式錯誤'
        return
    for field in ('rule_key', 'title', 'structure', 'function', 'notes'):
        _require_str(item.get(field), f'{prefix}.{field}', errors, allow_blank=True, required=False)

    _require_int_id_list(item.get('affix_ids', []), f'{prefix}.affix_ids', errors)

    examples = item.get('examples', [])
    if _require_list(examples, f'{prefix}.examples', errors):
        for i, example in enumerate(examples):
            _validate_grammar_example(example, i, errors)


def validate_grammar_section_payload(payload):
    """跟 validate_word_tree_payload 同樣的理由手動遞迴驗證，不用 DRF
    Serializer——巢狀深度較淺（章節→規則→例句，3 層），但形狀邏輯是同一套。
    """
    errors = {}
    if not isinstance(payload, dict):
        return None, {'detail': '請求格式錯誤'}

    _require_str(payload.get('tribe_id'), 'tribe_id', errors)
    _require_str(payload.get('title'), 'title', errors)

    for field in ('section_key', 'description'):
        _require_str(payload.get(field), field, errors, allow_blank=True, required=False)

    rules = payload.get('rules', [])
    if _require_list(rules, 'rules', errors):
        for i, rule in enumerate(rules):
            _validate_grammar_rule(rule, i, errors)

    if errors:
        return None, errors
    return payload, {}


class DeleteProposalSerializer(serializers.Serializer):
    unlink_references = serializers.BooleanField(required=False, default=False)


class GrammarSectionReorderSerializer(serializers.Serializer):
    tribe_id = serializers.CharField()
    section_ids = serializers.ListField(child=serializers.IntegerField(), allow_empty=False)


class ApproveDictionaryRevisionSerializer(serializers.Serializer):
    review_comment = serializers.CharField(max_length=1000, allow_blank=True, required=False, default='')
    base_hash = serializers.CharField(max_length=71, allow_blank=True, required=False, default='')


# ---------------------------------------------------------------------------
# 主檔管理（P4.2）：source／category／part_of_speech／focus 只有一個 name
# 欄位，直接寫入不經送審（見規劃文件 P4 §4，這幾張是簡單 lookup 表，
# 危險操作是合併／刪除本身而非新增/改名，兩者各自有自己的防線）。
# ---------------------------------------------------------------------------

class TaxonomyTermSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=255, allow_blank=False, trim_whitespace=True)


class GrammarAffixCreateSerializer(serializers.Serializer):
    tribe_id = serializers.CharField(max_length=64)
    affix = serializers.CharField(max_length=255, allow_blank=False, trim_whitespace=True)
    affix_type = serializers.ChoiceField(choices=sorted(VALID_AFFIX_TYPES))
    function = serializers.CharField(allow_blank=True, required=False, default='')
    example_form = serializers.CharField(allow_blank=True, required=False, default='')


class GrammarAffixUpdateSerializer(serializers.Serializer):
    """tribe_id 刻意不開放更新，見 dictionary_write.update_taxonomy_term 的
    說明；每個欄位都 required=False，未帶到的鍵不會出現在 validated_data
    裡（DRF 對沒有 default 的 required=False 欄位的既有行為），達成
    「只更新有帶的欄位」的局部更新語意，不需要另外設 partial=True。"""
    affix = serializers.CharField(max_length=255, allow_blank=False, trim_whitespace=True, required=False)
    affix_type = serializers.ChoiceField(choices=sorted(VALID_AFFIX_TYPES), required=False)
    function = serializers.CharField(allow_blank=True, required=False)
    example_form = serializers.CharField(allow_blank=True, required=False)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError('至少需要帶一個要更新的欄位')
        return attrs


class TaxonomyMergeSerializer(serializers.Serializer):
    target_id = serializers.IntegerField()
