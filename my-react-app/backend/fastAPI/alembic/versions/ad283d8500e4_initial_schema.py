"""initial schema

Revision ID: ad283d8500e4
Revises:
Create Date: 2026-07-10 00:00:00.000000

這支 migration 補上原本缺失的「起點」。在此之前唯一的 base migration
(00a315a8dfa8) 是直接對 words/grammar_section/grammar_affix 這幾個表做
batch_alter_table（ALTER），隱含假設它們已經存在——對一個全新的空資料庫執行
`alembic upgrade head` 會直接失敗，因為這幾個表根本還沒被 CREATE 過。

這裡 CREATE 出 00a315a8dfa8 執行「之前」的原始 schema（去正規化版本，tribe
還是字串欄位、words 還有 sources/explanation_items/audio_items 這三個 JSON
TEXT 欄位），欄位定義與索引是從現有 dictionary.db 的實際 schema，對照
00a315a8dfa8 的 upgrade()/downgrade() 反推還原。grammar_rule、grammar_example、
grammar_rule_affix、grammar_example_word 這四張表沒有被任何一支既有 migration
改動過，直接照 dictionary.db 現況建立。

tribe 表刻意不在這裡建——它是 00a315a8dfa8 upgrade() 新增的表，維持由那支
migration 負責建立與塞初始資料。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ad283d8500e4'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "words",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("tribe_id", sa.String(), nullable=True),
        sa.Column("tribe", sa.String(), nullable=True),
        sa.Column("dialect", sa.String(), nullable=True),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("pinyin", sa.String(), nullable=True),
        sa.Column("variant", sa.String(), nullable=True),
        sa.Column("formation_word", sa.String(), nullable=True),
        sa.Column("derivative_root", sa.String(), nullable=True),
        sa.Column("frequency", sa.Integer(), nullable=True),
        sa.Column("hit", sa.Integer(), nullable=True),
        sa.Column("dictionary_note", sa.Text(), nullable=True),
        sa.Column("word_img", sa.Text(), nullable=True),
        sa.Column("is_derivative_root", sa.Boolean(), nullable=True),
        sa.Column("is_image", sa.Boolean(), nullable=True),
        sa.Column("is_zuzucidian", sa.Boolean(), nullable=True),
        sa.Column("is_other_dialect", sa.Boolean(), nullable=True),
        sa.Column("sources", sa.Text(), nullable=True),
        sa.Column("explanation_items", sa.Text(), nullable=True),
        sa.Column("audio_items", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_words_name", "words", ["name"])
    op.create_index("ix_words_tribe_id", "words", ["tribe_id"])

    op.create_table(
        "grammar_section",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("section_order", sa.Integer(), nullable=True),
        sa.Column("section_key", sa.String(), nullable=True),
        sa.Column("title", sa.String(), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("tribe", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_table(
        "grammar_affix",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("affix", sa.String(), nullable=False),
        sa.Column("affix_type", sa.String(), nullable=True),
        sa.Column("function", sa.Text(), nullable=True),
        sa.Column("example_form", sa.Text(), nullable=True),
        sa.Column("tribe", sa.String(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_grammar_affix_tribe", "grammar_affix", ["tribe"])

    op.create_table(
        "grammar_rule",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("section_id", sa.Integer(), nullable=False),
        sa.Column("rule_order", sa.Integer(), nullable=True),
        sa.Column("rule_key", sa.String(), nullable=True),
        sa.Column("title", sa.String(), nullable=True),
        sa.Column("structure", sa.Text(), nullable=True),
        sa.Column("function", sa.Text(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["section_id"], ["grammar_section.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_grammar_rule_section", "grammar_rule", ["section_id"])

    op.create_table(
        "grammar_example",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("rule_id", sa.Integer(), nullable=False),
        sa.Column("example_order", sa.Integer(), nullable=True),
        sa.Column("tribe_text", sa.Text(), nullable=True),
        sa.Column("chinese_text", sa.Text(), nullable=True),
        sa.Column("analysis", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["rule_id"], ["grammar_rule.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_grammar_example_rule", "grammar_example", ["rule_id"])

    op.create_table(
        "grammar_rule_affix",
        sa.Column("rule_id", sa.Integer(), nullable=False),
        sa.Column("affix_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["rule_id"], ["grammar_rule.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["affix_id"], ["grammar_affix.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("rule_id", "affix_id"),
    )

    op.create_table(
        "grammar_example_word",
        sa.Column("example_id", sa.Integer(), nullable=False),
        sa.Column("word_id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["example_id"], ["grammar_example.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("example_id", "word_id"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("grammar_example_word")
    op.drop_table("grammar_rule_affix")
    op.drop_index("idx_grammar_example_rule", table_name="grammar_example")
    op.drop_table("grammar_example")
    op.drop_index("idx_grammar_rule_section", table_name="grammar_rule")
    op.drop_table("grammar_rule")
    op.drop_index("idx_grammar_affix_tribe", table_name="grammar_affix")
    op.drop_table("grammar_affix")
    op.drop_table("grammar_section")
    op.drop_index("ix_words_tribe_id", table_name="words")
    op.drop_index("ix_words_name", table_name="words")
    op.drop_table("words")
