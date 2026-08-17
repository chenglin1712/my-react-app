"""add junction table unique constraints and grammar_example_word fk

Revision ID: 9e468bdaf95e
Revises: 86d389a704d0
Create Date: 2026-08-17 23:16:18.441201

P4 review BE-21／BE-22：word_source／word_explanation_category／
word_explanation_pos／word_explanation_focus 這四張多對多 junction table
只有 surrogate id 當主鍵，(parent_id, term_id) 這一對本身完全沒有唯一性
約束——adminapi/dictionary_write/tree_reconcile.py 的 _sync_id_junction()
只在應用層去重（新增前先查一次現有配對），但這只是「正常路徑」的防呆，
不是資料庫層的保證：並行寫入、批次匯入、或未經過這支 service 的腳本仍然
可能建立出重複配對。grammar_rule_affix／grammar_example_word 這兩張同類型
junction table則刻意用複合主鍵（rule_id, affix_id）／（example_id, word_id）
本身就唯一，不在這次修正範圍內。

grammar_example_word.word_id 只在程式碼裡靠註解「對應 words.id（TEXT）」
標示語意，沒有真正的 FK 約束——跟同一份 model 裡 word_explanation_
anaphora_item.word_id（已經有 ForeignKey("words.id")）不一致。這裡補上
FK，比照該欄位的既有慣例。故意不設 ondelete=CASCADE：這個欄位是複合主鍵
的一部分本來就不可為 NULL，adminapi/dictionary_write/word_service.py 的
delete_word_tree() 早就會在 unlink_references=True 時明確刪除引用它的
grammar_example_word 列、或在還有引用又沒有 unlink_references 時直接拒絕
刪除（ReferencedError）——正常路徑本來就不會留下孤兒列。用預設的
RESTRICT／NO ACTION 只是把這個既有的應用層不變量也做成資料庫層的硬保證：
任何繞過 delete_word_tree() 的腳本或意外刪除路徑，一旦還有
grammar_example_word 引用著，資料庫會直接拒絕刪除該筆 words 列，而不是
悄悄留下孤兒紀錄讓文法讀取端只能容忍或漏資料。

套用前已對本機資料庫（30,684 筆詞條、33,894 筆 word_source、7,516／5,241／
6,155 筆 word_explanation_category／pos／focus）跑過唯讀稽核，四張表皆為
0 筆重複配對；grammar_example_word 目前是空表（文法內容尚未匯入），沒有
歷史孤兒資料需要清理，因此加 unique constraint／FK 都不需要先跑資料清理
腳本。正式環境（Postgres）若已有資料，部署前務必先用同樣的 GROUP BY ...
HAVING COUNT(*) > 1 查詢重新跑一次稽核，若真的有重複配對，必須先手動決定
保留哪一筆並清除其餘的，migration 才能成功套用。

改用 op.batch_alter_table() 而非直接 op.create_unique_constraint()／
op.create_foreign_key()：SQLite 不支援直接 ALTER TABLE ADD CONSTRAINT，
batch 模式在 SQLite 上會自動改用「建臨時表→搬資料→砍舊表→改名」達成同樣
效果，在 Postgres 等原生支援 ALTER 的資料庫上則直接下 ALTER TABLE，兩邊
用同一份 migration 定義即可。這裡動的都是「葉節點」junction table 本身
（沒有其他表用 FK 指到它們），不是 bd80bf38fb2d 那次踩過的坑——那次的
坑是「batch 模式砍掉被其他表 CASCADE 參照的父表（words）時，父表砍掉
那一步會把子表資料整批級聯刪光」，這裡砍的都是最末端、沒有任何表參照
它們的表，不會觸發連鎖刪除。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '9e468bdaf95e'
down_revision: Union[str, Sequence[str], None] = '86d389a704d0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("word_source") as batch_op:
        batch_op.create_unique_constraint(
            "uq_word_source_word_id_source_id", ["word_id", "source_id"],
        )

    with op.batch_alter_table("word_explanation_category") as batch_op:
        batch_op.create_unique_constraint(
            "uq_word_explanation_category_explanation_id_category_id",
            ["explanation_id", "category_id"],
        )

    with op.batch_alter_table("word_explanation_pos") as batch_op:
        batch_op.create_unique_constraint(
            "uq_word_explanation_pos_explanation_id_pos_id",
            ["explanation_id", "pos_id"],
        )

    with op.batch_alter_table("word_explanation_focus") as batch_op:
        batch_op.create_unique_constraint(
            "uq_word_explanation_focus_explanation_id_focus_id",
            ["explanation_id", "focus_id"],
        )

    with op.batch_alter_table("grammar_example_word") as batch_op:
        batch_op.create_foreign_key(
            "fk_grammar_example_word_word_id_words",
            "words", ["word_id"], ["id"],
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("grammar_example_word") as batch_op:
        batch_op.drop_constraint("fk_grammar_example_word_word_id_words", type_="foreignkey")

    with op.batch_alter_table("word_explanation_focus") as batch_op:
        batch_op.drop_constraint("uq_word_explanation_focus_explanation_id_focus_id", type_="unique")

    with op.batch_alter_table("word_explanation_pos") as batch_op:
        batch_op.drop_constraint("uq_word_explanation_pos_explanation_id_pos_id", type_="unique")

    with op.batch_alter_table("word_explanation_category") as batch_op:
        batch_op.drop_constraint("uq_word_explanation_category_explanation_id_category_id", type_="unique")

    with op.batch_alter_table("word_source") as batch_op:
        batch_op.drop_constraint("uq_word_source_word_id_source_id", type_="unique")
