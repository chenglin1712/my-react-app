from sqlalchemy import Column, Integer, String, Text, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from dictionary_db.connect import Base


class Tribe(Base):
    """族語主檔。tribe_id 原本跟 tribe（中文全名）並存於 words 表，
    兩者是傳遞依賴關係，改成獨立的 Tribe 表，其他表只保留 tribe_id 當 FK。"""
    __tablename__ = "tribe"

    id = Column(String, primary_key=True)
    name = Column(String, nullable=False, unique=True, index=True)   # 中文全名，例如「泰雅語」
    slug = Column(String, nullable=False, unique=True, index=True)   # 英文代稱，例如「tayal」


class Word(Base):
    __tablename__ = "words"

    id = Column(String, primary_key=True, index=True)
    tribe_id = Column(String, ForeignKey("tribe.id"), index=True)
    tribe_ref = relationship("Tribe")
    dialect = Column(String)
    name = Column(String, index=True)
    pinyin = Column(String)
    variant = Column(String)
    formation_word = Column(String)
    derivative_root = Column(String)
    frequency = Column(Integer)
    hit = Column(Integer)
    dictionary_note = Column(Text)
    word_img = Column(Text)
    is_derivative_root = Column(Boolean, default=False)
    is_image = Column(Boolean, default=False)
    is_zuzucidian = Column(Boolean, default=False)
    is_other_dialect = Column(Boolean, default=False)


class GrammarSection(Base):
    """文法章節（最高層級，例如「一、時態與時貌系統」）"""
    __tablename__ = "grammar_section"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    tribe_id      = Column(String, ForeignKey("tribe.id"), nullable=False, index=True)
    tribe_ref     = relationship("Tribe")
    section_order = Column(Integer)
    section_key   = Column(String)
    title         = Column(String)
    description   = Column(Text)    # 純文字，不需 JSON 編碼


class GrammarRule(Base):
    """文法規則（章節內的個別規則，例如「進行式」「施事者焦點」）"""
    __tablename__ = "grammar_rule"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    section_id = Column(Integer, ForeignKey("grammar_section.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    rule_order = Column(Integer)
    rule_key   = Column(String)
    title      = Column(String)
    structure  = Column(Text)
    function   = Column(Text)
    notes      = Column(Text)
    # 多對多關係改由 grammar_rule_affix junction table 維護


class GrammarExample(Base):
    """文法例句"""
    __tablename__ = "grammar_example"

    id            = Column(Integer, primary_key=True, autoincrement=True)
    rule_id       = Column(Integer, ForeignKey("grammar_rule.id", ondelete="CASCADE"),
                           nullable=False, index=True)
    example_order = Column(Integer)
    tribe_text    = Column(Text)
    chinese_text  = Column(Text)
    analysis      = Column(Text)
    # 多對多關係改由 grammar_example_word junction table 維護


class GrammarAffix(Base):
    """詞綴索引（供搜尋、題目生成用）"""
    __tablename__ = "grammar_affix"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    tribe_id     = Column(String, ForeignKey("tribe.id"), nullable=False, index=True)
    tribe_ref    = relationship("Tribe")
    affix        = Column(String, nullable=False, index=True)
    affix_type   = Column(String)    # prefix / suffix / infix / circumfix / reduplication / auxiliary
    function     = Column(Text)
    example_form = Column(Text)
    # 多對多關係改由 grammar_rule_affix junction table 維護


class GrammarRuleAffix(Base):
    """grammar_rule ↔ grammar_affix 多對多 junction table"""
    __tablename__ = "grammar_rule_affix"

    rule_id  = Column(Integer, ForeignKey("grammar_rule.id",  ondelete="CASCADE"), primary_key=True)
    affix_id = Column(Integer, ForeignKey("grammar_affix.id", ondelete="CASCADE"), primary_key=True)


class GrammarExampleWord(Base):
    """grammar_example ↔ words 多對多 junction table"""
    __tablename__ = "grammar_example_word"

    example_id = Column(Integer, ForeignKey("grammar_example.id", ondelete="CASCADE"), primary_key=True)
    word_id    = Column(String, primary_key=True)  # 對應 words.id（TEXT）


# ----------------------------------------------------------------------------
# words.sources / explanation_items / audio_items 原本是塞了多筆資料的 JSON TEXT
# 欄位，違反 1NF。以下拆成獨立資料表；category/partOfSpeech/focus/sources 這幾個
# 欄位的值來自固定的小詞彙表，額外拆出 lookup 表以消除重複字串。
# ----------------------------------------------------------------------------

class Source(Base):
    """資料來源 lookup 表，例如「線上辭典」「九階教材」"""
    __tablename__ = "source"

    id   = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, unique=True, index=True)


class WordSource(Base):
    """words ↔ source 多對多 junction table"""
    __tablename__ = "word_source"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    word_id    = Column(String, ForeignKey("words.id", ondelete="CASCADE"), nullable=False, index=True)
    source_id  = Column(Integer, ForeignKey("source.id"), nullable=False, index=True)
    sort_order = Column(Integer)


class WordAudio(Base):
    """單字本身的發音音檔（words.audio_items 拆出來的）"""
    __tablename__ = "word_audio"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    word_id     = Column(String, ForeignKey("words.id", ondelete="CASCADE"), nullable=False, index=True)
    external_id = Column(String)   # 原本 JSON 裡的 id，僅供追蹤，不保證唯一
    file_id     = Column(String)
    audio_class = Column(String)
    sort_order  = Column(Integer)


class WordExplanation(Base):
    """單字的一筆釋義（words.explanation_items 拆出來的）"""
    __tablename__ = "word_explanation"

    id                  = Column(Integer, primary_key=True, autoincrement=True)
    word_id             = Column(String, ForeignKey("words.id", ondelete="CASCADE"), nullable=False, index=True)
    external_id         = Column(String)   # 原本 JSON 裡的 id；同一個 id 會出現在多個字，不能當 PK
    sort_order          = Column(Integer)
    chinese_explanation = Column(Text)
    english_explanation = Column(Text)


class Category(Base):
    """釋義分類 lookup 表，例如「動物」「植物」"""
    __tablename__ = "category"

    id   = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, unique=True, index=True)


class WordExplanationCategory(Base):
    """word_explanation ↔ category 多對多 junction table"""
    __tablename__ = "word_explanation_category"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    explanation_id = Column(Integer, ForeignKey("word_explanation.id", ondelete="CASCADE"), nullable=False, index=True)
    category_id    = Column(Integer, ForeignKey("category.id"), nullable=False, index=True)


class PartOfSpeech(Base):
    """詞性 lookup 表，例如「名詞」「動詞」"""
    __tablename__ = "part_of_speech"

    id   = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, unique=True, index=True)


class WordExplanationPos(Base):
    """word_explanation ↔ part_of_speech 多對多 junction table"""
    __tablename__ = "word_explanation_pos"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    explanation_id = Column(Integer, ForeignKey("word_explanation.id", ondelete="CASCADE"), nullable=False, index=True)
    pos_id         = Column(Integer, ForeignKey("part_of_speech.id"), nullable=False, index=True)


class Focus(Base):
    """語態焦點 lookup 表，例如「主事」「受事」"""
    __tablename__ = "focus"

    id   = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, unique=True, index=True)


class WordExplanationFocus(Base):
    """word_explanation ↔ focus 多對多 junction table"""
    __tablename__ = "word_explanation_focus"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    explanation_id = Column(Integer, ForeignKey("word_explanation.id", ondelete="CASCADE"), nullable=False, index=True)
    focus_id       = Column(Integer, ForeignKey("focus.id"), nullable=False, index=True)


class WordExplanationImage(Base):
    """釋義的示意圖 URL（explanation_items[].imageUrl 拆出來的）"""
    __tablename__ = "word_explanation_image"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    explanation_id = Column(Integer, ForeignKey("word_explanation.id", ondelete="CASCADE"), nullable=False, index=True)
    image_url      = Column(Text)
    sort_order     = Column(Integer)


class WordExplanationSentence(Base):
    """釋義底下的例句（explanation_items[].sentenceItems 拆出來的）"""
    __tablename__ = "word_explanation_sentence"

    id                = Column(Integer, primary_key=True, autoincrement=True)
    explanation_id    = Column(Integer, ForeignKey("word_explanation.id", ondelete="CASCADE"), nullable=False, index=True)
    external_id       = Column(String)   # 原本 JSON 裡的 id；同一個 id 會出現在多個字，不能當 PK
    sort_order        = Column(Integer)
    original_sentence = Column(Text)
    chinese_sentence  = Column(Text)
    english_sentence  = Column(Text)


class WordExplanationSentenceAudio(Base):
    """例句自己的音檔（sentenceItems[].audioItems 拆出來的，跟單字本身的 word_audio 分開存）"""
    __tablename__ = "word_explanation_sentence_audio"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    sentence_id = Column(Integer, ForeignKey("word_explanation_sentence.id", ondelete="CASCADE"), nullable=False, index=True)
    external_id = Column(String)
    file_id     = Column(String)
    audio_class = Column(String)
    sort_order  = Column(Integer)


class WordExplanationAnaphora(Base):
    """例句斷詞後的其中一個片語（sentenceItems[].anaphoraSentence 拆出來的）"""
    __tablename__ = "word_explanation_anaphora"

    id           = Column(Integer, primary_key=True, autoincrement=True)
    sentence_id  = Column(Integer, ForeignKey("word_explanation_sentence.id", ondelete="CASCADE"), nullable=False, index=True)
    sort_order   = Column(Integer)
    is_highlight = Column(Boolean, default=False)
    is_symbol    = Column(Boolean, default=False)


class WordExplanationAnaphoraItem(Base):
    """斷詞片語裡的個別詞條（anaphoraSentence[].anaphoraItems 拆出來的）。
    word_id 是原始資料裡就有的「這個詞對應到哪個辭典詞條」的關聯，
    約 3 成的詞（標點符號、未收錄詞）沒有對應詞條，word_id 允許 NULL。"""
    __tablename__ = "word_explanation_anaphora_item"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    anaphora_id = Column(Integer, ForeignKey("word_explanation_anaphora.id", ondelete="CASCADE"), nullable=False, index=True)
    word_id     = Column(String, ForeignKey("words.id"), nullable=True, index=True)
    name        = Column(String)
    sort_order  = Column(Integer)