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


HISTORY_MAX_MESSAGES = 10


class HistoryMessageSerializer(serializers.Serializer):
    role = serializers.ChoiceField(choices=["user", "assistant"])
    # 與當前問題同樣上限 1000 字；助手的回覆本來就約 100 字內，讀書計畫只送確認訊息。
    text = serializers.CharField(max_length=1000, allow_blank=False, trim_whitespace=True)
    # 助手訊息的簽章（services.sign_reply），缺少或不符的助手訊息會被捨棄；使用者訊息不需要。
    sig = serializers.CharField(max_length=64, allow_blank=True, required=False, default="")


class TayalChatSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=1000, allow_blank=False, trim_whitespace=True)
    # 已淘汰（路線圖 #20）：學習資料改由伺服器依 uid 讀取，這個欄位只為了相容還沒更新的舊前端而接受，
    # 內容完全不驗證、不使用（任何形狀都不會讓請求失敗）。前端都更新後可以移除這個欄位。
    user_stats = serializers.JSONField(required=False, allow_null=True, write_only=True)
    tribe = serializers.ChoiceField(choices=_TRIBE_CHOICES, required=False, default="tayal")
    # 前幾輪對話（較舊的在前），讓助手看得懂追問。超過筆數或單則長度上限直接 400，
    # 不默默截斷，避免呼叫端以為整段都送出去了。
    history = HistoryMessageSerializer(many=True, required=False, default=list, max_length=HISTORY_MAX_MESSAGES)

    def validate_history(self, value):
        if value and value[0]["role"] != "user":
            raise serializers.ValidationError("對話紀錄的第一則必須是使用者的訊息")
        return value


class ReviewTayalChatSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=1000, allow_blank=False, trim_whitespace=True)
    tribe = serializers.ChoiceField(choices=_TRIBE_CHOICES, required=False, default="tayal")
