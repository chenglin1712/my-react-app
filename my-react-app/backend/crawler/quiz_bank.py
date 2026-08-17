"""四個等級（初/中/中高/高）+ 情境題的出題邏輯——從 crawler/views.py 抽出來
（P4 review BE-16）：這裡只管「怎麼從已審定的題庫抽題、組成前端要的 part
資料」，不碰 HTTP request/response、限流、認證，全部是吃純值、回傳純 dict
的函式，方便未來要幫選題演算法加測試時不需要先組一個假的 HttpRequest。
"""
import random

from django.http import JsonResponse

from adminapi.quizbank_service import (
    get_published_choice_items, get_published_cloze_passages, get_published_situation_items,
    get_published_true_false_items, get_published_vocab_items, is_quiz_enabled,
)
from config.tribes import TRIBE_MAP

# 中高級（level 3）配合題選題公式的配額——原本分散寫死在五個 *_bank.py
# 各自的 CATEGORY_QUOTA，內容完全一致（見 P2 題庫管理調查結論），集中成
# 一份常數。BOARD_COUNT * PAIRS_PER_BOARD 必須等於配額總和，才能均分到
# 每個題組裡。
MATCHING_CATEGORY_QUOTA = {
    "noun": 8,       # 40%：延續初中級具象詞彙
    "verb": 5,       # 25%：中高級新增動詞
    "time": 3,       # 15%：中高級新增時間詞
    "function": 2,   # 10%：抽象代詞/功能詞
    "kin": 2,        # 10%：親屬與人物稱謂
}
MATCHING_BOARD_COUNT = 5
MATCHING_PAIRS_PER_BOARD = 4

# 高級（level 4）閱讀填空每次測驗抽幾篇短文——隨題庫擴充，抽樣篇數也會是
# min(CLOZE_PASSAGE_COUNT, 該族語目前已啟用的篇數)，不是每次都全部出。
CLOZE_PASSAGE_COUNT = 3


def _pick_matching_vocab_from_db(tribe):
    """依 MATCHING_CATEGORY_QUOTA 對每個類別做不放回抽樣，只從 status=published
    （已通過族語老師審定）的 QuizVocabItem 抽——草稿／待審核／已退件的內容
    不能被學生抽到，這是這次把題庫搬進資料庫、接上審定流程的核心目的。"""
    picked = []
    for category, quota in MATCHING_CATEGORY_QUOTA.items():
        pool = get_published_vocab_items(tribe, category)
        quota = min(quota, len(pool))
        picked.extend(random.sample(pool, quota))
    random.shuffle(picked)
    return picked


def build_matching_test_from_db(tribe):
    """組出中高級「配合題」的 part 資料，改讀資料庫（取代原本各族語
    *_bank.py 的 build_matching_test()），選題演算法完全比照原本邏輯不變。"""
    picked = _pick_matching_vocab_from_db(tribe)
    tribe_full_name = TRIBE_MAP.get(tribe, tribe)

    # 只組出「完整」的題組（每組固定 MATCHING_PAIRS_PER_BOARD 筆）——原本
    # 固定跑 MATCHING_BOARD_COUNT 次，題庫不足時最後一組會拿到不滿 4 筆
    # 甚至完全空的 chunk，產生學生看到但完全無法作答的空題（獨立審查找到
    # 的問題）。跟 build_cloze_test_from_db() 的 min(quota, len(pool)) 降級
    # 同一種精神：題庫不足時題數就是變少，不製造殘缺的題目。
    board_count = min(MATCHING_BOARD_COUNT, len(picked) // MATCHING_PAIRS_PER_BOARD)

    questions = []
    for i in range(board_count):
        chunk = picked[i * MATCHING_PAIRS_PER_BOARD: (i + 1) * MATCHING_PAIRS_PER_BOARD]
        questions.append({
            "pairs": [
                {
                    "cn": item.chinese_gloss, "word": {"word": item.foreign_word, "audio": item.audio_file_id},
                    # P5.3 題目品質分析用——配合題一「題」（一個題組）其實是
                    # MATCHING_PAIRS_PER_BOARD 個不同 QuizVocabItem 的組合，
                    # 沒有單一 pk 可以代表整題；item_id 放在每個 pair 上，
                    # 前端送出作答追蹤事件時逐 pair 各記一筆，用整個題組的
                    # 對錯（見下方 answer 說明）當作每個 pair 的近似結果——
                    # 不是完美的逐詞歸因，但同一個詞會在多次測驗、多個不同
                    # 題組組合裡重複出現，統計上仍能反映出「這個詞經常出現在
                    # 答錯的題組裡」，比完全沒有 id 可追蹤好。
                    "item_id": item.id,
                }
                for item in chunk
            ],
            # 配合題採「全對/有錯」二元計分，比照初級是非題的 1/2 編碼。
            "answer": 1,
        })

    return {
        "type": "matching",
        "title": "第一部分：配合題",
        "intro": (
            f"本部分共{board_count}題，每題會出現4組{tribe_full_name}詞彙與中文意思，"
            "請將左右兩側配對正確；配對全部正確即為答對，"
            "配對錯誤任何一組即為答錯。"
        ),
        "questions": questions,
    }


def build_cloze_test_from_db(tribe):
    """組出高級「閱讀填空」的 part 資料，改讀資料庫（取代原本各族語
    *_bank.py 的 build_cloze_test()），只從 status=published 的
    QuizClozePassage 抽，選題演算法完全比照原本邏輯不變。"""
    passages = get_published_cloze_passages(tribe)
    k = min(CLOZE_PASSAGE_COUNT, len(passages))
    picked_passages = random.sample(passages, k)

    questions = []
    for passage in picked_passages:
        for blank_key, blank in passage.blanks.items():
            options = blank["options"][:]
            answer_word = options[blank["answer"] - 1]

            # 選項順序也要打散，避免每次正解都固定在同一個位置
            shuffled = options[:]
            random.shuffle(shuffled)
            new_answer_index = shuffled.index(answer_word) + 1

            display_passage = passage.passage_foreign.replace(f"{{{blank_key}}}", "＿＿＿")
            for other_key, other_blank in passage.blanks.items():
                if other_key != blank_key:
                    other_correct = other_blank["options"][other_blank["answer"] - 1]
                    display_passage = display_passage.replace(f"{{{other_key}}}", other_correct)

            questions.append({
                "passage_ab": display_passage,
                "passage_ch": passage.passage_chinese,
                "options": shuffled,
                "answer": new_answer_index,
                # P5.3 題目品質分析用——克漏字一「題」是一個空格，不是一整篇
                # 短文，複合字串鍵（passage pk + blank 標記）才能唯一代表它，
                # 跟 P4.4 匯入精靈處理 {blankN} 標記時同一種複合鍵慣例。
                "item_id": f"{passage.id}:{blank_key}",
            })

    return {
        "type": "cloze",
        "title": "第一部分：閱讀填空",
        "intro": (
            "本部分為短文克漏字，請依文意選出最適合填入空格「＿＿＿」的詞彙，"
            "每題4個選項，僅有1個最適合。"
        ),
        "questions": questions,
    }


# 初級（是非題）/中級（三選一圖片選擇題）每次測驗抽幾題——對照對方官方
# 介面原本「本部份共5題」的既有題量，遷移後維持相同體驗。
LEVEL1_QUESTION_COUNT = 5
LEVEL2_QUESTION_COUNT = 5


def build_true_false_test_from_db(tribe):
    """組出初級「是非題」的 part 資料，改讀資料庫（取代原本 get_quiz_data
    對 level=1 即時代理外部 API 的做法），只從 status=published 的
    QuizTrueFalseItem 抽。"""
    pool = get_published_true_false_items(tribe)
    k = min(LEVEL1_QUESTION_COUNT, len(pool))
    picked = random.sample(pool, k)

    return {
        "type": "true_false",
        "title": "第一部分：是非題",
        "intro": (
            "本部份共5題，每題都有一個圖片，請聆聽播放的族語句子，"
            "若與該圖片所描述的內容符合，請選「O」；若不符合，請選「X」。"
        ),
        "questions": [
            {
                "question_ab": item.question_ab, "question_ch": item.question_ch,
                "audio": item.audio_url, "image": item.image_url, "answer": item.answer,
                "item_id": item.id,  # P5.3 題目品質分析用
            }
            for item in picked
        ],
    }


def build_choice_test_from_db(tribe):
    """組出中級「三選一圖片選擇題」的 part 資料，改讀資料庫（取代原本
    get_quiz_data 對 level=2 即時代理外部 API 的做法），只從
    status=published 的 QuizChoiceItem 抽。"""
    pool = get_published_choice_items(tribe)
    k = min(LEVEL2_QUESTION_COUNT, len(pool))
    picked = random.sample(pool, k)

    return {
        "type": "choice",
        "title": "第二部分：選擇題(一)",
        "intro": (
            "本部份共5題，每題有三個圖片，請依族語句子的語意，"
            "選一個與句子語意最相符的圖片。"
        ),
        "questions": [
            {
                "question_ab": item.question_ab, "question_ch": item.question_ch,
                "imageA": item.image_a_url, "imageB": item.image_b_url, "imageC": item.image_c_url,
                "answer": item.answer,
                "item_id": item.id,  # P5.3 題目品質分析用
            }
            for item in picked
        ],
    }


# 情境題每次抽幾題——跟 LEVEL1/LEVEL2_QUESTION_COUNT 同一種「對照官方介面
# 既有題量」精神抽個合理值，這是全新題型沒有既有介面可以對照，先跟初級/
# 中級一樣抽 5 題。
SITUATION_QUESTION_COUNT = 5


def build_situation_test_from_db(tribe):
    """組出「情境題」的 part 資料——P2 新增的 QuizSituationItem 到 P5.3 之前
    完全沒有學生端出題路徑（只有後台內容管理），這是第一次真的把它接上
    學生端。情境題不對應官方認證的 1-4 等級（見規劃文件 P5 §4(a)），故意
    不掛進 get_quiz_data 的 level_builders，用獨立的 get_situation_quiz_data
    端點供應，呼應「獨立練習入口、不掛在 level 1-4 系統裡」的既有決策。

    題庫全空時回傳空題目陣列而不是報錯——跟 build_matching_test_from_db／
    build_cloze_test_from_db 遇到題庫全空時的既有降級行為一致（見
    test_empty_vocab_pool_produces_zero_questions_not_error），前端
    ScenarioQuiz.jsx 已經有專屬的「目前沒有可練習的情境題」畫面接住這個
    情況。跟 _quiz_disabled_response() 的 403 是不同性質：那是管理者
    主動關閉，這裡是題庫本身還沒有內容，兩者不該用同一種「拒絕靜默」
    邏輯處理。"""
    pool = get_published_situation_items(tribe)
    k = min(SITUATION_QUESTION_COUNT, len(pool))
    picked = random.sample(pool, k)

    return {
        "type": "situation",
        "title": "情境對話練習",
        "intro": "本部份會描述一個生活情境，請從 4 個族語對話選項中選出最適合回應的一個。",
        "questions": [
            {
                "scenario_ch": item.scenario_chinese,
                "options": item.options,
                "answer": item.answer,
                "item_id": item.id,
            }
            for item in picked
        ],
    }


def _quiz_disabled_response(tribe):
    """族語測驗總開關（見 adminapi.models.FeatureFlag）——族語老師審定
    未完成前，管理者可以先關閉該族語的測驗，get_quiz_data／
    get_situation_quiz_data 共用同一份檢查。回 403 附清楚訊息，不是靜默
    回傳空題目陣列：空陣列會讓學生以為「題庫剛好是空的」，403 才能讓
    前端明確顯示「這個族語的測驗目前暫停開放」而不是誤導成系統故障。
    找不到對應 FeatureFlag 紀錄時視為未關閉（維持現況行為，見
    seed_feature_flags 管理指令的說明）。"""
    if not is_quiz_enabled(tribe):
        return JsonResponse({"detail": "這個族語的測驗目前暫停開放，請稍後再試。"}, status=403)
    return None
