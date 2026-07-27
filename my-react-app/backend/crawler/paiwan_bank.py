"""
排灣語(dictionary.db 未細分次方言, 官方線上練習介面初中級採 dialect_id=25
中排灣語) 中高級/高級 題庫與選題公式
====================================================

背景
----
比照 `tayal_bank.py`／`amis_bank.py`／`bunun_bank.py`／`kavalan_bank.py`
的作法：官方練習介面 `start_exam` 對 level=3、level=4 在排灣語
（dialect_id=23/24/25/26，實測涵蓋東/北/中/南排灣四個次方言）一律回傳
`part1~part4 = null`，代表官方 demo API 本來就沒開放任何族語的中高級／
高級題目資料，因此中高級／高級改走「本地題庫 + 選題公式」，跟其他族語一致。

題庫來源與可信度
----------------
配合題詞彙**不寫死在程式碼裡**，出題當下即時查詢本專案既有的
`backend/dictionary_db/dictionary.db`（辭典搜尋、詞彙遊戲等既有功能實際
在用的同一份資料，來源標記「線上辭典」，即財團法人原住民族語言研究發展
基金會 ILRDF 建置、原住民族委員會委託的「原住民族語言線上辭典」）。
dictionary.db 裡的排灣語詞條沒有標記次方言別（`dialect` 欄位皆為空），
因此本地題庫內容無法保證跟官方 API 選用的「中排灣語」完全一致，是
沿用本專案既有辭典資料的既有限制，非本次新增。

程式碼裡只留下 CATEGORY_TARGETS（這一類要考哪些中文詞義的課程設計清單），
實際排灣語拼寫一律由 `dictionary_source.fetch_words_by_glosses()` 在出題
當下查詢，資料庫內容之後如被訂正、擴充，題庫會自動反映最新資料。

    ⚠️ 重要聲明：閱讀克漏字的短文本身仍是人工從 dictionary.db 的真實例句裡
    挑選、核對過設計而成（見下方 CLOZE_PASSAGES 說明），需要挑選語意通順、
    能設計出干擾選項的例句組合，沒辦法單純查詢自動產生；部署為正式教材前，
    建議請排灣語族語老師或通過族語認證的師資再次審定。

命題邏輯對齊官方考試的地方
--------------------------
邏輯與 `tayal_bank.py` 完全一致（詳見該檔案開頭說明），此處不重複贅述：
中高級用「詞彙分類配額抽樣」出配合題，高級用「短文克漏字＋雙軌干擾選項設計」
（詞彙語意型 / 語言結構型）出閱讀題。
"""

import random

from . import dictionary_source

# ---------------------------------------------------------------------------
# 中高級（Level 3）配合題：選題公式
# ---------------------------------------------------------------------------
# 字串必須是 dictionary.db 裡 chineseExplanation 的精確值（含資料庫原有的
# 標點/括註），fetch_words_by_glosses() 才能查到對應詞條。
CATEGORY_TARGETS = {
    # noun（具象名詞，延續初中級的動植物、物品類）
    "noun": ["狗", "豬", "牛", "羊", "猴子", "魚", "鳥", "花", "樹", "香蕉",
             "書", "桌子", "椅子", "衣服", "雨傘"],
    # verb（中高級新增的詞彙面向；辭典查無「起床」「洗衣服」「會（懂）」的
    # 乾淨詞條，改用「洗澡」「能夠（可以）」補上，且不影響原本 quota=5 的抽樣）
    "verb": ["來", "去", "吃", "睡覺", "讀書", "唱歌", "跳舞", "畫圖", "喜歡",
             "洗澡", "能夠（可以）"],
    # time（中高級新增的詞彙面向；辭典查無泛稱的「天」「現在」，
    # 改用「一天」補上，「現在」在辭典裡跟「今天」共用同一個詞故不重複收錄）
    "time": ["年", "一天", "日子", "今天", "昨天", "明天", "早上", "晚上", "下午"],
    # function / pronoun（代詞／功能詞，抽象度最高）
    "function": ["我", "你（的）", "你", "他", "誰", "什麼", "哪裡", "多少", "是的", "不是"],
    # kin / people（親屬稱謂／人物；排灣語「祖父」「祖母」共用同一個詞
    # vuvu（祖父母輩），「老人」「長輩」則改用辭典原有的「耆老」）
    "kin": ["祖父母輩", "姊姊", "弟弟", "妹妹", "男性", "女生；女人；婦女",
            "朋友", "老師", "耆老", "學生"],
}

# 中高級配合題選題公式：跟 tayal_bank.py 完全同一套公式（配額抽樣 + 平均分題組）。
BOARD_COUNT = 5
PAIRS_PER_BOARD = 4
CATEGORY_QUOTA = {
    "noun": 8,       # 40%：延續初中級具象詞彙
    "verb": 5,       # 25%：中高級新增動詞
    "time": 3,       # 15%：中高級新增時間詞
    "function": 2,   # 10%：抽象代詞/功能詞
    "kin": 2,        # 10%：親屬與人物稱謂
}


def _pick_matching_vocab():
    """即時查詢 dictionary.db，依 CATEGORY_QUOTA 對每個類別做不放回抽樣。"""
    return dictionary_source.sample_matching_vocab("paiwan", CATEGORY_TARGETS, CATEGORY_QUOTA)


def build_matching_test():
    """組出中高級「配合題」的 part 資料（選題公式進入點）。"""
    picked = _pick_matching_vocab()

    questions = []
    for i in range(BOARD_COUNT):
        chunk = picked[i * PAIRS_PER_BOARD: (i + 1) * PAIRS_PER_BOARD]
        questions.append({
            "pairs": [
                {
                    "cn": item["chinese"],
                    "word": {"word": item["word"], "audio": ""},
                }
                for item in chunk
            ],
            # 配合題採「全對/有錯」二元計分，比照初級是非題的 1/2 編碼，
            # 沿用既有 evaluateAnswers() 的純量比對邏輯，不需另外改資料庫schema。
            "answer": 1,
        })

    return {
        "type": "matching",
        "title": "第一部分：配合題",
        "intro": (
            "本部分共5題，每題會出現4組排灣語詞彙與中文意思，"
            "請將左右兩側配對正確；配對全部正確即為答對，"
            "配對錯誤任何一組即為答錯。"
        ),
        "questions": questions,
    }


# ---------------------------------------------------------------------------
# 高級（Level 4）閱讀填空：短文克漏字題庫
# ---------------------------------------------------------------------------
# 每篇短文都是「逐字取自 dictionary.db 裡的真實 sentenceItems 例句」，只挑
# 其中一個詞挖空，其餘文字完全不改動；較長的短文則是把主題相關的真實例句
# 原句拼接而成，沒有另外自創任何排灣語句子或文法。
CLOZE_PASSAGES = [
    {
        "id": "p1",
        # 兩句都逐字取自真實例句："situ uta azua a timadju?"(他也是學生嗎？)
        # 與 "ini, sinsi azua a timadju"(不是，他是老師。)
        "passage_ab": "{blank1} uta azua a timadju? ini, sinsi azua a timadju.",
        "passage_ch": "他也是學生嗎？不是，他是老師。",
        "blanks": {
            "blank1": {
                "options": ["situ", "qali", "ramaljeng", "uʼaljay"],
                "answer": 1,
                "distractor_type": "semantic",
                "note": "詢問身分要用「situ(學生)」，"
                        "qali(朋友)/ramaljeng(耆老)/uʼaljay(男性)詞性相同但語意不合。",
            },
        },
    },
    {
        "id": "p2",
        # 兩句都逐字取自真實例句："uwi, situ aken"(是的，我是學生。) 與
        # "situ aken i tua kusiau tucu"(我現在是國小的學生。)
        "passage_ab": "uwi, situ {blank2}. situ aken i tua kusiau tucu.",
        "passage_ch": "是的，我是學生。我現在是國小的學生。",
        "blanks": {
            "blank2": {
                "options": ["aken", "su", "ni", "madju"],
                "answer": 1,
                "distractor_type": "grammar",
                "note": "自我介紹要用第一人稱「aken(我)」，"
                        "su(你的)/ni(你)/madju(他)人稱不合。",
            },
        },
    },
    {
        "id": "p3",
        # 兩句都逐字取自真實例句："nu taʼed sun nu salilim i tua kemudamuda
        # a kukuan?"(你晚上什麼時間睡覺？) 與 "nu taʼed aken nu salilim i tua
        # siva katu papamaw a kukuan"(我晚上九點半睡覺。)
        "passage_ab": "nu taʼed sun nu {blank3} i tua kemudamuda a kukuan? "
                      "nu taʼed aken nu {blank4} i tua siva katu papamaw a kukuan.",
        "passage_ch": "你晚上什麼時間睡覺？我晚上九點半睡覺。",
        "blanks": {
            "blank3": {
                "options": ["salilim", "kadjaman", "nutiav", "katiav"],
                "answer": 1,
                "distractor_type": "semantic",
                "note": "詢問睡覺時間要用「salilim(晚上)」，"
                        "kadjaman(早上)/nutiav(明天)/katiav(昨天)都是時間詞但語意不合。",
            },
            "blank4": {
                "options": ["salilim", "kadjaman", "nutiav", "katiav"],
                "answer": 1,
                "distractor_type": "semantic",
                "note": "回答需與前一句問的時段一致(晚上)，其餘三個是同類型但語意不合的時間詞。",
            },
        },
    },
    {
        "id": "p4",
        # 逐字取自真實例句："uri vaik anga aken nutiav"(明天我要走了。)
        "passage_ab": "uri vaik anga aken {blank5}.",
        "passage_ch": "明天我要走了。",
        "blanks": {
            "blank5": {
                "options": ["nutiav", "katiav", "tucu", "kadjaman"],
                "answer": 1,
                "distractor_type": "semantic",
                "note": "談論即將要做的事要用「nutiav(明天)」，"
                        "katiav(昨天)/tucu(今天)/kadjaman(早上)都是時間詞但語意不合。",
            },
        },
    },
]

# 高級選題公式：跟 tayal_bank.py 完全同一套公式（每次抽 PASSAGE_COUNT 篇，
# 隨題庫擴充抽樣張數也會是 min(PASSAGE_COUNT, 題庫篇數)）。
PASSAGE_COUNT = 3


def build_cloze_test():
    """組出高級「閱讀填空」的 part 資料（選題公式進入點）。"""
    k = min(PASSAGE_COUNT, len(CLOZE_PASSAGES))
    picked_passages = random.sample(CLOZE_PASSAGES, k)

    questions = []
    for passage in picked_passages:
        for blank_key, blank in passage["blanks"].items():
            options = blank["options"][:]
            answer_word = options[blank["answer"] - 1]

            shuffled = options[:]
            random.shuffle(shuffled)
            new_answer_index = shuffled.index(answer_word) + 1

            display_passage = passage["passage_ab"].replace(f"{{{blank_key}}}", "＿＿＿")
            for other_key, other_blank in passage["blanks"].items():
                if other_key != blank_key:
                    other_correct = other_blank["options"][other_blank["answer"] - 1]
                    display_passage = display_passage.replace(f"{{{other_key}}}", other_correct)

            questions.append({
                "passage_ab": display_passage,
                "passage_ch": passage["passage_ch"],
                "options": shuffled,
                "answer": new_answer_index,
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
