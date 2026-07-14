"""tayal_chat／review_tayal_chat 的請求驗證。

原本 message 以外的欄位（user_stats 的 correct/incorrect/common_errors/level、
tribe）完全沒驗證型別或長度就直接組進送給 LLM 的 system prompt，common_errors
更是任意陣列直接塞入，形同開放給任意大小、任意內容的字串進提示詞。這裡限制型別、
長度與 tribe 的合法值，縮小可塞入 prompt 的內容範圍——這是限制輸入的形狀與大小，
不是完整的提示詞注入防護（LLM 仍可能被合法長度內的文字影響），但至少不再是完全
不設限的自由格式輸入。
"""
from rest_framework import serializers

from config.tribes import TRIBE_IDS

_TRIBE_CHOICES = list(TRIBE_IDS.keys())


class UserStatsSerializer(serializers.Serializer):
    correct = serializers.IntegerField(min_value=0, max_value=100000, default=0)
    incorrect = serializers.IntegerField(min_value=0, max_value=100000, default=0)
    unanswered = serializers.IntegerField(min_value=0, max_value=100000, default=0)
    # 前端最多帶 3 筆最常錯的詞（見 bot.jsx），這裡放寬到 20 筆但设上限，避免
    # 惡意呼叫端塞入超大陣列。
    common_errors = serializers.ListField(
        child=serializers.CharField(max_length=100, allow_blank=True),
        max_length=20,
        required=False,
        default=list,
    )
    # level 目前沒有固定列舉值（前端來源包含「初級」「N/A」等自由格式字串），
    # 只限制長度，不限制內容。
    level = serializers.CharField(max_length=50, allow_blank=True, required=False, default="beginner")


class TayalChatSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=1000, allow_blank=False, trim_whitespace=True)
    user_stats = UserStatsSerializer(required=False, default=dict)
    tribe = serializers.ChoiceField(choices=_TRIBE_CHOICES, required=False, default="tayal")


class ReviewTayalChatSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=1000, allow_blank=False, trim_whitespace=True)
    tribe = serializers.ChoiceField(choices=_TRIBE_CHOICES, required=False, default="tayal")
