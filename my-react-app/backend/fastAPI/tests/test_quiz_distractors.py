"""測驗的詞形干擾項（routes/quiz/distractors.py）與它接進句子填空題的方式。

要鎖住的行為：
- 干擾項是「同詞根換別的詞綴／中綴放錯位置」，而且絕不是辭典或語料裡有的詞形、也不是答案本身；
- 撞詞率太高的詞綴組合（實測常常換出真詞）不用；
- 造不出來（沒標註詞根、特殊字元、資料不足）就退回隨機干擾項；旗標關閉或任何一步出錯也退回，
  不能讓出題失敗；
- 引擎造的詞形沒有音檔，所以只要用了任何一個，整題都不附音檔（否則「有沒有喇叭圖示」會洩漏答案）。
"""
import random
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from config import morphology as M
from config.tribes import TRIBES
from dictionary_db.model import Base, GrammarAffix, Tribe, TranslationAttestedForm, Word
from fastAPI.routes.quiz import distractors as D
from fastAPI.routes.quiz import generator, repository
from fastAPI.routes.quiz.schemas import WordDTO

MA = M.MorphRule("P", a="ma")
PA = M.MorphRule("P", a="pa")
PI = M.MorphRule("P", a="pi")
AN = M.MorphRule("S", a="an")
IN1 = M.MorphRule("I", a="in", k=1)
_TRIBE = TRIBES[0]


def _kit(*, lexicon=(), attested=(), derived=None, rules=None, allow_all=True):
    """直接組一個 TribeKit；allow_all 讓所有 (正確詞綴, 替換詞綴) 組合都通過撞詞率檢查。"""
    rules = rules if rules is not None else {MA: 50, PA: 40, PI: 30, AN: 20, IN1: 20}
    stats = {}
    if allow_all:
        shifted = [M.MorphRule("I", r.a, k=k) for r in rules if r.kind == "I" for k in range(1, 5)]
        stats = {(a, b): (100, 0) for a in rules for b in [*rules, *shifted] if a != b}
    return D.TribeKit(frozenset(lexicon), frozenset(attested), derived or {}, rules, stats)


class TestCanonicalMarker:
    @pytest.mark.parametrize("raw,expected", [
        ("ma-", "ma-"), ("-an", "-an"), ("-i-（中綴）", "-i-"), ("m- / ma-", "m-"), ("-in（後綴）", "-in"),
        ("u-...-an", "u-…-an"), ("ta-…-aw", "ta-…-aw"), ("MA-", "ma-"), ("  pa-  ", "pa-"), ("", ""), (None, ""),
    ])
    def test_normalizes_the_curated_affix_spellings_to_the_rule_marker_form(self, raw, expected):
        assert D.canonical_marker(raw) == expected

    def test_matches_what_morphrule_marker_produces(self):
        assert D.canonical_marker("-in-") == IN1.marker and D.canonical_marker("ma-") == MA.marker
        assert D.canonical_marker("-an") == AN.marker


class TestDistractorsFor:
    def test_swaps_the_affix_on_the_same_root(self):
        kit = _kit(lexicon={"mafilo", "filo"}, derived={"mafilo": ("filo",)})
        got = D.distractors_for(kit, "mafilo", 3, rng=random.Random(1))
        # 換詞綴只在同一種位置的詞綴之間換（前綴換前綴），所以 ma- 只會換成 pa-、pi-
        assert sorted(d.word for d in got) == ["pafilo", "pifilo"] and {d.kind for d in got} == {D.KIND_SWAP}
        assert all("filo" in d.note and "ma-" in d.note for d in got)

    def test_never_returns_a_form_that_is_in_the_dictionary_or_attested_in_sentences(self):
        kit = _kit(lexicon={"mafilo", "filo", "pafilo"}, attested={"pifilo"}, derived={"mafilo": ("filo",)})
        for seed in range(20):
            got = {d.word for d in D.distractors_for(kit, "mafilo", 5, rng=random.Random(seed))}
            assert not got & {"pafilo", "pifilo", "mafilo", "filo"}

    def test_respects_the_count(self):
        ka, sa, mi = (M.MorphRule("P", a=a) for a in ("ka", "sa", "mi"))
        kit = _kit(lexicon={"mafilo"}, derived={"mafilo": ("filo",)}, rules={MA: 50, PA: 40, PI: 30, ka: 20, sa: 15, mi: 12})
        assert len(D.distractors_for(kit, "mafilo", 2, rng=random.Random(3))) == 2
        assert len(D.distractors_for(kit, "mafilo", 3, rng=random.Random(3))) == 3
        assert len(D.distractors_for(kit, "mafilo", 10, rng=random.Random(3))) == 5   # 只有五個可換的前綴

    def test_no_duplicate_words_even_when_different_rules_produce_the_same_string(self):
        # 詞根 tatata、中綴 a：放在第 3 或第 4 個字母之後都得到 tataata，只能出現一次
        rule0 = M.MorphRule("I", "a", k=1)
        kit = _kit(lexicon={"taatata"}, derived={"taatata": ("tatata",)}, rules={rule0: 30, MA: 10})
        for seed in range(10):
            words = [d.word for d in D.distractors_for(kit, "taatata", 10, rng=random.Random(seed))]
            assert words == ["tataata"]

    def test_a_candidate_that_happens_to_equal_the_answer_is_rejected(self):
        # 詞根 tata、中綴 a：放在第 1 或第 2 個字母之後都得到 taata。答案是 taata 時，另一個位置造出的
        # 「錯誤形」其實就是答案本身，不能當干擾項。
        rule0 = M.MorphRule("I", "a", k=1)
        kit = _kit(lexicon={"taata"}, derived={"taata": ("tata",)}, rules={rule0: 30, MA: 10})
        assert [d.word for d in D.distractors_for(kit, "taata", 10, rng=random.Random(1))] == ["tataa"]

    def test_the_answer_is_excluded_even_when_a_stale_kit_does_not_list_it(self):
        # 詞庫快取比資料庫舊（剛新增的詞條還沒進詞庫）時，答案本身也不能被當成干擾項。
        rule0 = M.MorphRule("I", "a", k=1)
        kit = _kit(lexicon=set(), derived={"taata": ("tata",)}, rules={rule0: 30, MA: 10})
        assert [d.word for d in D.distractors_for(kit, "taata", 10, rng=random.Random(1))] == ["tataa"]

    def test_target_without_a_dictionary_annotated_root_gets_nothing(self):
        kit = _kit(lexicon={"mafilo"}, derived={})
        assert D.distractors_for(kit, "mafilo") == []

    def test_target_whose_affix_is_not_a_known_common_affix_gets_nothing(self):
        # 辭典標註了詞根，但「詞綴」不在常見詞綴規則裡（例如一次性的特例）：不拿它造干擾項。
        kit = _kit(lexicon={"xyfilo"}, derived={"xyfilo": ("filo",)})
        assert D.distractors_for(kit, "xyfilo") == []

    def test_very_short_roots_are_skipped(self):
        kit = _kit(lexicon={"maab"}, derived={"maab": ("ab",)})
        assert D.distractors_for(kit, "maab") == []

    @pytest.mark.parametrize("surface", ["maFilo", "mafiʼlo", "MAFILO", "mafilo "])
    def test_surface_forms_that_normalization_would_change_are_skipped(self, surface):
        # 干擾項是從正規化形式造的；目標詞寫法特殊就不出，免得干擾項寫法一致、正解反而一眼可辨。
        kit = _kit(lexicon={"mafilo"}, derived={"mafilo": ("filo",)})
        assert D.distractors_for(kit, surface) == []

    def test_capitalized_target_gets_capitalized_distractors(self):
        kit = _kit(lexicon={"mafilo"}, derived={"mafilo": ("filo",)})
        got = D.distractors_for(kit, "Mafilo", 3, rng=random.Random(1))
        assert got and all(d.word[0].isupper() and d.word[1:] == d.word[1:].lower() for d in got)

    def test_pairs_with_too_high_a_collision_rate_or_too_few_samples_are_not_used(self):
        ka = M.MorphRule("P", a="ka")
        stats = {(MA, PA): (100, 60), (MA, PI): (5, 0), (MA, ka): (100, 3)}
        kit = D.TribeKit(frozenset({"mafilo"}), frozenset(), {"mafilo": ("filo",)}, {MA: 50, PA: 40, PI: 30, ka: 20}, stats)
        got = D.distractors_for(kit, "mafilo", 5, rng=random.Random(1))
        assert [d.word for d in got] == ["kafilo"]            # 只有 MA→ka 同時通過撞詞率與樣本數檢查

    def test_infix_positions_with_a_high_collision_rate_are_not_used(self):
        stats = {(IN1, M.MorphRule("I", "in", k=2)): (100, 50), (IN1, M.MorphRule("I", "in", k=3)): (100, 0),
                 (IN1, M.MorphRule("I", "in", k=4)): (100, 40)}
        kit = D.TribeKit(frozenset({"pinsina"}), frozenset(), {"pinsina": ("psina",)}, {IN1: 30}, stats)
        assert [d.word for d in D.distractors_for(kit, "pinsina", 5, rng=random.Random(1))] == ["psiinna"]

    def test_a_word_whose_affix_is_not_a_known_rule_gets_nothing_even_if_its_pair_was_measured(self):
        xy = M.MorphRule("P", a="xy")
        kit = D.TribeKit(frozenset({"xyfilo"}), frozenset(), {"xyfilo": ("filo",)}, {MA: 50, PA: 40}, {(xy, PA): (100, 0)})
        assert D.distractors_for(kit, "xyfilo") == []

    def test_pair_allowed_boundaries(self):
        n = D.MIN_PAIR_SAMPLES
        kit = D.TribeKit(frozenset(), frozenset(), {}, {}, {
            (MA, PA): (n, 0), (MA, PI): (n - 1, 0), (PA, MA): (n, 1),       # 剛好夠樣本且 0 次命中／少一個樣本／1 次命中
            (PA, PI): (100, 5), (PI, MA): (100, 10),                         # 命中 5% 的 Wilson 上界 <= 15%、10% 則超過
        })
        assert kit.pair_allowed(MA, PA) and not kit.pair_allowed(MA, PI)
        assert not kit.pair_allowed(PA, MA)                    # 30 個樣本 1 次命中：上界約 17%，超過
        assert kit.pair_allowed(PA, PI) and not kit.pair_allowed(PI, MA)
        assert not kit.pair_allowed(MA, AN)                    # 沒量過的組合不用

    def test_the_decision_uses_the_wilson_upper_bound_not_the_point_estimate(self):
        # 兩個組合的點估計都是 0（0 次命中），但樣本一個夠、一個不夠；用上界時 30 個樣本才過。
        from config.morphology_calibration import wilson_upper
        assert wilson_upper(0, D.MIN_PAIR_SAMPLES) <= D.MAX_PAIR_HIT_UPPER < wilson_upper(1, D.MIN_PAIR_SAMPLES)

    def test_infix_shift_puts_the_infix_after_a_different_letter(self):
        kit = _kit(lexicon={"pinsina"}, derived={"pinsina": ("psina",)},
                   rules={IN1: 30, MA: 10}, allow_all=True)
        got = D.distractors_for(kit, "pinsina", 3, rng=random.Random(1))
        shifts = [d for d in got if d.kind == D.KIND_SHIFT]
        assert shifts and shifts[0] is got[0]                  # 中綴錯位優先放第一個，題目才有兩種錯法
        # 詞根 psina、中綴 in：放在第 2、3、4 個字母之後分別是 psinina、psiinna、psinina（跟第 2 個同形，去重）
        assert sorted(d.word for d in shifts) == ["psiinna", "psinina"]      # 每個字串只出現一次
        assert all("應在第 1 個字母之後" in d.note for d in shifts)

    def test_infix_shift_never_returns_the_correct_position(self):
        kit = _kit(lexicon={"pinsina"}, derived={"pinsina": ("psina",)}, rules={IN1: 30, MA: 10})
        for seed in range(10):
            assert "pinsina" not in {d.word for d in D.distractors_for(kit, "pinsina", 6, rng=random.Random(seed))}

    def test_non_infix_rules_never_produce_infix_shift_candidates(self):
        kit = _kit(lexicon={"mafilo"}, derived={"mafilo": ("filo",)})
        assert all(d.kind == D.KIND_SWAP for d in D.distractors_for(kit, "mafilo", 6, rng=random.Random(1)))

    def test_same_infix_at_the_same_position_is_not_offered_as_a_swap(self):
        # 中綴「同詞綴換位置」是 infix-shift 的事，swap 不該把同一個中綴當成「別的詞綴」。
        kit = _kit(lexicon={"pinsina"}, derived={"pinsina": ("psina",)},
                   rules={IN1: 30, M.MorphRule("I", a="in", k=2): 20, M.MorphRule("I", a="um", k=1): 15})
        got = D.distractors_for(kit, "pinsina", 6, rng=random.Random(1))
        swaps = [d for d in got if d.kind == D.KIND_SWAP]
        assert [d.word for d in swaps] == ["pumsina"]

    def test_infix_swap_keeps_the_position_of_the_correct_affix_and_never_uses_the_others_position(self):
        # 正確答案的中綴 in 在第 1 個字母後；替換規則 um 歸納自第 3 個字母後。只換詞綴、位置沿用第 1 個，
        # 不能同時換位置（那是另一種錯法），更不能套用超出詞根長度的位置。
        um_far = M.MorphRule("I", a="um", k=3)
        kit = _kit(lexicon={"pinsina"}, derived={"pinsina": ("psina",)}, rules={IN1: 30, um_far: 15})
        swaps = [d for d in D.distractors_for(kit, "pinsina", 6, rng=random.Random(1)) if d.kind == D.KIND_SWAP]
        assert [d.word for d in swaps] == ["pumsina"]
        # 同一個替換中綴出現在不同位置（歸納出兩條規則）時，只算一個候選
        um_near = M.MorphRule("I", a="um", k=1)
        kit = _kit(lexicon={"pinsina"}, derived={"pinsina": ("psina",)}, rules={IN1: 30, um_far: 15, um_near: 14})
        swaps = [d for d in D.distractors_for(kit, "pinsina", 6, rng=random.Random(1)) if d.kind == D.KIND_SWAP]
        assert [d.word for d in swaps] == ["pumsina"]


class _FakeSource:
    def __init__(self, items):
        self.items = items
        self.calls = []

    def for_word(self, surface, count=3):
        self.calls.append((surface, count))
        return self.items


def _setup_words(n=12):
    words = [WordDTO(id=f"w{i}", name=f"word{i}", frequency=1) for i in range(n)]
    repository._word_explanations_cache.clear()
    repository._word_audios_cache.clear()
    for w in words:
        repository._word_audios_cache[w.id] = [{"fileId": f"audio-{w.id}"}]
    target = words[0]
    repository._word_explanations_cache[target.id] = [{"chineseExplanation": "示範", "sentenceItems": [
        {"originalSentence": "Ini word0 kako.", "chineseSentence": "中文", "audioItems": [{"fileId": "sent-audio"}]}]}]
    return target, words


class TestSentenceFillPayload:
    def test_without_a_source_nothing_changes(self):
        target, words = _setup_words()
        payload = generator._get_sentence_fill_payload(target, words)
        assert "distractorNotes" not in payload
        assert payload["answer"] == "word0" and len(payload["options"]) == 4
        assert all(o["audio"] for o in payload["options"])

    def test_engine_distractors_replace_random_ones_and_drop_all_audio(self):
        target, words = _setup_words()
        items = [D.Distractor("fakeA", D.KIND_SWAP, "說明A"), D.Distractor("fakeB", D.KIND_SHIFT, "說明B")]
        payload = generator._get_sentence_fill_payload(target, words, _FakeSource(items))
        names = [o["word"] for o in payload["options"]]
        assert len(names) == 4 and len(set(names)) == 4 and names.count("word0") == 1
        assert {"fakeA", "fakeB"} <= set(names)
        assert payload["distractorNotes"] == {"fakeA": "說明A", "fakeB": "說明B"}
        assert all(o["audio"] is None for o in payload["options"])      # 防止靠喇叭圖示猜答案
        assert payload["answer"] == "word0"

    def test_three_engine_distractors_leave_no_random_ones(self):
        target, words = _setup_words()
        items = [D.Distractor(f"fake{i}", D.KIND_SWAP, "n") for i in range(3)]
        payload = generator._get_sentence_fill_payload(target, words, _FakeSource(items))
        assert sorted(o["word"] for o in payload["options"]) == ["fake0", "fake1", "fake2", "word0"]

    def test_empty_engine_result_falls_back_to_random_and_keeps_audio(self):
        target, words = _setup_words()
        payload = generator._get_sentence_fill_payload(target, words, _FakeSource([]))
        assert "distractorNotes" not in payload
        assert len(payload["options"]) == 4 and all(o["audio"] for o in payload["options"])

    def test_asks_the_source_for_the_answer_word_itself(self):
        target, words = _setup_words()
        src = _FakeSource([])
        generator._get_sentence_fill_payload(target, words, src)
        assert src.calls == [("word0", 3)]

    def test_random_fillers_never_duplicate_an_engine_word(self):
        target, words = _setup_words()
        items = [D.Distractor("word5", D.KIND_SWAP, "n")]       # 刻意跟別的詞撞名
        for _ in range(30):
            payload = generator._get_sentence_fill_payload(target, words, _FakeSource(items))
            names = [o["word"] for o in payload["options"]]
            assert len(names) == len(set(names))

    def test_generate_questions_passes_the_source_through(self):
        target, words = _setup_words()
        src = _FakeSource([D.Distractor("fakeA", D.KIND_SWAP, "說明A")])
        picker = generator._CandidatePicker([{"word": target}])
        qs = generator._generate_sentence_fill_questions(picker, words, 1, distractor_source=src)
        assert qs[0]["type"] == "sentence-fill" and qs[0]["payload"]["distractorNotes"] == {"fakeA": "說明A"}


class TestSourceFor:
    def test_flag_off_returns_none_without_touching_the_database(self):
        with patch.object(D.feature_flags, "is_enabled", return_value=False) as flag, \
             patch.object(D, "get_kit") as get_kit:
            assert D.source_for(object(), _TRIBE) is None
        flag.assert_called_once_with(D.FLAG, default=False)
        get_kit.assert_not_called()

    def test_flag_on_with_a_kit_returns_a_source(self):
        with patch.object(D.feature_flags, "is_enabled", return_value=True), patch.object(D, "get_kit", return_value=_kit()):
            assert isinstance(D.source_for(object(), _TRIBE), D.DistractorSource)

    def test_tribe_without_enough_data_returns_none(self):
        with patch.object(D.feature_flags, "is_enabled", return_value=True), patch.object(D, "get_kit", return_value=None):
            assert D.source_for(object(), _TRIBE) is None

    def test_a_failing_flag_lookup_is_treated_as_off_instead_of_breaking_the_quiz(self):
        with patch.object(D.feature_flags, "is_enabled", side_effect=RuntimeError("flag backend down")),              patch.object(D, "get_kit") as get_kit:
            assert D.source_for(object(), _TRIBE) is None
        get_kit.assert_not_called()

    def test_a_failing_kit_build_returns_none_instead_of_breaking_the_quiz(self):
        with patch.object(D.feature_flags, "is_enabled", return_value=True), \
             patch.object(D, "get_kit", side_effect=RuntimeError("db down")):
            assert D.source_for(object(), _TRIBE) is None

    def test_a_failing_generation_returns_no_distractors_instead_of_breaking_the_quiz(self):
        with patch.object(D, "distractors_for", side_effect=RuntimeError("boom")):
            assert D.DistractorSource(_kit()).for_word("mafilo") == []


# ---------------------------------------------------------------------------
# 用記憶體內 SQLite 跑一次從資料庫建立 TribeKit 的完整流程（只用 ORM 查詢）
# ---------------------------------------------------------------------------

def _roots(n=600, seed=5):
    rng = random.Random(seed)
    out = set()
    while len(out) < n:
        out.add("".join(rng.choice("ptkbdgmnlrsh") + rng.choice("aiueo") for _ in range(rng.choice((2, 3)))) + rng.choice("ptkbdgmnlrsh"))
    return sorted(out)


ROOTS = _roots()


@pytest.fixture(scope="module")
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine)()
    session.add(Tribe(id=_TRIBE.id, name=_TRIBE.full_name, slug=_TRIBE.slug))
    words = [Word(id=f"r{i}", name=r, tribe_id=_TRIBE.id) for i, r in enumerate(ROOTS)]
    # ma-：520 個（常見詞綴）；pa-：前 15 個也有（撞詞率約 3%，可用）；pi-：前 200 個也有（撞詞率約 38%，不可用）
    words += [Word(id=f"m{i}", name="ma" + r, tribe_id=_TRIBE.id, derivative_root=r) for i, r in enumerate(ROOTS[:520])]
    words += [Word(id=f"p{i}", name="pa" + r, tribe_id=_TRIBE.id, derivative_root=r) for i, r in enumerate(ROOTS[:15])]
    words += [Word(id=f"i{i}", name="pi" + r, tribe_id=_TRIBE.id, derivative_root=r) for i, r in enumerate(ROOTS[:200])]
    # 只出現一次的特例詞綴 xy-：不在常見詞綴規則裡
    words.append(Word(id="odd", name="xy" + ROOTS[300], tribe_id=_TRIBE.id, derivative_root=ROOTS[300]))
    session.add_all(words)
    for aff in ("ma-", "pa-", "pi-"):
        session.add(GrammarAffix(tribe_id=_TRIBE.id, affix=aff, affix_type="prefix", function="示範"))
    session.add(TranslationAttestedForm(tribe_id=_TRIBE.id, surface_form_norm="sa" + ROOTS[300], source_sentence_id=None))
    session.commit()
    yield session
    session.close()


class TestBuildKit:
    def test_builds_rules_only_for_common_affixes_in_the_curated_affix_table(self, db):
        kit = D._build_kit(db, _TRIBE.id, _TRIBE.full_name)
        assert set(kit.rules) == {MA, PA, PI}

    def test_attested_forms_are_part_of_what_counts_as_known(self, db):
        kit = D._build_kit(db, _TRIBE.id, _TRIBE.full_name)
        assert kit.is_known("sa" + ROOTS[300]) and kit.is_known("ma" + ROOTS[0]) and not kit.is_known("zz" + ROOTS[0])

    def test_pair_gate_uses_measured_collision_rates(self, db):
        kit = D._build_kit(db, _TRIBE.id, _TRIBE.full_name)
        assert kit.pair_allowed(MA, PA)                      # 15/520
        assert not kit.pair_allowed(MA, PI)                  # 200/520
        assert not kit.pair_allowed(PI, MA)                  # 反方向全部命中
        assert not kit.pair_allowed(PA, MA)                  # 樣本不足（只有 15 個）

    def test_end_to_end_distractor_for_a_word_without_collisions(self, db):
        kit = D._build_kit(db, _TRIBE.id, _TRIBE.full_name)
        got = D.distractors_for(kit, "ma" + ROOTS[400], 3, rng=random.Random(1))
        assert [d.word for d in got] == ["pa" + ROOTS[400]]  # pi- 組合被擋、pa- 組合沒撞詞

    def test_a_word_whose_only_alternative_already_exists_gets_nothing(self, db):
        kit = D._build_kit(db, _TRIBE.id, _TRIBE.full_name)
        assert D.distractors_for(kit, "ma" + ROOTS[5], 3) == []   # pa+root 已經在辭典裡、pi- 組合被擋

    def test_the_one_off_affix_word_is_not_used_as_a_target(self, db):
        kit = D._build_kit(db, _TRIBE.id, _TRIBE.full_name)
        assert D.distractors_for(kit, "xy" + ROOTS[300]) == []

    def test_tribe_with_too_few_annotated_pairs_has_no_kit(self, db):
        other = TRIBES[1]
        db.add(Tribe(id=other.id, name=other.full_name, slug=other.slug))
        db.add_all([Word(id=f"or{i}", name=r, tribe_id=other.id) for i, r in enumerate(ROOTS[:50])])   # 詞根都在辭典裡
        db.add_all([Word(id=f"o{i}", name="ma" + r, tribe_id=other.id, derivative_root=r) for i, r in enumerate(ROOTS[:50])])
        db.add(GrammarAffix(tribe_id=other.id, affix="ma-", affix_type="prefix", function="示範"))   # 詞綴表沒問題，只是配對太少
        db.commit()
        assert D._build_kit(db, other.id, other.full_name) is None

    def test_get_kit_caches_per_tribe_and_invalidate_clears_it(self, db):
        D.invalidate()
        assert D.get_kit(db, _TRIBE) is D.get_kit(db, _TRIBE)
        D.invalidate(_TRIBE.id)
        assert _TRIBE.id not in D._KITS
        D.invalidate()

    def test_invalidate_without_a_tribe_clears_every_tribe(self):
        D._KITS._values["a"] = "kit-a"
        D._KITS._values["b"] = "kit-b"
        D.invalidate()
        assert "a" not in D._KITS and "b" not in D._KITS
        D._KITS._values["a"] = "kit-a"
        D._KITS._values["b"] = "kit-b"
        D.invalidate("a")
        assert "a" not in D._KITS and "b" in D._KITS
        D.invalidate()


# ---------------------------------------------------------------------------
# 端點：出題流程有把干擾項來源傳給句子填空題，旗標關閉時行為跟以前一樣
# ---------------------------------------------------------------------------

class TestQuizEndpointWiring:
    @pytest.fixture
    def client(self):
        from fastapi.testclient import TestClient

        from dictionary_db.connect import get_db
        from fastAPI.main import app
        from fastAPI.routes import auth as auth_module

        def _fake_db():
            yield None

        async def _fake_auth():
            return {"uid": "test-user"}

        app.dependency_overrides[get_db] = _fake_db
        app.dependency_overrides[auth_module.verify_firebase_token] = _fake_auth
        try:
            with TestClient(app, raise_server_exceptions=False) as c:
                yield c
        finally:
            app.dependency_overrides.clear()

    def _post(self, client, tribe="amis"):
        words = [WordDTO(id=f"w{i}", name=f"word{i}", frequency=i + 1) for i in range(40)]
        with patch("fastAPI.routes.quiz.api.load_all_words", return_value=words):
            return client.post(f"/api/v1/quiz/generate_quiz_frontend?tribe={tribe}", json={})

    def test_the_source_for_the_requested_tribe_is_passed_to_sentence_fill(self, client):
        sentinel = object()
        with patch("fastAPI.routes.quiz.api.distractors.source_for", return_value=sentinel) as src, \
             patch("fastAPI.routes.quiz.api._generate_sentence_fill_questions", return_value=[]) as gen:
            resp = self._post(client, "amis")
        assert resp.status_code == 200
        assert src.call_args.args[1].slug == "amis"
        assert gen.call_args.kwargs["distractor_source"] is sentinel

    def test_with_the_flag_off_the_quiz_is_generated_exactly_as_before(self, client):
        with patch.object(D.feature_flags, "is_enabled", return_value=False), \
             patch.object(D, "get_kit") as get_kit:
            resp = self._post(client)
        assert resp.status_code == 200 and resp.json()["questions"]
        get_kit.assert_not_called()
        assert all("distractorNotes" not in q["payload"] for q in resp.json()["questions"])

    def test_a_crashing_distractor_build_still_returns_a_quiz(self, client):
        with patch.object(D.feature_flags, "is_enabled", return_value=True), \
             patch.object(D, "get_kit", side_effect=RuntimeError("db down")):
            resp = self._post(client)
        assert resp.status_code == 200 and resp.json()["questions"]
