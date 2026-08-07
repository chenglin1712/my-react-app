"""add media_asset table for self-hosted dictionary media

Revision ID: bd80bf38fb2d
Revises: 90bc362710d9
Create Date: 2026-08-07 00:00:00.000000

P5 辭典媒體自主化：音檔／圖片目前完全依賴外部（word_audio.file_id、
word_explanation_sentence_audio.file_id 要即時打 ILRDF API 兩段式解析才拿得到
真檔；word_explanation_image.image_url、words.word_img 是完整外部 URL，前端
直接連）。外部來源一旦不可用，音檔要乾等 10~25 秒才靜默失敗、圖片變破圖。

這支 migration 只新增「自己有哪些媒體物件副本」的記錄表，不搬移、不下載任何
實際內容（4.3 萬次外部請求不該放進 schema migration，另外用 Django management
command 處理，見 adminapi/management/commands/migrate_dictionary_media.py）。

設計成一張共用的 media_asset 主表，而不是在三張來源表各自加十個重複欄位：
下載/上傳/驗證狀態、checksum 這些欄位語意完全相同，重複三份日後（例如換
Storage provider）要同步改三次 schema；獨立一張表也讓「同一個外部物件被多筆
資料引用」時能自然去重。

三張來源表（word_audio、word_explanation_sentence_audio、word_explanation_image）
各加一個 nullable 的 media_asset_id FK，指向已驗證完成的自有副本；原始的
file_id／image_url 完全不動、不覆寫，繼續當 provenance 與過渡期 fallback。

words.word_img 刻意不加欄位、不動 words 表 schema：
1. word_audio／word_explanation／word_explanation_anaphora_item 都用
   ondelete="CASCADE" 參照 words.id，SQLite 的 batch_alter_table 是「建新表→
   搬資料→砍舊表→改名」，砍舊表那步會把這些子表的資料整批級聯刪光
   （90bc362710d9 的 comment 已經踩過這個坑一次，這裡不重蹈覆轍）。
2. word_img 要遷移的圖（Bing 搜尋縮圖、商業圖庫）跟 ILRDF 官方媒體性質不同、
   風險也不同，讀取路徑會另外用 (source_provider, source_kind, source_locator)
   = ('bing_or_thirdparty', 'word_img', word.word_img) 反查 media_asset，
   不需要額外的 FK 欄位。

media_asset 本身的欄位刻意不被 adminapi/dictionary_write.py 的
_WORD_SCALAR_FIELDS／word_content_hash() 觸碰到：這些是遷移/儲存基礎設施的
中繼資料，不是辭典內容本身，不應該讓 pending 的 DictionaryRevision.expected_hash
或 DictionaryImportJob.preflight_hash 因為這次遷移而全數失效。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bd80bf38fb2d'
down_revision: Union[str, Sequence[str], None] = '90bc362710d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "media_asset",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        # 'ilrdf' / 'bing_or_thirdparty'——來源提供者，不是儲存目的地
        sa.Column("source_provider", sa.String(), nullable=False),
        # 'word_audio' / 'sentence_audio' / 'explanation_image' / 'word_img'
        sa.Column("source_kind", sa.String(), nullable=False),
        # ILRDF 的音檔是 file_id（GUID），圖片／word_img 是完整 URL——
        # 兩種長度差異大，統一用 Text 存，不假設固定長度
        sa.Column("source_locator", sa.Text(), nullable=False),
        sa.Column("storage_provider", sa.String()),
        sa.Column("storage_bucket", sa.String()),
        sa.Column("storage_path", sa.Text()),
        sa.Column("public_url", sa.Text()),
        # pending / downloading / downloaded / uploading / uploaded / verified /
        # failed_retryable / failed_terminal——management command 的狀態機
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("content_type", sa.String()),
        sa.Column("byte_size", sa.Integer()),
        sa.Column("sha256", sa.String()),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_error", sa.Text()),
        sa.Column("next_retry_at", sa.DateTime()),
        sa.Column("migrated_at", sa.DateTime()),
        sa.Column("verified_at", sa.DateTime()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime()),
    )
    op.create_index(
        "ix_media_asset_source",
        "media_asset",
        ["source_provider", "source_kind", "source_locator"],
        unique=True,
    )
    op.create_index("ix_media_asset_status", "media_asset", ["status"])

    with op.batch_alter_table("word_audio") as batch_op:
        batch_op.add_column(sa.Column("media_asset_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_word_audio_media_asset_id_media_asset", "media_asset", ["media_asset_id"], ["id"]
        )
        batch_op.create_index("ix_word_audio_media_asset_id", ["media_asset_id"])

    with op.batch_alter_table("word_explanation_sentence_audio") as batch_op:
        batch_op.add_column(sa.Column("media_asset_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_word_explanation_sentence_audio_media_asset_id_media_asset",
            "media_asset", ["media_asset_id"], ["id"]
        )
        batch_op.create_index("ix_word_explanation_sentence_audio_media_asset_id", ["media_asset_id"])

    with op.batch_alter_table("word_explanation_image") as batch_op:
        batch_op.add_column(sa.Column("media_asset_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_word_explanation_image_media_asset_id_media_asset",
            "media_asset", ["media_asset_id"], ["id"]
        )
        batch_op.create_index("ix_word_explanation_image_media_asset_id", ["media_asset_id"])


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("word_explanation_image") as batch_op:
        batch_op.drop_constraint("fk_word_explanation_image_media_asset_id_media_asset", type_="foreignkey")
        batch_op.drop_index("ix_word_explanation_image_media_asset_id")
        batch_op.drop_column("media_asset_id")

    with op.batch_alter_table("word_explanation_sentence_audio") as batch_op:
        batch_op.drop_constraint(
            "fk_word_explanation_sentence_audio_media_asset_id_media_asset", type_="foreignkey"
        )
        batch_op.drop_index("ix_word_explanation_sentence_audio_media_asset_id")
        batch_op.drop_column("media_asset_id")

    with op.batch_alter_table("word_audio") as batch_op:
        batch_op.drop_constraint("fk_word_audio_media_asset_id_media_asset", type_="foreignkey")
        batch_op.drop_index("ix_word_audio_media_asset_id")
        batch_op.drop_column("media_asset_id")

    op.drop_index("ix_media_asset_status", table_name="media_asset")
    op.drop_index("ix_media_asset_source", table_name="media_asset")
    op.drop_table("media_asset")
