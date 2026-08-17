import re

from rest_framework import serializers

from ..models import FeatureFlag, GameConfig, IrtConfig, RateLimitRule


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
