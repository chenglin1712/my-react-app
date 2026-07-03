"""
泰雅語(賽考利克方言, dialect_id=6)中高級/高級 題庫與選題公式
====================================================

背景
----
`views.get_quiz_data` 的初級/中級試題是即時向官方練習介面
`https://api.lokahsu.org.tw/api/front_end/start_exam` 爬取。經實測（見開發紀錄），
該 demo API 對 level=3、level=4（甚至換遍 dialect_id=1~10）一律回傳
`part1~part4 = null`，也就是官方練習介面本身並未開放中高級／高級的題目資料，
因此中高級／高級無法比照初級／中級用「即時爬蟲」取得題目，必須改為
「本地題庫 + 選題公式」的方式出題。

題庫來源與可信度
----------------
詞彙、句型皆取材自原住民族語言學習補充教材（教育部十二年國教課綱指定教材）
賽考利克泰雅語 國中版, dialect_id=6，與本專案第一、二級題目使用的方言一致：
    來源: pqwasan.org.tw/junior (原住民族語言學習補充教材線上列印系統)
「配合題」詞庫直接取用教材中「壹、基本詞彙」各分類詞彙；
「閱讀填空」短文則是把教材「貳、生活會話」中已驗證過的例句，
用同一教材裡的詞彙做「替換式改寫」重組成 2~3 句的小短文（短文寫作技巧稱為
substitution drill，語言教學常見手法），確保句型合法、詞彙有據，
但短文本身是本專案為練習用途所編寫，並非官方認證考古題。

    ⚠️ 重要聲明：這裡的內容是「練習用」的示範題庫，量體刻意做小
    （方便未來擴充），部署為正式教材前，建議請泰雅語族語老師或
    通過族語認證的師資再次審定用字與語感。

命題邏輯對齊官方考試的地方
--------------------------
依「原住民族語言能力認證測驗題型」公開資料：
  - 初級／中級：只考聽力＋口說，題目多為「具象名詞」（看圖是非/選擇）。
  - 中高級／高級：新增「閱讀」與「寫作」測驗，代表詞彙範圍與句型複雜度
    要從「具象名詞」擴大到「動詞、時間詞、功能詞、抽象概念」，且題型
    從「看圖」轉為「純文字」。
本題庫就依此邏輯設計：
  - 中高級 (Level 3)：配合題，詞彙分類刻意涵蓋 名詞/動詞/時間詞/功能詞代詞/親屬人物
    五類，且動詞、時間詞、功能詞的抽樣比例明顯高於初中級（初中級只考名詞），
    對應官方「詞彙範圍擴大」的分級精神。
  - 高級 (Level 4)：閱讀克漏字，比照官方「高級閱讀＝克漏字選擇題＋題組選擇題」
    的作法──同一短文可以出多個空格（題組），每個空格 4 個選項，
    干擾選項固定「同詞性、語意相關」（詞彙語意型）或「同句法位置、時態/語氣不同」
    （語言結構型），呼應官方應考指南對高級閱讀干擾選項的設計原則。
"""

import random

# ---------------------------------------------------------------------------
# 中高級（Level 3）配合題：詞彙庫
# ---------------------------------------------------------------------------
# category 說明：
#   noun     具象名詞（動物/植物/物品）－ 初中級就有的詞彙類型，中高級延續但換一批詞
#   verb     動詞 － 中高級新增的詞彙面向
#   time     時間詞 － 中高級新增的詞彙面向
#   function 代詞／功能詞（疑問詞、應答詞等）－ 中高級新增、抽象度最高
#   kin      親屬稱謂／人物 － 比動植物具象詞彙略抽象，作為銜接
VOCAB_BANK = [
    # noun
    {"tayal": "huzil", "chinese": "狗", "category": "noun"},
    {"tayal": "bzyok", "chinese": "豬", "category": "noun"},
    {"tayal": "kacing", "chinese": "牛", "category": "noun"},
    {"tayal": "mit", "chinese": "羊", "category": "noun"},
    {"tayal": "yungay", "chinese": "猴子", "category": "noun"},
    {"tayal": "qulih", "chinese": "魚", "category": "noun"},
    {"tayal": "qbhniq", "chinese": "鳥", "category": "noun"},
    {"tayal": "phpah", "chinese": "花", "category": "noun"},
    {"tayal": "qhuniq", "chinese": "樹", "category": "noun"},
    {"tayal": "guquh", "chinese": "香蕉", "category": "noun"},
    {"tayal": "biru", "chinese": "書", "category": "noun"},
    {"tayal": "hanray", "chinese": "桌子", "category": "noun"},
    {"tayal": "thekan", "chinese": "椅子", "category": "noun"},
    {"tayal": "lukus", "chinese": "衣服", "category": "noun"},
    {"tayal": "ruku'", "chinese": "雨傘", "category": "noun"},
    # verb
    {"tayal": "uwah", "chinese": "來", "category": "verb"},
    {"tayal": "musa'", "chinese": "去", "category": "verb"},
    {"tayal": "maniq", "chinese": "吃", "category": "verb"},
    {"tayal": "mtuliq", "chinese": "起床", "category": "verb"},
    {"tayal": "mabi'", "chinese": "睡覺", "category": "verb"},
    {"tayal": "mita' biru", "chinese": "讀書", "category": "verb"},
    {"tayal": "mqwas", "chinese": "唱歌", "category": "verb"},
    {"tayal": "mzyugi'", "chinese": "跳舞", "category": "verb"},
    {"tayal": "matas biru", "chinese": "畫圖", "category": "verb"},
    {"tayal": "hmyapas", "chinese": "玩耍", "category": "verb"},
    {"tayal": "smoya'", "chinese": "喜歡", "category": "verb"},
    {"tayal": "baq", "chinese": "會、能", "category": "verb"},
    {"tayal": "mahuq", "chinese": "洗衣服", "category": "verb"},
    # time
    {"tayal": "kawas", "chinese": "年、歲", "category": "time"},
    {"tayal": "ryax", "chinese": "日子、天", "category": "time"},
    {"tayal": "soni'", "chinese": "今天", "category": "time"},
    {"tayal": "shera'", "chinese": "昨天", "category": "time"},
    {"tayal": "suxan", "chinese": "明天", "category": "time"},
    {"tayal": "sasan", "chinese": "早上", "category": "time"},
    {"tayal": "mhngan", "chinese": "晚上", "category": "time"},
    {"tayal": "kinryaxan", "chinese": "下午", "category": "time"},
    {"tayal": "misuw", "chinese": "現在", "category": "time"},
    # function / pronoun
    {"tayal": "kun", "chinese": "我", "category": "function"},
    {"tayal": "su'", "chinese": "你的", "category": "function"},
    {"tayal": "hiya'", "chinese": "他、她", "category": "function"},
    {"tayal": "ima'", "chinese": "誰", "category": "function"},
    {"tayal": "nanu'", "chinese": "什麼", "category": "function"},
    {"tayal": "inu'", "chinese": "哪裡", "category": "function"},
    {"tayal": "knwan", "chinese": "什麼時候", "category": "function"},
    {"tayal": "pira'", "chinese": "多少", "category": "function"},
    {"tayal": "aw", "chinese": "是的", "category": "function"},
    {"tayal": "iyat", "chinese": "不是", "category": "function"},
    # kin / people
    {"tayal": "yutas", "chinese": "祖父", "category": "kin"},
    {"tayal": "yaki'", "chinese": "祖母", "category": "kin"},
    {"tayal": "qbsuyan", "chinese": "哥哥、姊姊", "category": "kin"},
    {"tayal": "sswe", "chinese": "弟弟、妹妹", "category": "kin"},
    {"tayal": "mlikuy", "chinese": "男人", "category": "kin"},
    {"tayal": "kneril", "chinese": "女人", "category": "kin"},
    {"tayal": "rangi'", "chinese": "朋友", "category": "kin"},
    {"tayal": "sinsiy", "chinese": "老師", "category": "kin"},
    {"tayal": "bnkis", "chinese": "老人、長輩", "category": "kin"},
    {"tayal": "seto'", "chinese": "學生", "category": "kin"},
]

# 中高級配合題選題公式：每次測驗抽出 BOARD_COUNT 個配合題「題組」，
# 每題組 PAIRS_PER_BOARD 組配對；PAIRS_PER_BOARD * BOARD_COUNT 必須等於
# 底下 CATEGORY_QUOTA 的總和，才能均分到每個題組裡。
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
    """依 CATEGORY_QUOTA 對每個類別做不放回抽樣，回傳打散後的詞彙清單。"""
    picked = []
    for category, quota in CATEGORY_QUOTA.items():
        pool = [v for v in VOCAB_BANK if v["category"] == category]
        quota = min(quota, len(pool))
        picked.extend(random.sample(pool, quota))
    random.shuffle(picked)
    return picked


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
                    "word": {"word": item["tayal"], "audio": ""},
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
            "本部分共5題，每題會出現4組泰雅語詞彙與中文意思，"
            "請將左右兩側配對正確；配對全部正確即為答對，"
            "配對錯誤任何一組即為答錯。"
        ),
        "questions": questions,
    }


# ---------------------------------------------------------------------------
# 高級（Level 4）閱讀填空：短文克漏字題庫
# ---------------------------------------------------------------------------
# 每篇短文（passage）底下可以有多個空格（blank），同一短文的空格會被視為同一「題組」，
# 呼應官方「高級閱讀＝克漏字選擇題＋題組選擇題」的複合設計。
# distractor_type 只是註記干擾選項的設計邏輯，不影響前端顯示：
#   "semantic"  同詞性、語意相關的近義/易混淆詞（對應官方「詞彙語意」考點）
#   "grammar"   同句法位置、但時態/語氣/人稱不同（對應官方「語言結構」考點）
CLOZE_PASSAGES = [
    {
        "id": "p1",
        "passage_ab": "Lokah! Lalu maku ga, Yudaw. Mopuw kawas {blank1}. "
                      "Yaba maku ga, sinsiy; yaya maku ga, sinsiy phgup.",
        "passage_ch": "你好！我的名字是Yudaw。我十歲。我爸爸是老師；我媽媽是醫生。",
        "blanks": {
            "blank1": {
                "options": ["maku", "su'", "nya'", "mamu"],
                "answer": 1,
                "distractor_type": "grammar",
                "note": "自我介紹用第一人稱屬格「maku(我的)」，su'/nya'/mamu 分別是你的/他的/你們的。",
            },
        },
    },
    {
        "id": "p2",
        "passage_ab": "Cyux maki pqwasan biru qu yaba maku. {blank2} maki ngasal qu yaya maku. "
                      "Qbsuyan maku kneril ga, seto'.",
        "passage_ch": "我爸爸在學校。我媽媽在家。我姊姊是學生。",
        "blanks": {
            "blank2": {
                "options": ["Cyux", "Musa'", "Mnwah", "Smoya'"],
                "answer": 1,
                "distractor_type": "semantic",
                "note": "表示「在(某處)」要用存在句結構「cyux maki」，其餘三個是「去/來過/喜歡」等意義不合的動詞。",
            },
        },
    },
    {
        "id": "p3",
        "passage_ab": "Smoya' saku {blank3} biru. Mtuliq saku sasan, ru mabi' saku mhngan. "
                      "Baq saku {blank4} lukus uzi.",
        "passage_ch": "我喜歡讀書。我早上起床，晚上睡覺。我也會洗衣服。",
        "blanks": {
            "blank3": {
                "options": ["mita'", "maniq", "musa'", "mqwalax"],
                "answer": 1,
                "distractor_type": "semantic",
                "note": "「mita' biru」固定搭配為讀書，maniq(吃)/musa'(去)/mqwalax(下雨)語意不合。",
            },
            "blank4": {
                "options": ["mahuq", "mima'", "mtuliq", "mqwas"],
                "answer": 1,
                "distractor_type": "semantic",
                "note": "洗「衣服」要用 mahuq，mima'是洗澡/洗臉的洗，屬近義詞混淆設計。",
            },
        },
    },
    {
        "id": "p4",
        "passage_ab": "Suxan ga, mosa sami rgyax. {blank5} mita' yutas myan. Mqas balay sami!",
        "passage_ch": "明天，我們要去山上。要去探望我們的祖父。我們很高興！",
        "blanks": {
            "blank5": {
                "options": ["Musa'", "Mnwah", "Ini", "Laxi"],
                "answer": 1,
                "distractor_type": "grammar",
                "note": "此處為連動結構「去做某事」的未來/現在式，Mnwah(來過)是過去式、Ini(沒有)是過去否定、"
                        "Laxi(別)是祈使句用法，三者時態/語氣皆與句意不合。",
            },
        },
    },
]

# 高級選題公式：每次測驗抽 PASSAGE_COUNT 篇短文（隨題庫擴充，抽樣張數
# 也會是 min(PASSAGE_COUNT, 題庫篇數)，而不是「每次都全部出」）。
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

            # 選項順序也要打散，避免每次正解都固定在同一個位置
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
