"""add pg_trgm trigram indexes and translation_attested_form table for 族語翻譯功能

Revision ID: 86d389a704d0
Revises: bd80bf38fb2d
Create Date: 2026-08-15 00:00:00.000000

繁體中文 ⇄ 五族語整句翻譯功能的檢索基礎設施。翻譯功能的核心原則是「LLM 只能
輸出檢索到的語料庫裡出現過的詞形」，所以需要對 word_explanation_sentence（
族語↔中文例句）、word_explanation（中文釋義）、words（族語詞條）三張既有表
做模糊比對（trigram similarity），並新增一張表記錄「語料句子中實際出現過的
族語詞形」（見下方 translation_attested_form 的說明——字典收錄原形，例句用
的是詞綴變化過的形式，兩者不能只用其中一個當佐證依據）。

## 為什麼是 pg_trgm 而不是應用層自建索引
一開始曾評估過在應用程式記憶體裡建一份 SQLite FTS5 側索引（想避免動 schema），
但這個專案的辭典 DB 正式環境是 PostgreSQL（dictionary_db/connect.py 的
DICTIONARY_DATABASE_URL），維護一份跟主資料庫脫鉤、需要手動失效/重建的記憶體
副本，複雜度反而比直接用 Postgres 原生的 pg_trgm 模糊比對更高：不需要任何
warm-up/cache-invalidate 機制，索引永遠跟資料同步，且天生就是多 worker 共用，
不像記憶體索引那樣每個 process 各存一份。實測 pg_trgm 的 similarity() 在
本專案語料規模（每族 3,458～8,809 詞、4,093～10,428 句對）上不建索引也只要
70~120ms，對翻譯這種本來就要呼叫 LLM（1~3 秒級）的功能完全夠用；這裡仍然
建 GIN 索引是為資料量成長預留空間，不是解決當下的效能問題。

pg_trgm 從 PostgreSQL 13 起是「trusted extension」，資料庫擁有者（不需要真正
的 superuser 帳號）就能執行 CREATE EXTENSION，這裡直接在 migration 裡做過，
已用專案的 DICTIONARY_DATABASE_URL 帳號實測成功。

## 為什麼用「運算式索引」（expression index）而不是加新欄位
繁體中文/族語文字比對前需要正規化（統一 U+02BC／U+02BE 兩種變音符號撇號為
ASCII '，移除阿美語詞尾標記 ^），但正規化規則屬於翻譯功能自己的邏輯，不該
讓 words／word_explanation_sentence 這兩張被其他六個模組共用的既有表多出
「只有翻譯功能在用」的欄位——尤其 word_audio／word_explanation／
word_explanation_anaphora_item 都用 CASCADE 參照 words.id，SQLite 環境下
batch_alter_table 加欄位是「建新表→搬資料→砍舊表→改名」，會把這些子表資料
整批級聯刪光（bd80bf38fb2d 已經因為同樣理由避開對 words 加欄位一次，這裡
沿用同樣的顧慮）。改用 Postgres 的運算式 GIN 索引：索引建在
lower(regexp_replace(...)) 這個運算式本身，不需要實體欄位，查詢時只要在
WHERE/ORDER BY 用完全相同的運算式，Planner 就能用上索引（本專案目前資料量
下 Planner 會傾向選 Seq Scan，這是正常的成本估算行為，不代表索引無效——
已實測驗證運算式索引能被 CREATE INDEX 接受且查詢結果正確）。

跟 backend/fastAPI/routes/translation/lexicon.py 的 normalize_form() 必須
維持同樣的正規化規則：Python 版本用於處理 LLM 輸出與使用者輸入，這裡的 SQL
版本用於索引既有資料庫欄位；兩者故意分開實作，但邏輯上一定要一致，改動任一
邊要記得同步改另一邊。

## 為什麼 translation_attested_form 是一張真正的表，不是運算式索引
這張表記錄的不是「對既有欄位做正規化」，而是全新的衍生資料：對每個族語，
掃描 word_explanation_sentence.original_sentence 切詞、正規化後，找出所有
「語料句子裡實際出現過、但不是字典詞條本身」的詞形。這份資料無法用 SQL
運算式表達，必須實際跑一次 Python 斷詞/正規化才能產生，所以這裡只建立空表，
機制上比照 bd80bf38fb2d 的 media_asset：schema migration 只建表，實際內容
另外用 Django management command（backend/adminapi/management/commands/
rebuild_translation_attested_forms.py）在部署後手動執行填入。

## SQLite 相容性
沒有設定 DICTIONARY_DATABASE_URL/DATABASE_URL 時（README 記載的「對一個
全新、空的 SQLite 檔案執行 alembic upgrade head」開發模式）不支援 pg_trgm，
這裡用 bind.dialect.name 判斷，Postgres 專屬的 extension／運算式索引只在
postgresql dialect 下建立；translation_attested_form 這張表的 schema 是
dialect 中立的 DDL，兩邊都會建（表本身用得到，只是 SQLite 環境下沒有资料，
因為填表的 management command 一樣要 Postgres 的模糊比對能力才有意義去跑）。
翻譯功能本身在偵測到目前連線不是 Postgres 時，於第一次被呼叫時才回明確的
錯誤（比照 AIModel/views.py::_get_client 缺 GITHUB_TOKEN 時的 lazy check
精神：import 當下不檢查，避免拖垮其他不相關的功能），不假裝 SQLite 也有
模糊比對能力。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '86d389a704d0'
down_revision: Union[str, Sequence[str], None] = 'bd80bf38fb2d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# 正規化運算式：統一 U+02BC(ʼ)／U+02BE(ʾ) 兩種變音符號撇號為 ASCII '，移除
# 阿美語詞尾標記 ^，轉小寫。{col} 由呼叫端代入實際欄位/運算式。
def _normalize_expr(col: str) -> str:
    return (
        "lower(regexp_replace(regexp_replace("
        f"{col}, '[ʼʾ]', '''', 'g'), '\\^', '', 'g'))"
    )


def upgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    op.create_table(
        "translation_attested_form",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("tribe_id", sa.String(), sa.ForeignKey("tribe.id", ondelete="CASCADE"), nullable=False),
        sa.Column("surface_form_norm", sa.String(), nullable=False),
        # 這個詞形是從哪一句例句斷出來的——佐證檢核（Tier B "attested"）要能
        # 引用真正的例句給使用者看，不能只回一個「有出現過」的布林值。
        sa.Column(
            "source_sentence_id", sa.Integer(),
            sa.ForeignKey("word_explanation_sentence.id", ondelete="SET NULL"), nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ix_translation_attested_form_tribe_surface",
        "translation_attested_form",
        ["tribe_id", "surface_form_norm"],
        unique=True,
    )

    if not is_postgres:
        # SQLite 開發模式：只建立 dialect 中立的表，pg_trgm 索引整段跳過
        # （PRAGMA/extension 都是 dialect 專屬語法，直接對 SQLite 執行會出錯，
        # 比照 dictionary_db/connect.py 對 _is_sqlite 的既有處理方式）。
        return

    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.execute(
        "CREATE INDEX ix_words_name_norm_trgm ON words "
        f"USING GIN (({_normalize_expr('name')}) gin_trgm_ops)"
    )
    original_norm_expr = _normalize_expr("coalesce(original_sentence, '')")
    op.execute(
        "CREATE INDEX ix_wes_original_norm_trgm ON word_explanation_sentence "
        f"USING GIN (({original_norm_expr}) gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX ix_wes_chinese_trgm ON word_explanation_sentence "
        "USING GIN (chinese_sentence gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX ix_we_chinese_explanation_trgm ON word_explanation "
        "USING GIN (chinese_explanation gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX ix_taf_surface_trgm ON translation_attested_form "
        "USING GIN (surface_form_norm gin_trgm_ops)"
    )


def downgrade() -> None:
    bind = op.get_bind()
    is_postgres = bind.dialect.name == "postgresql"

    if is_postgres:
        op.execute("DROP INDEX IF EXISTS ix_taf_surface_trgm")
        op.execute("DROP INDEX IF EXISTS ix_we_chinese_explanation_trgm")
        op.execute("DROP INDEX IF EXISTS ix_wes_chinese_trgm")
        op.execute("DROP INDEX IF EXISTS ix_wes_original_norm_trgm")
        op.execute("DROP INDEX IF EXISTS ix_words_name_norm_trgm")
        # 刻意不 DROP EXTENSION pg_trgm：其他功能（例如後台辭典模糊搜尋）之後
        # 也可能依賴它，drop extension 的影響範圍不是這支 migration 能確定的。

    op.drop_index("ix_translation_attested_form_tribe_surface", table_name="translation_attested_form")
    op.drop_table("translation_attested_form")
