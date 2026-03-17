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