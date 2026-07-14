"""submit_ans 的請求驗證。

原本完全沒驗證請求結構，直接對 request.body 做 json.loads 後就用 dict.get()／
list index 存取，型別不對或欄位缺漏時會讓例外一路往外拋、被 Django 預設的 500
處理接住，正式環境回一頁 HTML，跟這個 API 其餘端點統一回 JSON 的約定不一致。
"""
from rest_framework import serializers


class CrosswordLegendItemSerializer(serializers.Serializer):
    number = serializers.IntegerField()
    word = serializers.CharField(max_length=100)
    clue = serializers.CharField(max_length=500, allow_blank=True)
    direction = serializers.ChoiceField(choices=["across", "down"])
    start_col = serializers.IntegerField()
    start_row = serializers.IntegerField()
    length = serializers.IntegerField()


class SubmitAnsSerializer(serializers.Serializer):
    # 13x13 網格（見 generate_crossword），上限留一些餘裕，主要目的是擋掉
    # 明顯不合理的超大陣列，不是精確重現遊戲規則。
    user_answers = serializers.ListField(
        child=serializers.ListField(
            child=serializers.CharField(max_length=1, allow_blank=True),
            max_length=50,
        ),
        max_length=50,
        allow_empty=False,
    )
    crossword_solution = serializers.ListField(
        child=serializers.CharField(max_length=200, allow_blank=True),
        max_length=50,
        allow_empty=False,
    )
    crossword_legend = CrosswordLegendItemSerializer(many=True)
