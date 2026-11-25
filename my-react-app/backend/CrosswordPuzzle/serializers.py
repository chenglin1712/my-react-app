"""submit_ans 的請求驗證（稽核 BE5-09：只收題目憑證與使用者作答，解答與圖例一律由伺服器從憑證取得）。

原本完全沒驗證請求結構，直接對 request.body 做 json.loads 後就用 dict.get()／
list index 存取，型別不對或欄位缺漏時會讓例外一路往外拋、被 Django 預設的 500
處理接住，正式環境回一頁 HTML，跟這個 API 其餘端點統一回 JSON 的約定不一致。
"""
from rest_framework import serializers


class SubmitAnsSerializer(serializers.Serializer):
    # 網格最大 30x30（後台 crossword_grid_size 上限），上限留一些餘裕，主要目的是擋掉明顯不合理的超大陣列。
    user_answers = serializers.ListField(
        child=serializers.ListField(
            child=serializers.CharField(max_length=1, allow_blank=True),
            max_length=50,
        ),
        max_length=50,
        allow_empty=False,
    )
    # 產生題目時發給前端的加密憑證（見 puzzle_token.py）；200 個單字壓縮加密後遠小於這個上限。
    puzzle_token = serializers.CharField(max_length=100000)
