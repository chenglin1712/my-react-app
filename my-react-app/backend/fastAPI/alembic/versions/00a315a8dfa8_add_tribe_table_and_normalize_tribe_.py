"""add tribe table and normalize tribe references

Revision ID: 00a315a8dfa8
Revises: 
Create Date: 2026-07-04 17:46:50.513239

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '00a315a8dfa8'
down_revision: Union[str, Sequence[str], None] = 'ad283d8500e4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# words.tribe_id 目前實際存在的 5 個族語 UUID（來自 dictionary.db 現有資料，
# 跟 listening.py/sentence.py 裡 TRIBE_IDS 的值一致）
TRIBES = [
    ("fc76ed97-0dd8-4587-82ad-7a6dbe125001", "泰雅語", "tayal"),
    ("e68273b9-1f2b-4c42-8d95-f52189ab24b7", "阿美語", "amis"),
    ("865a96e3-3384-45b3-8bd0-e1f799b75515", "布農語", "bunun"),
    ("c5974f37-b49d-466a-ab24-6893ab4ef6a5", "葛瑪蘭語", "kavalan"),
    ("19c77a3b-3a81-496f-b0f4-afe6d9155edd", "排灣語", "paiwan"),
]

# words 表裡「阿美語」有兩個 tribe_id：主要的 e68273b9...（8,751 筆）
# 跟一個完全沒被任何程式碼引用過的孤兒 UUID（58 筆）。視為資料誤植，遷移時併入主要的 UUID。
ORPHAN_AMIS_TRIBE_ID = "a3f8c2d1-4e5b-6789-abcd-ef0123456789"
CANONICAL_AMIS_TRIBE_ID = "e68273b9-1f2b-4c42-8d95-f52189ab24b7"


def upgrade() -> None:
    """Upgrade schema."""
    bind = op.get_bind()

    # 1. 新增 tribe 主檔表，並塞入目前實際存在的 5 個族語
    op.create_table(
        "tribe",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tribe_name", "tribe", ["name"], unique=True)
    op.create_index("ix_tribe_slug", "tribe", ["slug"], unique=True)

    tribe_table = sa.table(
        "tribe",
        sa.column("id", sa.String),
        sa.column("name", sa.String),
        sa.column("slug", sa.String),
    )
    op.bulk_insert(
        tribe_table,
        [{"id": tid, "name": name, "slug": slug} for tid, name, slug in TRIBES],
    )

    # 2. 把孤兒 tribe_id 併入主要的阿美語 UUID（58 筆）
    bind.execute(
        sa.text("UPDATE words SET tribe_id = :canonical WHERE tribe_id = :orphan"),
        {"canonical": CANONICAL_AMIS_TRIBE_ID, "orphan": ORPHAN_AMIS_TRIBE_ID},
    )

    # 3. words.tribe 完全由 tribe_id 決定，屬於傳遞依賴，移除該欄位並幫 tribe_id 補上 FK
    with op.batch_alter_table("words") as batch_op:
        batch_op.drop_column("tribe")
        batch_op.create_foreign_key(
            "fk_words_tribe_id_tribe", "tribe", ["tribe_id"], ["id"]
        )

    # 4. grammar_section.tribe 原本是純字串，改成參照 tribe.id 的 FK
    with op.batch_alter_table("grammar_section") as batch_op:
        batch_op.add_column(sa.Column("tribe_id", sa.String(), nullable=True))
    bind.execute(
        sa.text(
            "UPDATE grammar_section SET tribe_id = "
            "(SELECT id FROM tribe WHERE tribe.name = grammar_section.tribe)"
        )
    )
    with op.batch_alter_table("grammar_section") as batch_op:
        batch_op.alter_column("tribe_id", nullable=False)
        batch_op.drop_column("tribe")
        batch_op.create_foreign_key(
            "fk_grammar_section_tribe_id_tribe", "tribe", ["tribe_id"], ["id"]
        )
        batch_op.create_index("ix_grammar_section_tribe_id", ["tribe_id"])

    # 5. grammar_affix.tribe 比照 grammar_section 做法
    with op.batch_alter_table("grammar_affix") as batch_op:
        batch_op.add_column(sa.Column("tribe_id", sa.String(), nullable=True))
    bind.execute(
        sa.text(
            "UPDATE grammar_affix SET tribe_id = "
            "(SELECT id FROM tribe WHERE tribe.name = grammar_affix.tribe)"
        )
    )
    with op.batch_alter_table("grammar_affix") as batch_op:
        # idx_grammar_affix_tribe 是早期用原生 SQL 建立的索引（命名沒有照 SQLAlchemy 慣例），
        # 建在即將被移除的 tribe 欄位上，batch 模式重建資料表時會照著反射出來的既有索引
        # 一併重建，必須先明確 drop 掉，不然新資料表沒有 tribe 欄位卻要幫它建索引會報錯
        batch_op.drop_index("idx_grammar_affix_tribe")
        batch_op.alter_column("tribe_id", nullable=False)
        batch_op.drop_column("tribe")
        batch_op.create_foreign_key(
            "fk_grammar_affix_tribe_id_tribe", "tribe", ["tribe_id"], ["id"]
        )
        batch_op.create_index("ix_grammar_affix_tribe_id", ["tribe_id"])


def downgrade() -> None:
    """Downgrade schema."""
    bind = op.get_bind()

    with op.batch_alter_table("grammar_affix") as batch_op:
        batch_op.drop_constraint("fk_grammar_affix_tribe_id_tribe", type_="foreignkey")
        batch_op.drop_index("ix_grammar_affix_tribe_id")
        batch_op.add_column(sa.Column("tribe", sa.String(), nullable=True))
    bind.execute(
        sa.text(
            "UPDATE grammar_affix SET tribe = "
            "(SELECT name FROM tribe WHERE tribe.id = grammar_affix.tribe_id)"
        )
    )
    with op.batch_alter_table("grammar_affix") as batch_op:
        batch_op.alter_column("tribe", nullable=False)
        batch_op.drop_column("tribe_id")
        batch_op.create_index("idx_grammar_affix_tribe", ["tribe"])

    with op.batch_alter_table("grammar_section") as batch_op:
        batch_op.drop_constraint("fk_grammar_section_tribe_id_tribe", type_="foreignkey")
        batch_op.drop_index("ix_grammar_section_tribe_id")
        batch_op.add_column(sa.Column("tribe", sa.String(), nullable=True))
    bind.execute(
        sa.text(
            "UPDATE grammar_section SET tribe = "
            "(SELECT name FROM tribe WHERE tribe.id = grammar_section.tribe_id)"
        )
    )
    with op.batch_alter_table("grammar_section") as batch_op:
        batch_op.alter_column("tribe", nullable=False)
        batch_op.drop_column("tribe_id")

    with op.batch_alter_table("words") as batch_op:
        batch_op.drop_constraint("fk_words_tribe_id_tribe", type_="foreignkey")
        batch_op.add_column(sa.Column("tribe", sa.String(), nullable=True))
    bind.execute(
        sa.text(
            "UPDATE words SET tribe = (SELECT name FROM tribe WHERE tribe.id = words.tribe_id)"
        )
    )
    # 注意：孤兒 tribe_id 併入主要 UUID 的動作無法還原（原始的 58 筆已經拿不回原本的 tribe_id 值）

    op.drop_index("ix_tribe_slug", table_name="tribe")
    op.drop_index("ix_tribe_name", table_name="tribe")
    op.drop_table("tribe")
