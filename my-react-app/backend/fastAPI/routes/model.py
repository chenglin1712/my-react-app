from sqlalchemy import Column, Integer, String, Text, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from fastAPI.routes.connect import Base


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