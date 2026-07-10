"""decompose word explanation audio and source into normalized tables

Revision ID: 90bc362710d9
Revises: 00a315a8dfa8
Create Date: 2026-07-04 19:09:26.112051

"""
import json
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '90bc362710d9'
down_revision: Union[str, Sequence[str], None] = '00a315a8dfa8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _chunks(lst, size=5000):
    for i in range(0, len(lst), size):
        yield lst[i:i + size]


def upgrade() -> None:
    bind = op.get_bind()

    # ---------- 1. 先把資料整批撈進 Python 記憶體 ----------
    # explanation_items[].id、sentenceItems[].id 在原始資料裡並非唯一
    # （同一個 id 會出現在多個不同的字上面），不能拿來當新表的 PK，
    # 這裡一律用重新配發的流水號 id，原本的 id 只留做 external_id 追蹤用。
    #
    # anaphoraItems[].id 有些對應到 words.id（約 7 成），有些原本就是
    # null（標點符號、未收錄詞），還有極少數（796 筆／全部 210279 筆中）
    # 是指到「資料庫裡已經不存在」的字——這三種情況都會讓 word_id 存 NULL，
    # 只有真的能對應到現存 words.id 時才會寫入這個 FK。
    word_rows = bind.execute(sa.text("SELECT id, sources, explanation_items, audio_items FROM words")).fetchall()
    word_ids_set = {r[0] for r in word_rows}

    # ---------- 2. 立刻移除 words 原本的三個 JSON 欄位 ----------
    # 這一步必須在任何用 ondelete="CASCADE" 指到 words.id 的新表建立之前做。
    # SQLite 沒有原生 ALTER TABLE DROP COLUMN，batch_alter_table 是用
    # 「建新表→搬資料→砍舊表→改新表名字」的方式模擬，其中「砍舊表」這一步
    # 只要有其他表用 ON DELETE CASCADE 參照 words.id，就會被當成
    # 「words 整批被刪除」而觸發級聯刪除，把新表裡剛寫入的資料整批砍光。
    # 所以要先砍完欄位、確定 words 表穩定下來，才能建立會參照它的子表。
    with op.batch_alter_table("words") as batch_op:
        batch_op.drop_column("sources")
        batch_op.drop_column("explanation_items")
        batch_op.drop_column("audio_items")

    # ---------- 3. 建立新表 ----------
    op.create_table(
        "source",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(), nullable=False),
    )
    op.create_index("ix_source_name", "source", ["name"], unique=True)

    op.create_table(
        "word_source",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("word_id", sa.String(), sa.ForeignKey("words.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_id", sa.Integer(), sa.ForeignKey("source.id"), nullable=False),
        sa.Column("sort_order", sa.Integer()),
    )
    op.create_index("ix_word_source_word_id", "word_source", ["word_id"])
    op.create_index("ix_word_source_source_id", "word_source", ["source_id"])

    op.create_table(
        "word_audio",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("word_id", sa.String(), sa.ForeignKey("words.id", ondelete="CASCADE"), nullable=False),
        sa.Column("external_id", sa.String()),
        sa.Column("file_id", sa.String()),
        sa.Column("audio_class", sa.String()),
        sa.Column("sort_order", sa.Integer()),
    )
    op.create_index("ix_word_audio_word_id", "word_audio", ["word_id"])

    op.create_table(
        "word_explanation",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("word_id", sa.String(), sa.ForeignKey("words.id", ondelete="CASCADE"), nullable=False),
        sa.Column("external_id", sa.String()),
        sa.Column("sort_order", sa.Integer()),
        sa.Column("chinese_explanation", sa.Text()),
        sa.Column("english_explanation", sa.Text()),
    )
    op.create_index("ix_word_explanation_word_id", "word_explanation", ["word_id"])

    op.create_table(
        "category",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(), nullable=False),
    )
    op.create_index("ix_category_name", "category", ["name"], unique=True)

    op.create_table(
        "word_explanation_category",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("explanation_id", sa.Integer(), sa.ForeignKey("word_explanation.id", ondelete="CASCADE"), nullable=False),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("category.id"), nullable=False),
    )
    op.create_index("ix_word_explanation_category_explanation_id", "word_explanation_category", ["explanation_id"])
    op.create_index("ix_word_explanation_category_category_id", "word_explanation_category", ["category_id"])

    op.create_table(
        "part_of_speech",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(), nullable=False),
    )
    op.create_index("ix_part_of_speech_name", "part_of_speech", ["name"], unique=True)

    op.create_table(
        "word_explanation_pos",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("explanation_id", sa.Integer(), sa.ForeignKey("word_explanation.id", ondelete="CASCADE"), nullable=False),
        sa.Column("pos_id", sa.Integer(), sa.ForeignKey("part_of_speech.id"), nullable=False),
    )
    op.create_index("ix_word_explanation_pos_explanation_id", "word_explanation_pos", ["explanation_id"])
    op.create_index("ix_word_explanation_pos_pos_id", "word_explanation_pos", ["pos_id"])

    op.create_table(
        "focus",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(), nullable=False),
    )
    op.create_index("ix_focus_name", "focus", ["name"], unique=True)

    op.create_table(
        "word_explanation_focus",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("explanation_id", sa.Integer(), sa.ForeignKey("word_explanation.id", ondelete="CASCADE"), nullable=False),
        sa.Column("focus_id", sa.Integer(), sa.ForeignKey("focus.id"), nullable=False),
    )
    op.create_index("ix_word_explanation_focus_explanation_id", "word_explanation_focus", ["explanation_id"])
    op.create_index("ix_word_explanation_focus_focus_id", "word_explanation_focus", ["focus_id"])

    op.create_table(
        "word_explanation_image",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("explanation_id", sa.Integer(), sa.ForeignKey("word_explanation.id", ondelete="CASCADE"), nullable=False),
        sa.Column("image_url", sa.Text()),
        sa.Column("sort_order", sa.Integer()),
    )
    op.create_index("ix_word_explanation_image_explanation_id", "word_explanation_image", ["explanation_id"])

    op.create_table(
        "word_explanation_sentence",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("explanation_id", sa.Integer(), sa.ForeignKey("word_explanation.id", ondelete="CASCADE"), nullable=False),
        sa.Column("external_id", sa.String()),
        sa.Column("sort_order", sa.Integer()),
        sa.Column("original_sentence", sa.Text()),
        sa.Column("chinese_sentence", sa.Text()),
        sa.Column("english_sentence", sa.Text()),
    )
    op.create_index("ix_word_explanation_sentence_explanation_id", "word_explanation_sentence", ["explanation_id"])

    op.create_table(
        "word_explanation_sentence_audio",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("sentence_id", sa.Integer(), sa.ForeignKey("word_explanation_sentence.id", ondelete="CASCADE"), nullable=False),
        sa.Column("external_id", sa.String()),
        sa.Column("file_id", sa.String()),
        sa.Column("audio_class", sa.String()),
        sa.Column("sort_order", sa.Integer()),
    )
    op.create_index("ix_word_explanation_sentence_audio_sentence_id", "word_explanation_sentence_audio", ["sentence_id"])

    op.create_table(
        "word_explanation_anaphora",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("sentence_id", sa.Integer(), sa.ForeignKey("word_explanation_sentence.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sort_order", sa.Integer()),
        sa.Column("is_highlight", sa.Boolean()),
        sa.Column("is_symbol", sa.Boolean()),
    )
    op.create_index("ix_word_explanation_anaphora_sentence_id", "word_explanation_anaphora", ["sentence_id"])

    op.create_table(
        "word_explanation_anaphora_item",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("anaphora_id", sa.Integer(), sa.ForeignKey("word_explanation_anaphora.id", ondelete="CASCADE"), nullable=False),
        sa.Column("word_id", sa.String(), sa.ForeignKey("words.id"), nullable=True),
        sa.Column("name", sa.String()),
        sa.Column("sort_order", sa.Integer()),
    )
    op.create_index("ix_word_explanation_anaphora_item_anaphora_id", "word_explanation_anaphora_item", ["anaphora_id"])
    op.create_index("ix_word_explanation_anaphora_item_word_id", "word_explanation_anaphora_item", ["word_id"])

    # ---------- 4. 解析 JSON，組出所有子表的資料列 ----------
    source_id_map: dict = {}
    category_id_map: dict = {}
    pos_id_map: dict = {}
    focus_id_map: dict = {}

    def get_or_create(id_map, name):
        if name not in id_map:
            id_map[name] = len(id_map) + 1
        return id_map[name]

    word_source_rows = []
    word_audio_rows = []
    word_explanation_rows = []
    word_explanation_category_rows = []
    word_explanation_pos_rows = []
    word_explanation_focus_rows = []
    word_explanation_image_rows = []
    word_explanation_sentence_rows = []
    word_explanation_sentence_audio_rows = []
    word_explanation_anaphora_rows = []
    word_explanation_anaphora_item_rows = []

    exp_id_counter = 1
    sent_id_counter = 1
    ana_id_counter = 1

    for word_id, sources_raw, exp_raw, audio_raw in word_rows:
        try:
            sources = json.loads(sources_raw) if sources_raw else []
        except Exception:
            sources = []
        for i, s in enumerate(sources):
            sid = get_or_create(source_id_map, s)
            word_source_rows.append({"word_id": word_id, "source_id": sid, "sort_order": i})

        try:
            audios = json.loads(audio_raw) if audio_raw else []
        except Exception:
            audios = []
        for i, a in enumerate(audios):
            word_audio_rows.append({
                "word_id": word_id,
                "external_id": a.get("id"),
                "file_id": a.get("fileId"),
                "audio_class": a.get("audioClass"),
                "sort_order": i,
            })

        try:
            explanations = json.loads(exp_raw) if exp_raw else []
        except Exception:
            explanations = []

        for exp_order, exp in enumerate(explanations):
            this_exp_id = exp_id_counter
            exp_id_counter += 1
            word_explanation_rows.append({
                "id": this_exp_id,
                "word_id": word_id,
                "external_id": exp.get("id"),
                "sort_order": exp_order,
                "chinese_explanation": exp.get("chineseExplanation"),
                "english_explanation": exp.get("englishExplanation"),
            })

            for c in (exp.get("category") or []):
                cid = get_or_create(category_id_map, c)
                word_explanation_category_rows.append({"explanation_id": this_exp_id, "category_id": cid})

            for p in (exp.get("partOfSpeech") or []):
                pid = get_or_create(pos_id_map, p)
                word_explanation_pos_rows.append({"explanation_id": this_exp_id, "pos_id": pid})

            for f in (exp.get("focus") or []):
                fid = get_or_create(focus_id_map, f)
                word_explanation_focus_rows.append({"explanation_id": this_exp_id, "focus_id": fid})

            for img_order, img in enumerate(exp.get("imageUrl") or []):
                word_explanation_image_rows.append({
                    "explanation_id": this_exp_id, "image_url": img, "sort_order": img_order
                })

            for sent_order, sent in enumerate(exp.get("sentenceItems") or []):
                this_sent_id = sent_id_counter
                sent_id_counter += 1
                word_explanation_sentence_rows.append({
                    "id": this_sent_id,
                    "explanation_id": this_exp_id,
                    "external_id": sent.get("id"),
                    "sort_order": sent_order,
                    "original_sentence": sent.get("originalSentence"),
                    "chinese_sentence": sent.get("chineseSentence"),
                    "english_sentence": sent.get("englishSentence"),
                })

                for a_order, a in enumerate(sent.get("audioItems") or []):
                    word_explanation_sentence_audio_rows.append({
                        "sentence_id": this_sent_id,
                        "external_id": a.get("id"),
                        "file_id": a.get("fileId"),
                        "audio_class": a.get("audioClass"),
                        "sort_order": a_order,
                    })

                for ana_order, ana in enumerate(sent.get("anaphoraSentence") or []):
                    this_ana_id = ana_id_counter
                    ana_id_counter += 1
                    word_explanation_anaphora_rows.append({
                        "id": this_ana_id,
                        "sentence_id": this_sent_id,
                        "sort_order": ana_order,
                        "is_highlight": bool(ana.get("isHighlight")),
                        "is_symbol": bool(ana.get("isSymbol")),
                    })

                    for item_order, item in enumerate(ana.get("anaphoraItems") or []):
                        item_id = item.get("id")
                        fk_word_id = item_id if item_id in word_ids_set else None
                        word_explanation_anaphora_item_rows.append({
                            "anaphora_id": this_ana_id,
                            "word_id": fk_word_id,
                            "name": item.get("name"),
                            "sort_order": item_order,
                        })

    # ---------- 5. 批次寫入 ----------
    def bulk_insert(table_name, columns, rows):
        if not rows:
            return
        table = sa.table(table_name, *[sa.column(c) for c in columns])
        for chunk in _chunks(rows):
            bind.execute(sa.insert(table), chunk)

    bulk_insert("source", ["id", "name"], [{"id": v, "name": k} for k, v in source_id_map.items()])
    bulk_insert("category", ["id", "name"], [{"id": v, "name": k} for k, v in category_id_map.items()])
    bulk_insert("part_of_speech", ["id", "name"], [{"id": v, "name": k} for k, v in pos_id_map.items()])
    bulk_insert("focus", ["id", "name"], [{"id": v, "name": k} for k, v in focus_id_map.items()])

    bulk_insert("word_source", ["word_id", "source_id", "sort_order"], word_source_rows)
    bulk_insert("word_audio", ["word_id", "external_id", "file_id", "audio_class", "sort_order"], word_audio_rows)
    bulk_insert(
        "word_explanation",
        ["id", "word_id", "external_id", "sort_order", "chinese_explanation", "english_explanation"],
        word_explanation_rows,
    )
    bulk_insert("word_explanation_category", ["explanation_id", "category_id"], word_explanation_category_rows)
    bulk_insert("word_explanation_pos", ["explanation_id", "pos_id"], word_explanation_pos_rows)
    bulk_insert("word_explanation_focus", ["explanation_id", "focus_id"], word_explanation_focus_rows)
    bulk_insert("word_explanation_image", ["explanation_id", "image_url", "sort_order"], word_explanation_image_rows)
    bulk_insert(
        "word_explanation_sentence",
        ["id", "explanation_id", "external_id", "sort_order", "original_sentence", "chinese_sentence", "english_sentence"],
        word_explanation_sentence_rows,
    )
    bulk_insert(
        "word_explanation_sentence_audio",
        ["sentence_id", "external_id", "file_id", "audio_class", "sort_order"],
        word_explanation_sentence_audio_rows,
    )
    bulk_insert(
        "word_explanation_anaphora",
        ["id", "sentence_id", "sort_order", "is_highlight", "is_symbol"],
        word_explanation_anaphora_rows,
    )
    bulk_insert(
        "word_explanation_anaphora_item",
        ["anaphora_id", "word_id", "name", "sort_order"],
        word_explanation_anaphora_item_rows,
    )

    # alembic 對 SQLite 的 context.begin_transaction() 是「假設 DDL 不用交易」的模式，
    # 不會主動幫這些用 bind.execute() 直接下的 DML 做 commit，這裡手動 commit 一次
    # 確保資料落地（不這麼做的話，交由呼叫端事後的動作決定要不要 commit 並不可靠）。
    bind.commit()

    # 上面這次手動 commit() 之後，這個連線會在下一次 execute 時（SQLAlchemy 2.x 的
    # autobegin）自動重新開一個新交易；alembic 緊接著要把 alembic_version 更新成這支
    # migration 的版本號，剛好就落在這個新交易裡，而 alembic 在 SQLite 的「非交易式
    # DDL」模式下不會主動 commit，交易會在連線關閉時被靜默 rollback——alembic_version
    # 因此停留在上一版（down_revision），下次執行 `alembic upgrade head` 會誤以為這支
    # migration 還沒套用而重新執行一次，撞上資料表已存在而失敗（已在全新空 DB 上實測
    # 重現）。把連線切成 AUTOCOMMIT，讓「這支 migration 的 DML」跟「alembic 接下來
    # 自己寫入版本號」都各自立刻落地，不再依賴會被靜默吃掉的顯式 commit。
    bind.execution_options(isolation_level="AUTOCOMMIT")


def downgrade() -> None:
    bind = op.get_bind()

    # 跟 upgrade() 反過來：words 的 batch_alter_table（新增欄位）一樣會觸發
    # 子表對 words.id 的 ON DELETE CASCADE，把子表資料級聯刪光。所以必須先把
    # 所有子表的資料整批撈進 Python 記憶體、組回 JSON 字串，才能動 words 的
    # 欄位；等 words 復原後，直接用記憶體裡的資料寫回去，不再依賴這些子表。
    word_ids = [r[0] for r in bind.execute(sa.text("SELECT id FROM words")).fetchall()]

    reconstructed: dict = {}

    for word_id in word_ids:
        sources = [
            row[0] for row in bind.execute(
                sa.text("""
                    SELECT s.name FROM word_source ws JOIN source s ON s.id = ws.source_id
                    WHERE ws.word_id = :wid ORDER BY ws.sort_order
                """), {"wid": word_id}
            ).fetchall()
        ]

        audio_items = [
            {"id": row[0], "fileId": row[1], "audioClass": row[2]}
            for row in bind.execute(
                sa.text("""
                    SELECT external_id, file_id, audio_class FROM word_audio
                    WHERE word_id = :wid ORDER BY sort_order
                """), {"wid": word_id}
            ).fetchall()
        ]

        explanations = []
        exp_rows = bind.execute(
            sa.text("""
                SELECT id, external_id, chinese_explanation, english_explanation
                FROM word_explanation WHERE word_id = :wid ORDER BY sort_order
            """), {"wid": word_id}
        ).fetchall()
        for exp_id, ext_id, cn, en in exp_rows:
            categories = [r[0] for r in bind.execute(
                sa.text("""
                    SELECT c.name FROM word_explanation_category wec JOIN category c ON c.id = wec.category_id
                    WHERE wec.explanation_id = :eid
                """), {"eid": exp_id}
            ).fetchall()]
            pos_list = [r[0] for r in bind.execute(
                sa.text("""
                    SELECT p.name FROM word_explanation_pos wep JOIN part_of_speech p ON p.id = wep.pos_id
                    WHERE wep.explanation_id = :eid
                """), {"eid": exp_id}
            ).fetchall()]
            focus_list = [r[0] for r in bind.execute(
                sa.text("""
                    SELECT f.name FROM word_explanation_focus wef JOIN focus f ON f.id = wef.focus_id
                    WHERE wef.explanation_id = :eid
                """), {"eid": exp_id}
            ).fetchall()]
            images = [r[0] for r in bind.execute(
                sa.text("SELECT image_url FROM word_explanation_image WHERE explanation_id = :eid ORDER BY sort_order"),
                {"eid": exp_id}
            ).fetchall()]

            sentence_items = []
            sent_rows = bind.execute(
                sa.text("""
                    SELECT id, external_id, original_sentence, chinese_sentence, english_sentence
                    FROM word_explanation_sentence WHERE explanation_id = :eid ORDER BY sort_order
                """), {"eid": exp_id}
            ).fetchall()
            for sent_id, sent_ext_id, orig, cn_s, en_s in sent_rows:
                sent_audio_items = [
                    {"id": r[0], "fileId": r[1], "audioClass": r[2]}
                    for r in bind.execute(
                        sa.text("""
                            SELECT external_id, file_id, audio_class FROM word_explanation_sentence_audio
                            WHERE sentence_id = :sid ORDER BY sort_order
                        """), {"sid": sent_id}
                    ).fetchall()
                ]

                anaphora_sentence = []
                ana_rows = bind.execute(
                    sa.text("""
                        SELECT id, is_highlight, is_symbol FROM word_explanation_anaphora
                        WHERE sentence_id = :sid ORDER BY sort_order
                    """), {"sid": sent_id}
                ).fetchall()
                for ana_id, is_hl, is_sym in ana_rows:
                    anaphora_items = [
                        {"id": r[0], "name": r[1]}
                        for r in bind.execute(
                            sa.text("""
                                SELECT word_id, name FROM word_explanation_anaphora_item
                                WHERE anaphora_id = :aid ORDER BY sort_order
                            """), {"aid": ana_id}
                        ).fetchall()
                    ]
                    anaphora_sentence.append({
                        "anaphoraItems": anaphora_items,
                        "isHighlight": bool(is_hl),
                        "isSymbol": bool(is_sym),
                    })

                sentence_items.append({
                    "id": sent_ext_id,
                    "originalSentence": orig,
                    "chineseSentence": cn_s,
                    "englishSentence": en_s,
                    "audioItems": sent_audio_items,
                    "anaphoraSentence": anaphora_sentence,
                })

            explanations.append({
                "id": ext_id,
                "chineseExplanation": cn,
                "englishExplanation": en,
                "category": categories,
                "partOfSpeech": pos_list,
                "focus": focus_list,
                "imageUrl": images,
                "sentenceItems": sentence_items,
            })

        reconstructed[word_id] = (sources, explanations, audio_items)

    # 子表資料都已經在記憶體裡了，接下來動 words 的 schema 會把它們級聯刪光也無妨
    with op.batch_alter_table("words") as batch_op:
        batch_op.add_column(sa.Column("sources", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("explanation_items", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("audio_items", sa.Text(), nullable=True))

    for word_id, (sources, explanations, audio_items) in reconstructed.items():
        bind.execute(
            sa.text("UPDATE words SET sources = :s, explanation_items = :e, audio_items = :a WHERE id = :wid"),
            {
                "s": json.dumps(sources, ensure_ascii=False),
                "e": json.dumps(explanations, ensure_ascii=False),
                "a": json.dumps(audio_items, ensure_ascii=False),
                "wid": word_id,
            }
        )

    bind.commit()

    # 同 upgrade() 下方的說明：手動 commit() 之後這個連線會自動重新開一個新交易，
    # 下面這一串 drop_table 以及 alembic 接下來要寫回 alembic_version 舊版本號的
    # UPDATE 都會落在裡面，若不主動 commit 會在連線關閉時被靜默 rollback。切成
    # AUTOCOMMIT 讓每一步都立刻落地。
    bind.execution_options(isolation_level="AUTOCOMMIT")

    op.drop_table("word_explanation_anaphora_item")
    op.drop_table("word_explanation_anaphora")
    op.drop_table("word_explanation_sentence_audio")
    op.drop_table("word_explanation_sentence")
    op.drop_table("word_explanation_image")
    op.drop_table("word_explanation_focus")
    op.drop_table("focus")
    op.drop_table("word_explanation_pos")
    op.drop_table("part_of_speech")
    op.drop_table("word_explanation_category")
    op.drop_table("category")
    op.drop_table("word_explanation")
    op.drop_table("word_audio")
    op.drop_table("word_source")
    op.drop_table("source")
