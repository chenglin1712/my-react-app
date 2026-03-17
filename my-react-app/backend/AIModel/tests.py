from django.test import TestCase

# Create your tests here.
from views import search_tayal_words

# 測試 1：存在的單字
print("測試 cyux：")
res1 = search_tayal_words("cyux", limit=1)
print(res1 if res1 else "查無資料")

# 測試 2：不存在的單字
print("\n測試 not_exist：")
res2 = search_tayal_words("not_exist", limit=1)
print(res2 if res2 else "查無資料")