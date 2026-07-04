"""
噶瑪蘭語(dictionary.db 標記為「葛瑪蘭語」，官方線上練習介面唯一腔別
dialect_id=34) 中高級/高級 題庫與選題公式
====================================================

背景
----
比照 `tayal_bank.py`／`amis_bank.py`／`bunun_bank.py` 的作法：官方練習介面
`start_exam` 對 level=3、level=4 在噶瑪蘭語（dialect_id=34）一律回傳
`part1~part4 = null`，代表官方 demo API 本來就沒開放任何族語的中高級／
高級題目資料，因此中高級／高級改走「本地題庫 + 選題公式」，跟其他族語一致。

題庫來源與可信度
----------------
配合題詞彙**不寫死在程式碼裡**，出題當下即時查詢本專案既有的
`backend/fastAPI/routes/dictionary.db`（辭典搜尋、詞彙遊戲等既有功能實際
在用的同一份資料，來源標記「線上辭典」，即財團法人原住民族語言研究發展
基金會 ILRDF 建置、原住民族委員會委託的「原住民族語言線上辭典」）。
資料庫裡的族語欄位標記為「葛瑪蘭語」，跟官方練習介面用的「噶瑪蘭語」
是同一個語言的不同慣用譯名，內容取自同一個 tribe_id。

程式碼裡只留下 CATEGORY_TARGETS（這一類要考哪些中文詞義的課程設計清單），
實際噶瑪蘭語拼寫一律由 `dictionary_source.fetch_words_by_glosses()` 在出題
當下查詢，資料庫內容之後如被訂正、擴充，題庫會自動反映最新資料。

    ⚠️ 重要聲明：閱讀克漏字的短文本身仍是人工從 dictionary.db 的真實例句裡
    挑選、核對過設計而成（見下方 CLOZE_PASSAGES 說明），需要挑選語意通順、
    能設計出干擾選項的例句組合，沒辦法單純查詢自動產生；部署為正式教材前，
    建議請噶瑪蘭語族語老師或通過族語認證的師資再次審定。

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
    # verb（中高級新增的詞彙面向）
    "verb": ["來", "去", "吃", "起床", "睡覺", "讀書", "唱歌", "跳舞", "畫圖",
             "玩", "喜歡", "會", "洗（如洗衣服）"],
    # time（中高級新增的詞彙面向；今天／現在在辭典裡是同一個詞，
    # 改用「中午」補上第9個時間詞，避免配合題出現重複卡片）
    "time": ["年", "天", "今天", "昨天", "明天", "早上", "晚上", "下午", "中午"],
    # function / pronoun（代詞／功能詞，抽象度最高）
    "function": ["我", "你的", "你", "他", "誰", "什麼", "哪裡", "多少", "是", "不是"],
    # kin / people（親屬稱謂／人物；辭典裡「哥哥/姊姊」「弟弟/妹妹」分別共用
    # 同一個詞，各只取一個中文詞義；「男人」查無泛稱詞條，改用「丈夫」，
    # 「女人」則採辭典原文「女性；女的；女人」）
    "kin": ["祖父", "祖母", "哥哥", "弟弟", "丈夫", "女性；女的；女人",
            "朋友", "老師", "老人", "學生"],
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
    return dictionary_source.sample_matching_vocab("kavalan", CATEGORY_TARGETS, CATEGORY_QUOTA)


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
            "本部分共5題，每題會出現4組噶瑪蘭語詞彙與中文意思，"
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
# 原句拼接而成，沒有另外自創任何噶瑪蘭語句子或文法。
CLOZE_PASSAGES = [
    {
        "id": "p1",
        # 逐字取自真實例句："nengi isu, ti utay aiku, yau ti abas ta
        # leppawan ni?"(你好，我是Utay，Abas在家嗎？)
        "passage_ab": "nengi isu, ti utay {blank1}, yau ti abas ta leppawan ni?",
        "passage_ch": "你好，我是Utay，Abas在家嗎？",
        "blanks": {
            "blank1": {
                "options": ["aiku", "isu", "su", "aizipna"],
                "answer": 1,
                "distractor_type": "grammar",
                "note": "自我介紹要用第一人稱「aiku(我)」，"
                        "isu(你)/su(你的)/aizipna(他、她)人稱不合。",
            },
        },
    },
    {
        "id": "p2",
        # 兩句都逐字取自真實例句："nengi aisu ni?"(你好嗎？) 與
        # "pataqsian aisu ni?"(你是學生嗎？)
        "passage_ab": "nengi aisu ni? {blank2} aisu ni?",
        "passage_ch": "你好嗎？你是學生嗎？",
        "blanks": {
            "blank2": {
                "options": ["pataqsian", "patudan", "Runanay", "tazungan"],
                "answer": 1,
                "distractor_type": "semantic",
                "note": "詢問身分要用「pataqsian(學生)」，"
                        "patudan(老師)/Runanay(男生)/tazungan(女生)詞性相同但語意不合。",
            },
        },
    },
    {
        "id": "p3",
        # 兩句都逐字取自真實例句："taRbabi utani duki masuwat isu?"
        # (你早上幾點起床？) 與 "qaRabi utani duki maynep isu?"(你晚上幾點睡覺？)
        "passage_ab": "taRbabi utani duki {blank3} isu? qaRabi utani duki {blank4} isu?",
        "passage_ch": "你早上幾點起床？你晚上幾點睡覺？",
        "blanks": {
            "blank3": {
                "options": ["masuwat", "maynep", "temaqsi", "nisatezay"],
                "answer": 1,
                "distractor_type": "semantic",
                "note": "早上該做的動作是「masuwat(起床)」，"
                        "maynep(睡覺)/temaqsi(讀書)/nisatezay(唱歌)詞性相同但語意不合。",
            },
            "blank4": {
                "options": ["maynep", "masuwat", "temaqsi", "nisatezay"],
                "answer": 1,
                "distractor_type": "semantic",
                "note": "晚上該做的動作是「maynep(睡覺)」，其餘三個是同類型但語意不合的動作動詞。",
            },
        },
    },
    {
        "id": "p4",
        # 逐字取自真實例句："temawaR si, qenabinnusan ni bai."(明天是阿嬤的生日。)
        "passage_ab": "{blank5} si, qenabinnusan ni bai.",
        "passage_ch": "明天是阿嬤的生日。",
        "blanks": {
            "blank5": {
                "options": ["temawaR", "siRab", "setangi", "taRbabi"],
                "answer": 1,
                "distractor_type": "semantic",
                "note": "談論生日要用「temawaR(明天)」，"
                        "siRab(昨天)/setangi(今天)/taRbabi(早上)都是時間詞但語意不合。",
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
