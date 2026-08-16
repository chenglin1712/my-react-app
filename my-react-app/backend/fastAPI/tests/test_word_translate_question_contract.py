"""_build_word_translate_question() 的 payload 欄位契約。

之前這裡欄位叫 "cn"，但前端 wordTranslation.jsx 判分／顯示正確答案讀的是
question.answer（quiz_recommon_question.jsx 把 payload 直接攤平成 question
的頂層欄位）——兩邊對不上，question.answer 永遠是 undefined，導致這個
題型不管使用者選什麼都被判成答錯，而且完全沒有測試蓋到這個 payload 形狀
才會沒被抓到。這裡直接鎖住欄位名稱，之後要改動也會在這裡先炸開。
"""
from fastAPI.routes import quiz as quiz_module
from fastAPI.routes.quiz import WordDTO, _build_word_translate_question


def test_word_translate_question_payload_uses_answer_not_cn(monkeypatch):
    monkeypatch.setattr(quiz_module, "_word_explanations_cache", {
        "w1": [{"chineseExplanation": "石頭"}],
    })
    monkeypatch.setattr(quiz_module, "_word_audios_cache", {})

    w = WordDTO(id="w1", name="batu", frequency=10)
    all_words = [
        w,
        WordDTO(id="w2", name="qoqay", frequency=5),
        WordDTO(id="w3", name="hi'in", frequency=5),
        WordDTO(id="w4", name="rgyax", frequency=5),
    ]

    question = _build_word_translate_question(w, all_words, "wt-w1-0")

    assert question["payload"]["answer"] == "石頭"
    assert "cn" not in question["payload"]
    assert question["payload"]["answer"] in question["payload"]["options"]
