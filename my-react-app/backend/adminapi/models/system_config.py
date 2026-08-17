from django.db import models


class IrtConfig(models.Model):
    """FastAPI Recommon 適性測驗（backend/fastAPI/routes/quiz.py）的超參數，
    單例（永遠只有一筆，pk 固定用 1，見 load()）。這裡只是把原本模組頂部
    寫死的數字外部化成可調參數，不改動 IRT 計算公式本身——預設值原樣照抄
    quiz.py 現有的硬編碼值，確保新增這張表當下，實際算分行為完全不變。

    FastAPI 沒有直接連到這張表所在的資料庫——辭典 DB（dictionary_db）是
    另一個獨立的 Postgres database（見 backend/dictionary_db/connect.py），
    同一個 Postgres 執行個體下的不同 database 互不相通，不能直接 JOIN。
    FastAPI 改成呼叫公開的 GET /adminapi/irt-config/effective/ 端點、自己
    做短 TTL 快取（不是即時 push）——調整 IRT 參數不是秒等的即時性需求，
    跟 REDIS_URL 共用限流計數是完全不同等級的即時性要求。
    """
    total_questions = models.PositiveSmallIntegerField(default=10)
    alpha0 = models.FloatField(default=1.0)
    beta0 = models.FloatField(default=1.0)
    default_guess = models.FloatField(default=0.25)
    learning_rate = models.FloatField(default=0.08)
    dq_alpha = models.FloatField(default=0.45)
    dq_beta = models.FloatField(default=0.35)
    dq_gamma = models.FloatField(default=0.20)
    type_aq_word_translate = models.FloatField(default=1.2)
    type_aq_word_match = models.FloatField(default=1.0)
    type_aq_sentence_fill = models.FloatField(default=0.9)
    type_aq_sentence_order = models.FloatField(default=1.1)
    # BETA1/BETA2 對應的 F_w（收藏數）／R_w（探索數）目前前端從未回填這兩個
    # 欄位（quiz.py 的 UserModelReq.favorites/explorations 一直是預設值），
    # 調整這兩個參數在正式接上該資料前不會有實際效果——保留欄位是為了未來
    # 一旦補上該資料就能直接生效，不需要再改 schema。
    beta1 = models.FloatField(default=0.2)
    beta2 = models.FloatField(default=0.2)
    beta3 = models.FloatField(default=0.2)
    beta4 = models.FloatField(default=0.2)
    beta5 = models.FloatField(default=0.2)
    updated_by = models.CharField(max_length=128, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return f"IRT 參數設定（每次測驗 {self.total_questions} 題）"


class GameConfig(models.Model):
    """四個遊戲（聽力/句型/發音/填字）的可調參數，單例（永遠只有一筆，
    pk 固定用 1，見 load()）——比照 IrtConfig 的既有模式：把原本各自模組
    頂部寫死的數字外部化成可調參數，不新增這幾個遊戲原本沒有的選題/篩選
    邏輯（例如聽力的頻率難度分級、句型的句長篩選——這兩個現況都不存在，
    刻意不無中生有，見規劃文件「並行項目」章節的說明）。預設值原樣照抄
    各自模組目前的硬編碼值，確保新增這張表當下，實際行為完全不變。

    四個遊戲共用一張表（不拆四張）——彼此之間沒有一對多關聯，拆開只會讓
    「載入全部設定」變成四次查詢，且四個遊戲的角色權限/生效時機都一致，
    沒有理由分開管理。
    """
    listening_questions_per_round = models.PositiveSmallIntegerField(default=10)
    listening_options_per_question = models.PositiveSmallIntegerField(default=4)
    sentence_questions_per_round = models.PositiveSmallIntegerField(default=5)
    sentence_options_per_question = models.PositiveSmallIntegerField(default=4)
    pronunciation_max_audio_mb = models.PositiveSmallIntegerField(default=10)
    # 優/良/待加強的相似度分界——原本完全在前端（pronunciation_game.jsx
    # 的 RATING()），這裡是這三個級距第一次有後端可調的定義。
    pronunciation_excellent_threshold = models.PositiveSmallIntegerField(default=80)
    pronunciation_good_threshold = models.PositiveSmallIntegerField(default=60)
    pronunciation_fair_threshold = models.PositiveSmallIntegerField(default=40)
    # 後端 compare_audio 的 passed 判定門檻（跟上面三個級距是各自獨立的
    # 判斷——passed 目前只用來決定要不要把這筆錄音存進「社群示範發音」，
    # 不是四個級距的其中一個切點，兩者刻意分開)。
    pronunciation_pass_threshold = models.PositiveSmallIntegerField(default=70)
    crossword_grid_size = models.PositiveSmallIntegerField(default=13)
    crossword_min_word_length = models.PositiveSmallIntegerField(default=4)
    crossword_max_word_length = models.PositiveSmallIntegerField(default=10)
    crossword_words_per_round = models.PositiveSmallIntegerField(default=30)
    crossword_compute_time_limit_seconds = models.PositiveSmallIntegerField(default=2)
    updated_by = models.CharField(max_length=128, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return "遊戲參數設定"


class RateLimitRule(models.Model):
    """限流設定的通用登錄表——key 對應 Django 端 adminapi/_shared.py／
    crawler/views.py 既有呼叫點傳入的 group 名稱，或 FastAPI 端新增的
    識別字串；rate 格式依 backend 而異（Django django_ratelimit 是
    "30/m" 這種簡寫，FastAPI 的 limits 套件是 "20/minute" 這種全稱，
    兩邊格式本來就不同，不強行統一）。

    Django 端呼叫點完全不需要改寫程式碼本身——rate_limited_response()／
    ip_rate_limited_response() 會先查這張表，查不到 key 對應的紀錄就
    fallback 用呼叫端原本傳入的字面值（不強制每個呼叫點都要先在這張表
    登錄過，找不到記錄＝用原本行為）；FastAPI 端每個 @limiter.limit(...)
    呼叫點則要逐一改成 callable（見 fastAPI/rate_limit_config.py），
    因為裝飾器綁定的字面字串沒有辦法動態替換。

    default_rate 存的是程式碼裡原本寫死的值，給「重設為預設值」按鈕與
    後台列表對照用；seed_rate_limit_rules 管理指令會把目前程式碼裡實際
    找到的全部呼叫點一次性寫入這張表，值設成跟程式碼目前一致（不留白）。
    """
    BACKEND_DJANGO = "django"
    BACKEND_FASTAPI = "fastapi"
    BACKEND_CHOICES = [
        (BACKEND_DJANGO, "Django"),
        (BACKEND_FASTAPI, "FastAPI"),
    ]

    key = models.CharField(max_length=100, unique=True)
    backend = models.CharField(max_length=10, choices=BACKEND_CHOICES)
    rate = models.CharField(max_length=20)
    default_rate = models.CharField(max_length=20)
    description = models.CharField(max_length=200, blank=True)
    updated_by = models.CharField(max_length=128, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['backend', 'key']
        indexes = [models.Index(fields=['backend'])]

    def __str__(self):
        return f"[{self.backend}] {self.key} = {self.rate}"


class FeatureFlag(models.Model):
    """功能開關的通用登錄表——key 是呼叫端自訂的識別字串（例如
    "quiz_enabled_tayal"），enabled 預設 True（維持現況行為，管理者主動
    關閉才會改變）。這次唯一真正接上判斷的消費端是 crawler/views.py 的
    get_quiz_data()／get_situation_quiz_data()（族語測驗總開關），其餘
    key 目前只是登錄在這張表裡，還沒有程式碼真的去讀（見規劃文件的說明：
    這次刻意只做一個真實接點，不是把「功能開關」做成什麼都能接的通用
    中介層）。
    """
    key = models.CharField(max_length=100, unique=True)
    label = models.CharField(max_length=100)
    description = models.CharField(max_length=200, blank=True)
    enabled = models.BooleanField(default=True)
    updated_by = models.CharField(max_length=128, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['key']

    def __str__(self):
        return f"{self.key}（{'開' if self.enabled else '關'}）"
