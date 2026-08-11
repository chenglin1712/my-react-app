"""adminapi 的請求驗證與序列化。

Announcement 用 ModelSerializer（不像 CrosswordPuzzle/serializers.py 那樣手寫
serializers.Serializer）：這個資源欄位數量多、CRUD 語意單純，手動維護一份
跟 model 定義幾乎一模一樣的欄位清單只會增加兩邊漂移的風險，ModelSerializer
直接從 model 反推欄位定義，這裡只需要額外收斂寫入時的驗證規則。
"""
import re

from rest_framework import serializers

from config.tribes import TRIBE_IDS

from .models import (
    Announcement, AuditLog, ExamScheduleOverride, FeatureFlag,
    GameConfig, HomepageConfig, IrtConfig, QuizChoiceItem, QuizClozePassage,
    QuizSituationItem, QuizSourceConfig, QuizTrueFalseItem, QuizVocabItem,
    RateLimitRule,
)

# 題庫類內容（QuizVocabItem／QuizClozePassage／QuizSituationItem）共用的
# 送審流程欄位，三個 serializer 的 read_only_fields 都一樣——status 不開放
# 一般 create/update 直接寫入的理由跟 AnnouncementSerializer 完全相同：
# 不然 editor 可以自己把 status 設成 published，繞過核准流程。
_REVIEWABLE_READ_ONLY_FIELDS = [
    'id', 'status', 'created_by', 'submitted_by', 'submitted_at',
    'reviewed_by', 'reviewed_at', 'review_comment', 'created_at', 'updated_at',
]


class AnnouncementSerializer(serializers.ModelSerializer):
    class Meta:
        model = Announcement
        fields = [
            'id', 'title', 'body', 'category', 'tribes', 'cover_image_url',
            'link_url', 'is_pinned', 'pin_until', 'publish_at', 'unpublish_at',
            'status', 'source', 'display_date_text', 'created_by', 'submitted_by',
            'submitted_at', 'reviewed_by', 'reviewed_at', 'review_comment',
            'created_at', 'updated_at',
        ]
        # 狀態機欄位（status 以下）一律由 views.py 的動作端點（submit/approve/
        # reject/...）改，不開放透過一般的 create/update 直接寫入——不然
        # editor 可以自己把 status 設成 published，繞過核准流程。source 只讀
        # 的理由不同：它是「這筆從哪來的」事實記錄，不該被任何 API 呼叫改掉
        # （crawler_sync.sync_crawler_announcements() 直接用 ORM 寫入，不經過
        # 這個 serializer）。display_date_text 則相反，刻意開放給後台編輯——
        # 爬蟲匯入的日期文字如果顯示有誤，允許人工修正。
        #
        # 注意：external_id 刻意不放進 fields——它是爬蟲匯入專用的去重鍵，
        # 如果透過這個 serializer 開放寫入，後台自建公告在沒有明確帶值時
        # DRF 會送出預設值（空字串），第二篇後台自建公告存檔時就會撞上
        # 這個欄位的 unique 約束而噴錯。
        read_only_fields = [
            'id', 'status', 'source', 'created_by', 'submitted_by', 'submitted_at',
            'reviewed_by', 'reviewed_at', 'review_comment',
            'created_at', 'updated_at',
        ]

    def validate_title(self, value):
        if not value.strip():
            raise serializers.ValidationError('標題不能空白')
        return value

    def validate_tribes(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('tribes 必須是陣列')
        invalid = [t for t in value if t not in TRIBE_IDS]
        if invalid:
            raise serializers.ValidationError(f'不支援的族語：{", ".join(invalid)}')
        return value

    def validate(self, data):
        # is_pinned/pin_until、publish_at/unpublish_at 這兩組跨欄位規則
        # model.clean() 也有一份一樣的檢查（見 models.py 的說明：確保未來
        # 就算繞過 serializer 直接用 ORM 操作也擋得住）；這裡在 API 層先擋一次，
        # 讓錯誤能回傳成一般的 400 + 欄位訊息，而不是 model.clean() 丟出的
        # ValidationError 一路往外拋變成 500。
        is_pinned = data.get('is_pinned', getattr(self.instance, 'is_pinned', False))
        pin_until = data.get('pin_until', getattr(self.instance, 'pin_until', None))
        if is_pinned and not pin_until:
            raise serializers.ValidationError({'pin_until': '置頂必須設定到期日'})

        publish_at = data.get('publish_at', getattr(self.instance, 'publish_at', None))
        unpublish_at = data.get('unpublish_at', getattr(self.instance, 'unpublish_at', None))
        if unpublish_at and publish_at and unpublish_at <= publish_at:
            raise serializers.ValidationError({'unpublish_at': '下架時間必須晚於發布時間'})
        return data


class RejectSerializer(serializers.Serializer):
    # 退件一定要附理由，不然送審者不知道要改哪裡——跟前端原型「審查意見：
    # 退件時必填」的規格一致。
    review_comment = serializers.CharField(max_length=1000, trim_whitespace=True)

    def validate_review_comment(self, value):
        if not value.strip():
            raise serializers.ValidationError('退件必須填寫審查意見')
        return value


class ApproveSerializer(serializers.Serializer):
    # 核准時的意見是選填備註，不像退件那樣強制。
    review_comment = serializers.CharField(max_length=1000, allow_blank=True, required=False, default='')


class ExamScheduleOverrideSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExamScheduleOverride
        fields = ['phase', 'label', 'start_date', 'end_date', 'is_active', 'updated_by', 'updated_at']
        read_only_fields = ['updated_by', 'updated_at']

    def validate(self, data):
        # model.clean() 也有一份一樣的檢查，這裡在 API 層先擋，錯誤才能回傳
        # 成一般的 400 + 欄位訊息（理由跟 AnnouncementSerializer.validate 一致）。
        start_date = data.get('start_date', getattr(self.instance, 'start_date', None))
        end_date = data.get('end_date', getattr(self.instance, 'end_date', None))
        if end_date and start_date and end_date < start_date:
            raise serializers.ValidationError({'end_date': '結束日期不能早於開始日期'})
        return data


class HomepageConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = HomepageConfig
        fields = [
            'hero_image_url', 'hero_link_url', 'hero_title_override',
            'show_news_section', 'show_calendar_section', 'news_display_count',
            'button1_enabled', 'button2_enabled', 'button3_enabled',
            'updated_by', 'updated_at',
        ]
        read_only_fields = ['updated_by', 'updated_at']

    def validate_hero_link_url(self, value):
        # 這個欄位最終會變成公開首頁的 <a href>，任何訪客都會執行到——只接受
        # 內部相對路徑（開頭 "/" 但不是 "//"，避免 protocol-relative URL 被
        # 瀏覽器當成外部網址，跟這個專案登入頁 next 參數的開放重導向防護
        # 同一個理由）或 http(s) 網址，擋掉 javascript: 之類的危險 scheme。
        if not value:
            return value
        # 瀏覽器的 WHATWG URL 解析對 http(s) 這類 special scheme 會把反斜線
        # 視同斜線——"/\evil.example/path" 這種字串用純字串比對看起來是
        # 「以單一 / 開頭、不是 //」的合法內部路徑，瀏覽器卻可能解讀成
        # protocol-relative 的外部網址，等於防護被繞過（獨立審查找到的
        # 問題，跟這個專案登入頁 next 參數先前修過的同一類漏洞）。判斷前
        # 先把反斜線正規化成正斜線再檢查，貼近瀏覽器實際的解析行為。
        normalized = value.replace('\\', '/')
        if normalized.startswith('/') and not normalized.startswith('//'):
            return value
        if value.startswith('http://') or value.startswith('https://'):
            return value
        raise serializers.ValidationError('連結必須是內部路徑（以 / 開頭）或 http(s) 網址')

    def validate_news_display_count(self, value):
        if not (1 <= value <= 20):
            raise serializers.ValidationError('消息顯示筆數必須介於 1 到 20 之間')
        return value


class PublicHomepageConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = HomepageConfig
        # 公開首頁讀取用，不含 updated_by／updated_at 這些後台維運資訊。
        fields = [
            'hero_image_url', 'hero_link_url', 'hero_title_override',
            'show_news_section', 'show_calendar_section', 'news_display_count',
            'button1_enabled', 'button2_enabled', 'button3_enabled',
        ]


class PublicAnnouncementSerializer(serializers.ModelSerializer):
    class Meta:
        model = Announcement
        # 給首頁公開讀取用（見 views.py 的 public_announcement_list，任何人
        # 不需登入即可打）：只給前台會用到的展示欄位，刻意不含 status／
        # created_by／submitted_by／reviewed_by／review_comment 這些後台
        # 工作流程與人員資訊——沒有理由讓匿名訪客看到是誰審核、誰寫的內部意見。
        fields = [
            'id', 'title', 'body', 'category', 'tribes',
            'cover_image_url', 'link_url', 'is_pinned', 'publish_at',
            'display_date_text', 'source_tag',
        ]


class AuditLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = AuditLog
        # 純讀取用途（見 views.py 的 audit_log_list，僅 ACCOUNT_MANAGERS 可讀），
        # 不需要 read_only_fields——這個 serializer 不會被用來接收寫入。
        fields = [
            'id', 'actor_uid', 'actor_role', 'action', 'target_type', 'target_id',
            'before', 'after', 'ip_address', 'user_agent', 'created_at',
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
    class Meta:
        model = QuizSituationItem
        fields = [
            'id', 'tribe', 'scenario_chinese', 'options', 'answer',
            'status', 'created_by', 'submitted_by', 'submitted_at',
            'reviewed_by', 'reviewed_at', 'review_comment', 'created_at', 'updated_at',
        ]
        read_only_fields = _REVIEWABLE_READ_ONLY_FIELDS

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


class IrtConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = IrtConfig
        fields = [
            'total_questions', 'alpha0', 'beta0', 'default_guess', 'learning_rate',
            'dq_alpha', 'dq_beta', 'dq_gamma',
            'type_aq_word_translate', 'type_aq_word_match', 'type_aq_sentence_fill', 'type_aq_sentence_order',
            'beta1', 'beta2', 'beta3', 'beta4', 'beta5',
            'updated_by', 'updated_at',
        ]
        read_only_fields = ['updated_by', 'updated_at']

    def validate_total_questions(self, value):
        if not (1 <= value <= 50):
            raise serializers.ValidationError('每次測驗題數必須介於 1 到 50 之間')
        return value

    def validate_default_guess(self, value):
        if not (0 <= value < 1):
            raise serializers.ValidationError('猜測參數必須介於 0（含）到 1（不含）之間')
        return value


class PublicIrtConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = IrtConfig
        # 給 FastAPI 讀取用（見 views.py 的 public_irt_config，無需登入），
        # 不含 updated_by／updated_at 這些後台維運資訊。
        fields = [
            'total_questions', 'alpha0', 'beta0', 'default_guess', 'learning_rate',
            'dq_alpha', 'dq_beta', 'dq_gamma',
            'type_aq_word_translate', 'type_aq_word_match', 'type_aq_sentence_fill', 'type_aq_sentence_order',
            'beta1', 'beta2', 'beta3', 'beta4', 'beta5',
        ]


_GAME_CONFIG_FIELDS = [
    'listening_questions_per_round', 'listening_options_per_question',
    'sentence_questions_per_round', 'sentence_options_per_question',
    'pronunciation_max_audio_mb', 'pronunciation_excellent_threshold',
    'pronunciation_good_threshold', 'pronunciation_fair_threshold',
    'pronunciation_pass_threshold',
    'crossword_grid_size', 'crossword_min_word_length', 'crossword_max_word_length',
    'crossword_words_per_round', 'crossword_compute_time_limit_seconds',
]


class GameConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = GameConfig
        fields = _GAME_CONFIG_FIELDS + ['updated_by', 'updated_at']
        read_only_fields = ['updated_by', 'updated_at']

    def validate_listening_options_per_question(self, value):
        if not (2 <= value <= 8):
            raise serializers.ValidationError('聽力每題選項數必須介於 2 到 8 之間')
        return value

    def validate_sentence_options_per_question(self, value):
        if not (2 <= value <= 8):
            raise serializers.ValidationError('句型每題選項數必須介於 2 到 8 之間')
        return value

    def validate_crossword_grid_size(self, value):
        if not (5 <= value <= 30):
            raise serializers.ValidationError('填字網格大小必須介於 5 到 30 之間')
        return value

    def validate_listening_questions_per_round(self, value):
        if not (1 <= value <= 50):
            raise serializers.ValidationError('聽力每輪題數必須介於 1 到 50 之間')
        return value

    def validate_sentence_questions_per_round(self, value):
        if not (1 <= value <= 50):
            raise serializers.ValidationError('句型每輪題數必須介於 1 到 50 之間')
        return value

    def validate_pronunciation_max_audio_mb(self, value):
        if not (1 <= value <= 50):
            raise serializers.ValidationError('發音錄音檔案大小上限必須介於 1 到 50 MB 之間')
        return value

    def validate_pronunciation_excellent_threshold(self, value):
        if not (0 <= value <= 100):
            raise serializers.ValidationError('發音評分門檻必須介於 0 到 100 之間')
        return value

    def validate_pronunciation_good_threshold(self, value):
        if not (0 <= value <= 100):
            raise serializers.ValidationError('發音評分門檻必須介於 0 到 100 之間')
        return value

    def validate_pronunciation_fair_threshold(self, value):
        if not (0 <= value <= 100):
            raise serializers.ValidationError('發音評分門檻必須介於 0 到 100 之間')
        return value

    def validate_pronunciation_pass_threshold(self, value):
        if not (0 <= value <= 100):
            raise serializers.ValidationError('發音及格門檻必須介於 0 到 100 之間')
        return value

    def validate_crossword_min_word_length(self, value):
        if not (2 <= value <= 20):
            raise serializers.ValidationError('填字詞長下限必須介於 2 到 20 之間')
        return value

    def validate_crossword_max_word_length(self, value):
        if not (2 <= value <= 20):
            raise serializers.ValidationError('填字詞長上限必須介於 2 到 20 之間')
        return value

    def validate_crossword_words_per_round(self, value):
        if not (5 <= value <= 200):
            raise serializers.ValidationError('填字每局詞數必須介於 5 到 200 之間')
        return value

    def validate_crossword_compute_time_limit_seconds(self, value):
        # 這個值直接餵給 crossword.py 一個同步、不會讓出的 CPU 忙等迴圈
        # （compute_crossword 的 while 迴圈），值太大會讓一個請求佔用一個
        # worker 極長時間——10 秒已經遠高於原本寫死的 2 秒，同時足以避免
        # PositiveSmallIntegerField 上限（32767，將近 9 小時）被拿來當
        # 有效值直接卡住 worker。
        if not (1 <= value <= 10):
            raise serializers.ValidationError('填字運算時限必須介於 1 到 10 秒之間')
        return value

    def validate(self, data):
        # partial update 時，還沒被這次請求觸及的欄位要 fallback 到目前 instance
        # 上的值才能正確比較，不能只看這次請求帶了什麼（PATCH 常常只帶一兩個欄位）。
        def _get(field):
            return data.get(field, getattr(self.instance, field, None))

        excellent = _get('pronunciation_excellent_threshold')
        good = _get('pronunciation_good_threshold')
        fair = _get('pronunciation_fair_threshold')
        if None not in (excellent, good, fair) and not (excellent >= good >= fair):
            raise serializers.ValidationError('發音評分門檻必須維持「優秀 ≥ 不錯 ≥ 繼續加油」的順序')

        min_len = _get('crossword_min_word_length')
        max_len = _get('crossword_max_word_length')
        if None not in (min_len, max_len) and min_len > max_len:
            raise serializers.ValidationError('填字詞長下限不能大於上限')

        return data


class PublicGameConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = GameConfig
        # 給 FastAPI 輪詢用（見 views.py 的 public_game_config，無需登入），
        # 不含 updated_by／updated_at 這些後台維運資訊。
        fields = _GAME_CONFIG_FIELDS


# 每種單位換算成秒數，用來把「數字/單位」正規化成「每秒等效請求數」——
# 光幫數字本身設一個很大的上限（例如 100000）擋不住 "100000/s" 這種
# 換算下來仍然是每秒十萬次請求、形同關閉限流的值；要擋的是「效果」不是
# 「數字大小」，所以先換算成統一單位再比較。
_RATE_UNIT_SECONDS = {
    's': 1, 'second': 1,
    'm': 60, 'minute': 60,
    'h': 3600, 'hour': 3600,
    'd': 86400, 'day': 86400,
}
# 目前實際種入的最高值是 "120/m"（每秒 2 次）；訂在每秒 50 次，遠高於
# 現況任何一筆設定，但足以擋下會讓限流形同關閉的離譜數字。
_MAX_EFFECTIVE_RATE_PER_SECOND = 50
_DJANGO_RATE_UNITS = {'s', 'm', 'h', 'd'}
_FASTAPI_RATE_UNITS = {'second', 'minute', 'hour', 'day'}


class RateLimitRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = RateLimitRule
        fields = [
            'id', 'key', 'backend', 'rate', 'default_rate', 'description',
            'updated_by', 'updated_at',
        ]
        read_only_fields = ['id', 'key', 'backend', 'default_rate', 'description', 'updated_by', 'updated_at']

    def validate_rate(self, value):
        # backend 是唯讀欄位，只能透過 PATCH 改動既有紀錄（RateLimitRule
        # 不開放後台自由新增，見 read_only_fields 說明），self.instance
        # 一定存在，可以放心用來判斷這筆規則屬於哪一邊。
        match = re.match(r'^(\d+)/(s|m|h|d|second|minute|hour|day)$', value.strip())
        if not match:
            raise serializers.ValidationError(
                '格式不正確，範例："30/m"（Django）或 "20/minute"（FastAPI）'
            )
        count, unit = match.groups()
        backend = self.instance.backend if self.instance else None
        expected_units = (
            _DJANGO_RATE_UNITS if backend == RateLimitRule.BACKEND_DJANGO
            else _FASTAPI_RATE_UNITS if backend == RateLimitRule.BACKEND_FASTAPI
            else None
        )
        if expected_units is not None and unit not in expected_units:
            example = '"30/m"' if backend == RateLimitRule.BACKEND_DJANGO else '"20/minute"'
            raise serializers.ValidationError(
                f'這筆規則屬於 {backend}，單位格式不符，範例：{example}'
            )
        if int(count) < 1:
            # "0/s" 這種值形狀合法、換算後的每秒請求數也不會超過上限
            # （0 明明小於 50），但 django_ratelimit／limits 兩邊都會把它
            # 解讀成「一律視為超過限制」——不是關閉限流，是讓端點直接打不通，
            # 一樣是這個 API 不該讓管理者無意間點出來的狀態。
            raise serializers.ValidationError('請求次數必須至少為 1，0 會讓端點完全無法使用')
        effective_per_second = int(count) / _RATE_UNIT_SECONDS[unit]
        if effective_per_second > _MAX_EFFECTIVE_RATE_PER_SECOND:
            raise serializers.ValidationError(
                f'換算後每秒 {effective_per_second:.1f} 次請求，超過上限（每秒 '
                f'{_MAX_EFFECTIVE_RATE_PER_SECOND} 次），等同關閉限流保護'
            )
        return value.strip()


class FeatureFlagSerializer(serializers.ModelSerializer):
    class Meta:
        model = FeatureFlag
        fields = ['id', 'key', 'label', 'description', 'enabled', 'updated_by', 'updated_at']
        read_only_fields = ['id', 'key', 'label', 'description', 'updated_by', 'updated_at']
