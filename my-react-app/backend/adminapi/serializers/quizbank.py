import re

from rest_framework import serializers

from ..models import (
    QuizChoiceItem,
    QuizClozePassage,
    QuizSituationItem,
    QuizSourceConfig,
    QuizTrueFalseItem,
    QuizVocabItem,
)

# 題庫類內容（QuizVocabItem／QuizClozePassage／QuizSituationItem）共用的
# 送審流程欄位，三個 serializer 的 read_only_fields 都一樣——status 不開放
# 一般 create/update 直接寫入的理由跟 AnnouncementSerializer 完全相同：
# 不然 editor 可以自己把 status 設成 published，繞過核准流程。
_REVIEWABLE_READ_ONLY_FIELDS = [
    'id', 'status', 'created_by', 'submitted_by', 'submitted_at',
    'reviewed_by', 'reviewed_at', 'review_comment', 'created_at', 'updated_at',
]


class QuizVocabItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuizVocabItem
        fields = [
            'id', 'tribe', 'category', 'foreign_word', 'chinese_gloss', 'audio_file_id',
            'status', 'created_by', 'submitted_by', 'submitted_at',
            'reviewed_by', 'reviewed_at', 'review_comment', 'created_at', 'updated_at',
        ]
        read_only_fields = _REVIEWABLE_READ_ONLY_FIELDS

    def validate_foreign_word(self, value):
        if not value.strip():
            raise serializers.ValidationError('族語詞彙不能空白')
        return value

    def validate_chinese_gloss(self, value):
        if not value.strip():
            raise serializers.ValidationError('中文詞義不能空白')
        return value


class QuizClozePassageSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuizClozePassage
        fields = [
            'id', 'tribe', 'passage_foreign', 'passage_chinese', 'blanks',
            'status', 'created_by', 'submitted_by', 'submitted_at',
            'reviewed_by', 'reviewed_at', 'review_comment', 'created_at', 'updated_at',
        ]
        read_only_fields = _REVIEWABLE_READ_ONLY_FIELDS

    def validate(self, data):
        # model.clean() 也有一份一樣的檢查（見 models.py 的說明：確保未來
        # 就算繞過 serializer 直接用 ORM 操作也擋得住）；這裡在 API 層先擋一次，
        # 讓錯誤能回傳成一般的 400 + 欄位訊息，而不是 model.clean() 丟出的
        # ValidationError 一路往外拋變成 500。標記檢查邏輯（雙向比對＋重複
        # 標記偵測）要跟 models.py 的 QuizClozePassage.clean() 保持一致，
        # 不然兩邊會漂移（獨立審查找到的問題就是原本這裡跟 model 各自只做
        # 單向檢查）。
        passage_foreign = data.get('passage_foreign', getattr(self.instance, 'passage_foreign', ''))
        blanks = data.get('blanks', getattr(self.instance, 'blanks', None))
        if not isinstance(blanks, dict) or not blanks:
            raise serializers.ValidationError({'blanks': '至少需要一個空格'})

        markers = re.findall(r'\{([^{}]+)\}', passage_foreign or '')
        marker_set = set(markers)
        blank_keys = set(blanks.keys())

        missing_in_passage = sorted(blank_keys - marker_set)
        if missing_in_passage:
            raise serializers.ValidationError({'passage_foreign': f'短文內容缺少對應的 {{{missing_in_passage[0]}}} 標記'})

        unknown_markers = sorted(marker_set - blank_keys)
        if unknown_markers:
            raise serializers.ValidationError({'passage_foreign': f'短文內容出現不在 blanks 裡的標記 {{{unknown_markers[0]}}}'})

        if len(markers) != len(marker_set):
            seen = set()
            duplicated = next(m for m in markers if m in seen or seen.add(m))
            raise serializers.ValidationError({'passage_foreign': f'標記 {{{duplicated}}} 在短文中重複出現'})

        for key, blank in blanks.items():
            if not isinstance(blank, dict):
                raise serializers.ValidationError({'blanks': f'{key} 格式錯誤'})
            options = blank.get('options')
            if not isinstance(options, list) or len(options) != 4:
                raise serializers.ValidationError({'blanks': f'{key} 的選項必須恰好 4 個'})
            answer = blank.get('answer')
            if not isinstance(answer, int) or not (1 <= answer <= 4):
                raise serializers.ValidationError({'blanks': f'{key} 的正解索引必須介於 1 到 4'})
        return data


class QuizSituationItemSerializer(serializers.ModelSerializer):
    # AI 產生的草稿才有（路線圖 #23）：來源詞條、模型、產生者與辭典查無的族語詞，供審核者檢查；人工建立的題目是 None
    ai_draft = serializers.SerializerMethodField()

    class Meta:
        model = QuizSituationItem
        fields = [
            'id', 'tribe', 'scenario_chinese', 'options', 'answer',
            'status', 'created_by', 'submitted_by', 'submitted_at',
            'reviewed_by', 'reviewed_at', 'review_comment', 'created_at', 'updated_at', 'ai_draft',
        ]
        read_only_fields = _REVIEWABLE_READ_ONLY_FIELDS

    def get_ai_draft(self, obj):
        from adminapi.models import AiQuizDraft

        if obj.pk is None:
            return None
        draft = AiQuizDraft.objects.filter(content_type='quiz_situation_item', content_id=obj.pk).first()
        if draft is None:
            return None
        return {
            'generated_by': draft.generated_by, 'generated_at': draft.generated_at.isoformat(),
            'model': draft.model, 'source_words': draft.source_words,
            'source_word_ids': draft.source_word_ids, 'unverified_words': draft.unverified_words,
        }

    def validate(self, data):
        options = data.get('options', getattr(self.instance, 'options', None))
        answer = data.get('answer', getattr(self.instance, 'answer', None))
        if not isinstance(options, list) or len(options) != 4:
            raise serializers.ValidationError({'options': '選項必須恰好 4 個'})
        if answer is None or not (1 <= answer <= 4):
            raise serializers.ValidationError({'answer': '正解索引必須介於 1 到 4'})
        return data


class QuizTrueFalseItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuizTrueFalseItem
        # origin_key 刻意不放進 fields——只有 migrate_quiz_level12_to_db 用
        # ORM 直接寫入，理由跟 Announcement.external_id 完全相同（見該欄位
        # 說明）：後台人員自建的新題項沒有這個鍵，若開放給 serializer，
        # 沒帶值時會送出預設值，第二筆存檔就會撞上 unique 約束。
        fields = [
            'id', 'tribe', 'question_ab', 'question_ch', 'audio_url', 'image_url', 'answer',
            'status', 'created_by', 'submitted_by', 'submitted_at',
            'reviewed_by', 'reviewed_at', 'review_comment', 'created_at', 'updated_at',
        ]
        read_only_fields = _REVIEWABLE_READ_ONLY_FIELDS

    def validate_question_ab(self, value):
        if not value.strip():
            raise serializers.ValidationError('族語句子不能空白')
        return value

    def validate_audio_url(self, value):
        if not value.strip():
            raise serializers.ValidationError('音檔網址不能空白')
        return value

    def validate_image_url(self, value):
        if not value.strip():
            raise serializers.ValidationError('圖片網址不能空白')
        return value


class QuizChoiceItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuizChoiceItem
        fields = [
            'id', 'tribe', 'question_ab', 'question_ch',
            'image_a_url', 'image_b_url', 'image_c_url', 'answer',
            'status', 'created_by', 'submitted_by', 'submitted_at',
            'reviewed_by', 'reviewed_at', 'review_comment', 'created_at', 'updated_at',
        ]
        read_only_fields = _REVIEWABLE_READ_ONLY_FIELDS

    def validate_question_ab(self, value):
        if not value.strip():
            raise serializers.ValidationError('族語句子不能空白')
        return value

    def validate(self, data):
        answer = data.get('answer', getattr(self.instance, 'answer', None))
        if answer is None or not (1 <= answer <= 3):
            raise serializers.ValidationError({'answer': '正解索引必須介於 1 到 3'})
        for field in ('image_a_url', 'image_b_url', 'image_c_url'):
            value = data.get(field, getattr(self.instance, field, ''))
            if not value or not value.strip():
                raise serializers.ValidationError({field: '圖片網址不能空白'})
        return data


class QuizSourceConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = QuizSourceConfig
        fields = ['tribe', 'dialect_id', 'display_name', 'updated_by', 'updated_at']
        read_only_fields = ['updated_by', 'updated_at']
