from sqlalchemy import Column, Integer, String, Text, Boolean
from fastAPI.routes.connect import Base

class Word(Base):
    __tablename__ = "words"

    id = Column(String, primary_key=True, index=True)
    tribe_id = Column(String)
    tribe = Column(String)
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
    sources = Column(Text)
    explanation_items = Column(Text)
    audio_items = Column(Text)
    is_derivative_root = Column(Boolean, default=False)
    is_image = Column(Boolean, default=False)
    is_zuzucidian = Column(Boolean, default=False)
    is_other_dialect = Column(Boolean, default=False)


class GrammarSection(Base):
    """文法章節（最高層級，例如「一、時態與時貌系統」）"""
    __tablename__ = "grammar_section"

    id = Column(String, nullable=False, primary_key=True)
    tribe = Column(String, nullable=False, index=True)
    section_order = Column(Integer)
    section_key = Column(String)   # 短識別鍵，例如 "TAM"、"focus"、"case"
    title = Column(String)         # 顯示用標題
    description = Column(Text)     # 章節說明（JSON 字串，存非規則的補充資訊）


class GrammarRule(Base):
    """文法規則（章節內的個別規則，例如「現在進行式」「主事焦點」）"""
    __tablename__ = "grammar_rule"

    id = Column(String, nullable=False, primary_key=True)
    section_id = Column(String, nullable=False, index=True)  # FK → grammar_section.id
    tribe = Column(String, nullable=False, index=True)
    rule_order = Column(Integer)
    rule_key = Column(String)      # 原始 JSON key，例如 "1_現在進行式"
    title = Column(String)         # 顯示用標題
    structure = Column(Text)       # 句型結構說明
    function = Column(Text)        # 功能說明
    notes = Column(Text)           # 補充說明、例外、方言差異
    affix_tags = Column(Text)      # JSON array，關聯詞綴，供搜尋用，例如 ["mi-", "ma-"]


class GrammarExample(Base):
    """文法例句（可關聯 words 表的單字）"""
    __tablename__ = "grammar_example"

    id = Column(String, nullable=False, primary_key=True)
    rule_id = Column(String, nullable=False, index=True)  # FK → grammar_rule.id
    tribe = Column(String, nullable=False, index=True)
    example_order = Column(Integer)
    tribe_text = Column(Text)       # 族語原文
    chinese_text = Column(Text)     # 中文翻譯
    analysis = Column(Text)         # 形態分析
    linked_word_ids = Column(Text)  # JSON array，對應 words.id，供題目生成與關聯用


class GrammarAffix(Base):
    """詞綴索引（供搜尋、題目生成用）"""
    __tablename__ = "grammar_affix"

    id = Column(String, nullable=False, primary_key=True)
    tribe = Column(String, nullable=False, index=True)
    affix = Column(String, nullable=False, index=True)  # 例如 "mi-"、"-en"、"-an"
    affix_type = Column(String)    # prefix / suffix / infix / reduplication / circumfix
    function = Column(Text)        # 功能說明
    example_form = Column(Text)    # 用法範例，例如 "mi-facal（洗）"
    rule_ids = Column(Text)        # JSON array，關聯的 grammar_rule.id