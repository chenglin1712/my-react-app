"""詞形分析服務（routes/morphology/service.py）與端點（api.py）。

資料用「合成語言」：隨機的 CV 音節詞根，衍生詞一律是 "ma"+詞根（前綴 ma-），所以每個
案例的正確答案都已知。資料庫是記憶體內 SQLite（只用 ORM 查詢，不依賴 PostgreSQL）。

要鎖住的行為：
- 辭典有標註詞根就只顯示辭典的；沒標註的詞條只信通過校準的規則；辭典查不到的詞形才顯示全部規則結果；
- 每個結果都標明來源與信心，「拼寫相近」永遠是低信心、不附詞綴切分；
- 輸入驗證、不支援的族語、資料不足的族語都有明確的訊息。
"""
import random
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from config import morphology as M
from config.tribes import TRIBES
from dictionary_db.connect import get_db
from dictionary_db.model import (
    Base, GrammarAffix, Tribe, TranslationAttestedForm, Word, WordAudio, WordExplanation,
    WordExplanationSentence, WordExplanationSentenceAudio,
)
from fastAPI.main import app
from fastAPI.routes import auth as auth_module
from fastAPI.routes.morphology import service as S
from fastAPI.routes.morphology.schemas import AnalyzeResponse, TokenInfoOut
from fastAPI.routes.translation import morph as translation_morph

_TRIBE = TRIBES[0]
P_MA = M.MorphRule("P", a="ma")
_N_ROOTS = 600
_N_DERIVED = 520          # 前 520 個詞根有 "ma"+詞根 的衍生詞，超過 MIN_PAIRS_FOR_RULES


def _roots(n=_N_ROOTS, seed=2):
    rng = random.Random(seed)
    out = set()
    while len(out) < n:
        out.add("".join(rng.choice("ptkbdgmnlrsh") + rng.choice("aiueo") for _ in range(rng.choice((2, 3)))) + rng.choice("ptkbdgmnlrsh"))
    return sorted(out)


ROOTS = _roots()


def _seed(db, tribe, derived_count=_N_DERIVED):
    db.add(Tribe(id=tribe.id, name=tribe.full_name, slug=tribe.slug))
    words = []
    for i, root in enumerate(ROOTS):
        words.append(Word(id=f"r{i}", name=root, tribe_id=tribe.id))
    for i, root in enumerate(ROOTS[:derived_count]):
        words.append(Word(id=f"d{i}", name="ma" + root, tribe_id=tribe.id, derivative_root=root))
    # 一個沒有標註詞根、但名字長得像 ma-+詞根 的詞條（辭典詞條沒標註的情境）
    words.append(Word(id="plain", name="ma" + ROOTS[551], tribe_id=tribe.id))
    db.add_all(words)
    db.flush()

    # 詞根 0：有釋義、3 個例句（測例句上限 2）、有單詞音檔；詞根 550：有釋義與 1 個例句
    for wid, gloss, sentences in (("r0", "示範詞根", 3), ("r550", "另一個詞根", 1)):
        exp = WordExplanation(word_id=wid, sort_order=1, chinese_explanation=gloss)
        db.add(exp)
        db.flush()
        for j in range(sentences):
            sent = WordExplanationSentence(explanation_id=exp.id, sort_order=j, original_sentence=f"{wid} 例句{j}", chinese_sentence=f"中文{j}")
            db.add(sent)
            db.flush()
            db.add(WordExplanationSentenceAudio(sentence_id=sent.id, file_id=f"sa-{wid}-{j}", sort_order=1))
    db.add(WordAudio(word_id="r0", file_id="audio-r0", sort_order=1))

    # 一個「辭典沒有詞條、但在例句裡出現過」的詞形
    attested_sent = WordExplanationSentence(explanation_id=1, sort_order=9, original_sentence="含 ma" + ROOTS[552] + " 的句子",
                                            chinese_sentence="出處句子")
    db.add(attested_sent)
    db.flush()
    db.add(TranslationAttestedForm(tribe_id=tribe.id, surface_form_norm="ma" + ROOTS[552], source_sentence_id=attested_sent.id))
    db.add(TranslationAttestedForm(tribe_id=tribe.id, surface_form_norm="nosource", source_sentence_id=None))
    # 同形異義：同名的兩個詞條（不同釋義），兩者共用一個例句、第二個另有一個獨有例句
    db.add_all([Word(id="h1", name="hgroot", tribe_id=tribe.id), Word(id="h2", name="hgroot", tribe_id=tribe.id)])
    db.flush()
    for wid, gloss, sentences in (("h1", "釋義甲", ["共同例句"]), ("h2", "釋義乙", ["共同例句", "獨有例句"])):
        exp = WordExplanation(word_id=wid, sort_order=1, chinese_explanation=gloss)
        db.add(exp)
        db.flush()
        for j, original in enumerate(sentences):
            db.add(WordExplanationSentence(explanation_id=exp.id, sort_order=j, original_sentence=original, chinese_sentence="中文"))
    db.add(GrammarAffix(tribe_id=tribe.id, affix="ma-", affix_type="prefix", function="示範功能", example_form=None))
    db.commit()


@pytest.fixture(scope="module")
def session_factory():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    with factory() as db:
        _seed(db, _TRIBE)
    return factory


@pytest.fixture
def db(session_factory):
    S.invalidate()
    session = session_factory()
    with patch.object(translation_morph, "get_entry", return_value=translation_morph._Entry(None, {}, "停用")):
        yield session
    session.close()
    S.invalidate()


def _admit(*rules):
    """讓 translation_morph 回報這些規則『通過獨立測試校準』。"""
    analyzer = M.MorphAnalyzer({r: 20 for r in rules}, set(), precision={r: 0.9 for r in rules})
    return patch.object(translation_morph, "get_entry", return_value=translation_morph._Entry(analyzer, {}))


class TestRuleAnalysisOfUnknownForms:
    def test_form_missing_from_the_dictionary_gets_a_rule_based_root_with_segments_and_function(self, db):
        r = S.analyze(db, "tayal", "ma" + ROOTS[550])
        assert r.token.status == "unknown"
        c = r.candidates[0]
        assert (c.source, c.root) == ("rule", ROOTS[550])
        assert [(s.text, s.kind) for s in c.segments] == [("ma", "affix"), (ROOTS[550], "root")]
        assert c.rule.marker == "ma-" and c.rule.function == "示範功能" and c.rule.kind == "P"
        assert c.gloss == "另一個詞根"
        assert [e.original for e in c.examples] == ["r550 例句0"]

    def test_confidence_is_medium_unless_the_rule_passed_the_independent_calibration(self, db):
        assert S.analyze(db, "tayal", "ma" + ROOTS[550]).candidates[0].confidence == "medium"
        S.invalidate()
        with _admit(P_MA):
            r = S.analyze(db, "tayal", "ma" + ROOTS[550])
        assert r.candidates[0].confidence == "high" and r.admittedRuleCount == 1

    def test_input_is_normalized_like_the_dictionary_does(self, db):
        upper = S.analyze(db, "tayal", ("MA" + ROOTS[550]).upper())
        assert upper.normalized == "ma" + ROOTS[550] and upper.candidates[0].root == ROOTS[550]

    def test_apostrophe_variants_and_edge_hyphens_are_normalized(self, db):
        assert S.analyze(db, "tayal", "-ma" + ROOTS[550] + "-").normalized == "ma" + ROOTS[550]
        assert S.analyze(db, "tayal", "ma" + ROOTS[550] + "^").normalized == "ma" + ROOTS[550]

    def test_examples_are_capped_and_audio_ids_are_passed_through(self, db):
        # 這個詞根有 3 個例句，只回 2 個；音檔 id 要帶出來給前端播放。
        c = S.analyze(db, "tayal", "ma" + ROOTS[0]).candidates[0]    # 詞條本身有辭典標註的詞根 → 詞根 0
        assert c.root == ROOTS[0] and c.gloss == "示範詞根" and c.audioFileId == "audio-r0"
        assert len(c.examples) == 2 and c.examples[0].audioFileId == "sa-r0-0"


class TestHomographs:
    def test_homographs_are_merged_into_one_candidate_with_all_glosses(self, db):
        c = S.analyze(db, "tayal", "mahgroot").candidates[0]
        assert c.root == "hgroot" and c.gloss == "釋義甲 ／ 釋義乙"
        assert c.rootWordIds == ["h1", "h2"]

    def test_the_same_example_sentence_is_not_listed_twice(self, db):
        c = S.analyze(db, "tayal", "mahgroot").candidates[0]
        assert [e.original for e in c.examples] == ["共同例句", "獨有例句"]


class _Stub:
    """假的分析器：analyze() 直接回傳預先準備好的結果，用來單獨測「怎麼挑、怎麼過濾」的邏輯。"""
    def __init__(self, hits):
        self.hits = hits

    def analyze(self, token, top_n=3):
        return self.hits[:top_n]


def _stub_data(db, *, exact=(), fuzzy=(), extra_index=None):
    index = {f"f{i}": (f"r{i}",) for i in range(12)}            # 12 個相近詞候選，對應到合成資料裡真的存在的詞條
    index.update(extra_index or {})
    return S._TribeData(
        tribe_id=_TRIBE.id, lexicon_index=index, n_pairs=600, rules_available=True,
        exact=_Stub(list(exact)), fuzzy=_Stub(list(fuzzy)), admitted=frozenset(), functions={},
    )


def _fuzzy_hit(i):
    return M.Analysis(f"f{i}", P_MA, 0.5, "fuzzy", 1, 20)


def _exact_hit(i):
    return M.Analysis(f"f{i}", P_MA, 0.9, "exact", 0, 20)


class TestSimilarWordSelection:
    def test_positive_control_unknown_form_without_any_other_lead_gets_suggestions(self, db):
        with patch.object(S, "_tribe_data", return_value=_stub_data(db, fuzzy=[_fuzzy_hit(1), _fuzzy_hit(2)])):
            r = S.analyze(db, "tayal", "zzzzaaa")
        assert [c.source for c in r.candidates] == ["similar", "similar"]

    def test_suggestions_are_not_added_when_a_rule_already_explains_the_form(self, db):
        data = _stub_data(db, exact=[_exact_hit(1)], fuzzy=[_fuzzy_hit(2)])
        with patch.object(S, "_tribe_data", return_value=data):
            r = S.analyze(db, "tayal", "zzzzaaa")
        assert [c.source for c in r.candidates] == ["rule"]

    def test_suggestions_are_not_added_for_forms_that_are_dictionary_headwords(self, db):
        data = _stub_data(db, fuzzy=[_fuzzy_hit(2)], extra_index={"zzzzaaa": ("r3",)})
        with patch.object(S, "_tribe_data", return_value=data):
            r = S.analyze(db, "tayal", "zzzzaaa")
        assert r.token.status == "headword" and all(c.source != "similar" for c in r.candidates)

    def test_suggestions_are_capped_and_deduplicated(self, db):
        hits = [_fuzzy_hit(i) for i in range(10)] + [_fuzzy_hit(0), _fuzzy_hit(1)]
        with patch.object(S, "_tribe_data", return_value=_stub_data(db, fuzzy=hits)):
            r = S.analyze(db, "tayal", "zzzzaaa")
        roots = [c.root for c in r.candidates]
        assert len(roots) == S.MAX_SIMILAR and len(set(roots)) == len(roots)

    def test_exact_stage_results_from_the_fuzzy_analyzer_are_not_shown_as_suggestions(self, db):
        # fuzzy 分析器的結果裡也會混有直接命中的（stage=exact）；那些不是「相近」，不能標成相近的詞。
        with patch.object(S, "_tribe_data", return_value=_stub_data(db, fuzzy=[_exact_hit(1), _fuzzy_hit(2)])):
            r = S.analyze(db, "tayal", "zzzzaaa")
        assert [(c.source, c.root) for c in r.candidates] == [("similar", "f2")]


class TestDictionaryHeadwords:
    def test_headword_with_an_annotated_root_shows_only_the_dictionary_answer(self, db):
        r = S.analyze(db, "tayal", "ma" + ROOTS[0])
        assert r.token.status == "headword" and r.token.lemma == "ma" + ROOTS[0]
        assert [(c.source, c.confidence) for c in r.candidates] == [("dictionary", "dictionary")]
        # 辭典的詞根也要附上切分與規則說明（規則可由這對詞推得時）。
        assert [(s.text, s.kind) for s in r.candidates[0].segments] == [("ma", "affix"), (ROOTS[0], "root")]

    def test_rule_results_are_not_stacked_on_top_of_a_dictionary_annotation(self, db):
        with _admit(P_MA):
            r = S.analyze(db, "tayal", "ma" + ROOTS[0])
        assert [c.source for c in r.candidates] == ["dictionary"]

    def test_unannotated_headword_shows_no_uncalibrated_rule_guess(self, db):
        # 辭典約一半的詞條沒標註詞根，它們多半本身就是詞根；規則亂拆只會誤導。
        r = S.analyze(db, "tayal", "ma" + ROOTS[551])
        assert r.token.status == "headword" and r.candidates == []
        assert any("可能本身就是詞根" in n for n in r.notes)

    def test_unannotated_headword_still_shows_a_calibrated_rule(self, db):
        with _admit(P_MA):
            r = S.analyze(db, "tayal", "ma" + ROOTS[551])
        assert [(c.source, c.confidence, c.root) for c in r.candidates] == [("rule", "high", ROOTS[551])]

    def test_a_plain_root_headword_has_nothing_to_analyze(self, db):
        r = S.analyze(db, "tayal", ROOTS[3])
        assert r.token.status == "headword" and r.candidates == []

    def test_the_form_itself_is_never_offered_as_its_own_root(self, db):
        for word in ("ma" + ROOTS[0], ROOTS[3], "ma" + ROOTS[551]):
            assert all(c.root != S.lexicon.normalize_token(word) for c in S.analyze(db, "tayal", word).candidates)


class TestAttestedForms:
    def test_form_seen_in_dictionary_sentences_reports_where(self, db):
        r = S.analyze(db, "tayal", "ma" + ROOTS[552])
        assert r.token.status == "attested"
        s = r.token.attestedSentence
        assert s.isTokenSource and s.chinese == "出處句子" and "ma" + ROOTS[552] in s.original

    def test_attested_form_without_a_stored_source_sentence_is_still_attested(self, db):
        r = S.analyze(db, "tayal", "nosource")
        assert r.token.status == "attested" and r.token.attestedSentence is None

    def test_attested_form_still_gets_rule_analysis_since_it_has_no_dictionary_entry(self, db):
        r = S.analyze(db, "tayal", "ma" + ROOTS[552])
        assert [(c.source, c.root) for c in r.candidates] == [("rule", ROOTS[552])]


class TestSimilarWords:
    def _typo(self):
        root = ROOTS[550]
        return "ma" + root[:-1] + ("a" if root[-1] != "a" else "e")

    def test_a_misspelling_gets_low_confidence_suggestions_without_segmentation(self, db):
        r = S.analyze(db, "tayal", self._typo())
        sims = [c for c in r.candidates if c.source == "similar"]
        assert sims and ROOTS[550] in {c.root for c in sims}
        for c in sims:
            assert c.confidence == "low" and c.distance == 1
            assert c.segments is None and c.rule is None      # 不是形態分析，不能假裝有切分

    def test_suggestions_are_capped(self, db):
        assert len([c for c in S.analyze(db, "tayal", self._typo()).candidates if c.source == "similar"]) <= S.MAX_SIMILAR

    def test_no_suggestions_when_rules_already_explain_the_form(self, db):
        assert all(c.source != "similar" for c in S.analyze(db, "tayal", "ma" + ROOTS[550]).candidates)

    def test_no_suggestions_for_forms_that_are_in_the_dictionary(self, db):
        assert all(c.source != "similar" for c in S.analyze(db, "tayal", ROOTS[3]).candidates)

    def test_gibberish_gets_nothing_and_says_so(self, db):
        r = S.analyze(db, "tayal", "zzzqqqxxxvvv")
        assert r.candidates == [] and any("找不到可信的分析結果" in n for n in r.notes)


class TestValidationAndSupport:
    @pytest.mark.parametrize("bad,reason", [
        ("", "請輸入"), ("   ", "請輸入"), ("two words", "空白"), ("a\tb", "空白"),
        ("123", "英文字母"), ("ma/root", "英文字母"), ("魚", "英文字母"), ("a" * (S.MAX_WORD_LEN + 1), "太長"),
    ])
    def test_invalid_input_is_rejected_with_a_readable_reason(self, db, bad, reason):
        with pytest.raises(S.InvalidWordError, match=reason):
            S.analyze(db, "tayal", bad)

    def test_unsupported_tribe_is_rejected(self, db):
        with pytest.raises(S.UnsupportedTribeError):
            S.analyze(db, "klingon", "abc")

    def test_tribe_may_be_given_as_slug_or_full_name(self, db):
        assert S.analyze(db, "tayal", ROOTS[3]).tribeSlug == S.analyze(db, _TRIBE.full_name, ROOTS[3]).tribeSlug == "tayal"

    def test_the_insufficient_data_note_names_the_actual_pair_count(self, session_factory):
        other = TRIBES[2]
        with session_factory() as db:
            db.add(Tribe(id=other.id, name=other.full_name, slug=other.slug))
            db.add_all([Word(id=f"p{i}", name=r, tribe_id=other.id) for i, r in enumerate(ROOTS[:30])])
            db.add_all([Word(id=f"pd{i}", name="ma" + r, tribe_id=other.id, derivative_root=r) for i, r in enumerate(ROOTS[:7])])
            db.commit()
            S.invalidate()
            with patch.object(translation_morph, "get_entry", return_value=translation_morph._Entry(None, {}, "停用")):
                r = S.analyze(db, other.slug, "ma" + ROOTS[20])
        assert any("只有 7 筆" in n and "不足以自動歸納" in n for n in r.notes)
        S.invalidate()

    def test_tribe_with_too_little_annotation_data_reports_it_and_skips_rules(self, session_factory):
        # 另一個族語只有少數幾筆衍生詞標註：不做規則分析、不做相近詞建議，並明確說明原因。
        other = TRIBES[1]
        with session_factory() as db:
            db.add(Tribe(id=other.id, name=other.full_name, slug=other.slug))
            db.add_all([Word(id=f"o{i}", name=r, tribe_id=other.id) for i, r in enumerate(ROOTS[:50])])
            db.add_all([Word(id=f"od{i}", name="ma" + r, tribe_id=other.id, derivative_root=r) for i, r in enumerate(ROOTS[:20])])
            db.commit()
            S.invalidate()
            with patch.object(translation_morph, "get_entry", return_value=translation_morph._Entry(None, {}, "停用")):
                r = S.analyze(db, other.slug, "ma" + ROOTS[30])
                annotated = S.analyze(db, other.slug, "ma" + ROOTS[0])
        assert r.rulesAvailable is False and r.candidates == [] and any("不足以自動歸納" in n for n in r.notes)
        assert [c.source for c in annotated.candidates] == ["dictionary"]      # 辭典標註的詞根仍然會顯示
        S.invalidate()

    def test_tribe_without_calibrated_rules_says_so(self, db):
        r = S.analyze(db, "tayal", "ma" + ROOTS[550])
        assert r.admittedRuleCount == 0 and any("沒有通過獨立測試校準" in n for n in r.notes)


class TestCaching:
    def test_the_tribe_analyzer_is_built_once_and_rebuilt_after_invalidation(self, db):
        with patch.object(S, "_build_tribe_data", wraps=S._build_tribe_data) as build:
            S.analyze(db, "tayal", ROOTS[3])
            S.analyze(db, "tayal", ROOTS[4])
            assert build.call_count == 1
            S.invalidate(_TRIBE.id)
            S.analyze(db, "tayal", ROOTS[3])
            assert build.call_count == 2
            S.invalidate()
            S.analyze(db, "tayal", ROOTS[3])
            assert build.call_count == 3


class TestEndpoint:
    @pytest.fixture
    def client(self):
        async def _fake_auth():
            return {"uid": "test-user"}
        app.dependency_overrides[auth_module.verify_firebase_token] = _fake_auth
        app.dependency_overrides[get_db] = lambda: iter([None])
        try:
            with TestClient(app) as c:
                yield c
        finally:
            app.dependency_overrides.clear()

    def _ok(self):
        return AnalyzeResponse(tribe="泰雅語", tribeSlug="tayal", input="x", normalized="x",
                               token=TokenInfoOut(status="unknown"), candidates=[], rulesAvailable=True,
                               admittedRuleCount=0, notes=[])

    def test_success_returns_the_documented_shape(self, client):
        with patch("fastAPI.routes.morphology.api._run", return_value=self._ok()) as run:
            resp = client.post("/api/v1/morphology/analyze", json={"tribe": "tayal", "word": "x"})
        assert resp.status_code == 200
        assert set(resp.json()) == {"tribe", "tribeSlug", "input", "normalized", "token", "candidates",
                                    "rulesAvailable", "admittedRuleCount", "notes"}
        run.assert_called_once_with("tayal", "x")

    @pytest.mark.parametrize("exc", [S.InvalidWordError("請輸入要分析的詞形"), S.UnsupportedTribeError("不支援的族語：x")])
    def test_domain_errors_become_400_with_the_message(self, client, exc):
        with patch("fastAPI.routes.morphology.api._run", side_effect=exc):
            resp = client.post("/api/v1/morphology/analyze", json={"tribe": "tayal", "word": "x"})
        assert resp.status_code == 400 and resp.json()["detail"] == str(exc)

    def test_unexpected_errors_become_503_without_leaking_details(self, client):
        with patch("fastAPI.routes.morphology.api._run", side_effect=RuntimeError("SELECT secret FROM internal")):
            resp = client.post("/api/v1/morphology/analyze", json={"tribe": "tayal", "word": "x"})
        assert resp.status_code == 503 and "secret" not in resp.text

    @pytest.mark.parametrize("body", [{}, {"tribe": "tayal"}, {"word": "x"}, {"tribe": "tayal", "word": ""},
                                      {"tribe": "tayal", "word": "a" * 41}, {"tribe": "t" * 21, "word": "x"}])
    def test_request_validation(self, client, body):
        assert client.post("/api/v1/morphology/analyze", json=body).status_code == 422

    def test_requires_login(self, monkeypatch):
        # 沒有覆寫認證依賴、且開發用的登入略過被明確關閉時，沒帶 token 不能呼叫（跟其他
        # /api/v1 端點一樣）。要自己關掉略過：開發環境的 .env 可能開著它。
        monkeypatch.setenv("AUTH_DEV_BYPASS", "False")
        app.dependency_overrides.clear()
        with patch("fastAPI.routes.morphology.api._run") as run, TestClient(app) as c:
            resp = c.post("/api/v1/morphology/analyze", json={"tribe": "tayal", "word": "x"})
        assert resp.status_code in (401, 403)
        run.assert_not_called()

    def test_the_real_pipeline_runs_end_to_end_through_the_endpoint(self, client, session_factory):
        S.invalidate()
        with patch("fastAPI.routes.morphology.api.SessionLocal", session_factory), \
             patch.object(translation_morph, "get_entry", return_value=translation_morph._Entry(None, {}, "停用")):
            resp = client.post("/api/v1/morphology/analyze", json={"tribe": "tayal", "word": "ma" + ROOTS[550]})
        S.invalidate()
        assert resp.status_code == 200
        body = resp.json()
        assert body["candidates"][0]["root"] == ROOTS[550] and body["candidates"][0]["confidence"] == "medium"
