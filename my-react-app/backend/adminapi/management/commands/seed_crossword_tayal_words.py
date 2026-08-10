"""把 CrosswordPuzzle/crossword.py 原本寫死的 20 筆泰雅語填字詞庫，
一次性種入 CrosswordTayalWord。

用法：
    python manage.py seed_crossword_tayal_words

冪等：用 word 當比對鍵，已存在的字不重複建立，可重複執行。sort_order
依照原始陣列的順序遞增，維持跟改用資料庫之前完全相同的候選詞順序。
"""
from django.core.management.base import BaseCommand

from adminapi.models import CrosswordTayalWord

# 原始資料照抄 CrosswordPuzzle/crossword.py 的 word_list（見該檔案第 388 行），
# 這裡不 import 那個模組——crossword.py 之後會改成從資料庫讀，這份清單只是
# 種子資料的快照，不應該讓兩邊互相依賴。
_SEED_WORDS = [
    ('apah', '糯米飯'),
    ('bahat', '西瓜'),
    ('banan', '高粱'),
    ('bazing', '蛋'),
    ('hlahuy', '森林、山林'),
    ('hongwaysen', '紅外線'),
    ('iyanghwatan', '一氧化炭'),
    ('kagang', '螃蟹'),
    ('kawciya', '高氣壓'),
    ('hugal', '都市'),
    ('intuyang', '印度洋'),
    ('kbawlung', '蝦子'),
    ('kbzyan', '平埔族'),
    ('kensackang', '檢察官'),
    ('khelang', '客家人'),
    ('kingahul', '獨角仙'),
    ('kinsruyun', '地鼠'),
    ('llyung', '河流、溪流'),
    ('mhitung', '百步蛇'),
    ('mksingut', '小黑人'),
]


class Command(BaseCommand):
    help = "把 crossword.py 原本寫死的 20 筆泰雅語填字詞庫種入 CrosswordTayalWord（冪等，可重複執行）"

    def handle(self, *args, **options):
        created_count = 0
        for index, (word, meaning) in enumerate(_SEED_WORDS):
            _, created = CrosswordTayalWord.objects.get_or_create(
                word=word,
                defaults={"meaning": meaning, "sort_order": index, "created_by": "seed_crossword_tayal_words"},
            )
            created_count += int(created)

        self.stdout.write(self.style.SUCCESS(
            f"泰雅語填字詞庫種子完成：共 {len(_SEED_WORDS)} 筆，新增 {created_count} 筆，其餘已存在維持原值。"
        ))
