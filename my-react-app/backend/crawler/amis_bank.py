"""
阿美語(秀姑巒阿美語, dialect_id=2) 中高級/高級 題庫與選題公式
====================================================

背景
----
比照 `tayal_bank.py` 的作法：官方練習介面 `start_exam` 對 level=3、level=4
在阿美語五個腔別（dialect_id=1~5：南勢/秀姑巒/海岸/馬蘭/恆春）一律回傳
`part1~part4 = null`，跟泰雅語的情況完全一樣，代表官方 demo API 本來就沒開放
任何語言的中高級／高級題目資料，因此中高級／高級改走「本地題庫 + 選題公式」。

題庫來源與可信度
----------------
詞彙、例句均直接取自本專案既有的 `backend/fastAPI/routes/dictionary.db`——
這顆 SQLite 資料庫就是「辭典搜尋」「詞彙遊戲」等既有功能實際在用的同一份資料，
內容來源標記為「線上辭典」，經核對即財團法人原住民族語言研究發展基金會（ILRDF）
建置、原住民族委員會委託的「原住民族語言線上辭典」(e-dictionary.ilrdf.org.tw)，
方言別統一為「秀姑巒阿美語」(tribe_id = e68273b9-1f2b-4c42-8d95-f52189ab24b7)。

    註：泰雅語題庫當初引用的 pqwasan.org.tw 課綱教材網站，實測已經停站
    （網站顯示「主機到期，服務暫停」），因此阿美語改以本專案內部已有、
    仍可實際查得到的 dictionary.db 作為題庫來源，而非重新尋找外部網站。

    ⚠️ 重要聲明：這裡的內容是「練習用」的示範題庫，詞彙與短文都經過人工
    從 dictionary.db 篩選、核對過真實例句，但畢竟不是官方認證考古題，
    部署為正式教材前，建議請阿美語族語老師或通過族語認證的師資再次審定。

命題邏輯對齊官方考試的地方
--------------------------
邏輯與 `tayal_bank.py` 完全一致（詳見該檔案開頭說明），此處不重複贅述：
中高級用「詞彙分類配額抽樣」出配合題，高級用「短文克漏字＋雙軌干擾選項設計」
（詞彙語意型 / 語言結構型）出閱讀題。
"""

import random

# ---------------------------------------------------------------------------
# 中高級（Level 3）配合題：詞彙庫
# ---------------------------------------------------------------------------
# 每個詞都是直接從 dictionary.db 查詢 tribe_id=e68273b9-...(阿美語/秀姑巒方言)
# 撈出的真實辭典詞條（name + chineseExplanation），category 為本題庫依詞義
# 人工歸類（dictionary.db 本身的 category 標記只覆蓋約15%詞條且不完全一致，
# 這裡改用跟 tayal_bank.py 一樣的五分類，方便共用同一套選題公式）。
VOCAB_BANK = [
    # noun（具象名詞，延續初中級的動植物、物品類）
    {"amis": "waco", "chinese": "狗", "category": "noun"},
    {"amis": "fafoy", "chinese": "豬", "category": "noun"},
    {"amis": "kolong", "chinese": "牛", "category": "noun"},
    {"amis": "siri", "chinese": "羊", "category": "noun"},
    {"amis": "lotong", "chinese": "猴子", "category": "noun"},
    {"amis": "foting", "chinese": "魚", "category": "noun"},
    {"amis": "ʼayam", "chinese": "鳥", "category": "noun"},
    {"amis": "hana", "chinese": "花", "category": "noun"},
    {"amis": "kilang", "chinese": "樹", "category": "noun"},
    {"amis": "pawli", "chinese": "香蕉", "category": "noun"},
    {"amis": "codad", "chinese": "書", "category": "noun"},
    {"amis": "parad", "chinese": "桌子", "category": "noun"},
    {"amis": "ʼanengan", "chinese": "椅子", "category": "noun"},
    {"amis": "fodoy", "chinese": "衣服", "category": "noun"},
    {"amis": "cacilakan", "chinese": "雨傘", "category": "noun"},
    # verb（中高級新增的詞彙面向）
    {"amis": "tayni", "chinese": "來", "category": "verb"},
    {"amis": "tayra", "chinese": "去", "category": "verb"},
    {"amis": "kaen", "chinese": "吃", "category": "verb"},
    {"amis": "lomowad", "chinese": "起床", "category": "verb"},
    {"amis": "mafotiʼ", "chinese": "睡覺", "category": "verb"},
    {"amis": "micodad", "chinese": "讀書", "category": "verb"},
    {"amis": "romadiw", "chinese": "唱歌", "category": "verb"},
    {"amis": "makero", "chinese": "跳舞", "category": "verb"},
    {"amis": "mirenaf", "chinese": "畫圖", "category": "verb"},
    {"amis": "misalama^", "chinese": "玩耍", "category": "verb"},
    {"amis": "maolah", "chinese": "喜歡", "category": "verb"},
    {"amis": "fanaʼ", "chinese": "會、懂、能", "category": "verb"},
    {"amis": "mifacaʼ", "chinese": "洗衣服", "category": "verb"},
    # time（中高級新增的詞彙面向）
    {"amis": "mihecaan", "chinese": "年", "category": "time"},
    {"amis": "romiʼad", "chinese": "日子、天", "category": "time"},
    {"amis": "anini", "chinese": "今天", "category": "time"},
    {"amis": "inacila^", "chinese": "昨天", "category": "time"},
    {"amis": "anocila", "chinese": "明天", "category": "time"},
    {"amis": "dafak", "chinese": "早上", "category": "time"},
    {"amis": "dadaya^", "chinese": "晚上", "category": "time"},
    {"amis": "herek no lahok", "chinese": "下午", "category": "time"},
    {"amis": "imatini", "chinese": "現在", "category": "time"},
    # function / pronoun（代詞／功能詞，抽象度最高）
    {"amis": "kako", "chinese": "我", "category": "function"},
    {"amis": "miso", "chinese": "你的", "category": "function"},
    {"amis": "kiso", "chinese": "你", "category": "function"},
    {"amis": "cira", "chinese": "他、她", "category": "function"},
    {"amis": "cima^", "chinese": "誰", "category": "function"},
    {"amis": "maan", "chinese": "什麼", "category": "function"},
    {"amis": "icowa", "chinese": "哪裡", "category": "function"},
    {"amis": "hacowa", "chinese": "多少", "category": "function"},
    {"amis": "hay", "chinese": "是的", "category": "function"},
    {"amis": "Caay", "chinese": "不、不是", "category": "function"},
    # kin / people（親屬稱謂／人物）
    {"amis": "akong", "chinese": "祖父、外公、爺爺、阿公", "category": "kin"},
    {"amis": "ama:", "chinese": "祖母", "category": "kin"},
    {"amis": "kaka^", "chinese": "哥哥、姊姊", "category": "kin"},
    {"amis": "safa^", "chinese": "弟弟、妹妹", "category": "kin"},
    {"amis": "faʼinayan", "chinese": "男人", "category": "kin"},
    {"amis": "fafahyian", "chinese": "女人", "category": "kin"},
    {"amis": "idang", "chinese": "朋友", "category": "kin"},
    {"amis": "singsi^", "chinese": "老師", "category": "kin"},
    {"amis": "matoʼasay", "chinese": "老人、長輩", "category": "kin"},
    {"amis": "micodaday", "chinese": "學生", "category": "kin"},
]

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
                    "word": {"word": item["amis"], "audio": ""},
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
            "本部分共5題，每題會出現4組阿美語詞彙與中文意思，"
            "請將左右兩側配對正確；配對全部正確即為答對，"
            "配對錯誤任何一組即為答錯。"
        ),
        "questions": questions,
    }


# ---------------------------------------------------------------------------
# 高級（Level 4）閱讀填空：短文克漏字題庫
# ---------------------------------------------------------------------------
# 跟泰雅語題庫不同的是，這裡每篇短文都是「逐字取自 dictionary.db 裡的真實
# sentenceItems 例句」，只挑其中一個詞挖空，其餘文字完全不改動；較長的短文
# 則是把2~3則主題相關的真實例句原句拼接而成（例如「打招呼」跟「回應」兩句
# 拼在一起），沒有另外自創任何阿美語句子或文法，盡量把「編造語感」的風險降到最低。
CLOZE_PASSAGES = [
    {
        "id": "p1",
        # 逐字取自真實例句："Cima^ ko ngangan no miso?"(你叫什麼名字？) +
        # "Ci Mayaw ko ngangan niira hay?"(他的名字是Mayaw嗎？)
        "passage_ab": "Cima^ ko ngangan no {blank1}? Ci Mayaw ko ngangan niira hay?",
        "passage_ch": "你叫什麼名字？他的名字是Mayaw嗎？",
        "blanks": {
            "blank1": {
                "options": ["miso", "mako", "nira", "namo"],
                "answer": 1,
                "distractor_type": "grammar",
                "note": "問對方名字要用第二人稱所有格「miso(你的)」，"
                        "mako(我的)/nira(它的)/namo(你們的)人稱不合。",
            },
        },
    },
    {
        "id": "p2",
        # 逐字取自真實例句："Ngaʼay ho^, ci Ongo^ kako, i lomaʼ ci Fadah hay?"
        # (你好，我是Ongo^，Fadah在家嗎？)，只挖空地方格助詞 "i"。
        "passage_ab": "Ngaʼay ho^, ci Ongo^ kako, {blank2} lomaʼ ci Fadah hay?",
        "passage_ch": "你好，我是Ongo^，Fadah在家嗎？",
        "blanks": {
            "blank2": {
                "options": ["i", "tayra", "tayni", "maolah"],
                "answer": 1,
                "distractor_type": "semantic",
                "note": "詢問人是否「在(某處)」要用地方格助詞「i」，"
                        "tayra(去)/tayni(來)/maolah(喜歡)是動詞，語意與句法位置皆不合。",
            },
        },
    },
    {
        "id": "p3",
        # 兩句都逐字取自真實例句："Mafanaʼ kiso a romadiw haw?"(你會唱歌嗎？)
        # 與 "Hay, mafanaʼ kako a romadiw."(是的，我會唱歌。)
        "passage_ab": "Mafanaʼ kiso a {blank3} haw? Hay, mafanaʼ kako a {blank4}.",
        "passage_ch": "你會唱歌嗎？是的，我會唱歌。",
        "blanks": {
            "blank3": {
                "options": ["romadiw", "masakero^", "mirenaf", "micodad"],
                "answer": 1,
                "distractor_type": "semantic",
                "note": "同為「Mafanaʼ ... a ___」(會...)句型下的動作動詞，"
                        "masakero^(跳舞)/mirenaf(畫圖)/micodad(讀書)詞性相同但語意不合。",
            },
            "blank4": {
                "options": ["romadiw", "masakero^", "mirenaf", "micodad"],
                "answer": 1,
                "distractor_type": "semantic",
                "note": "回答需與前一句問的動作一致(唱歌)，其餘三個是同類型但語意不合的動作動詞。",
            },
        },
    },
    {
        "id": "p4",
        # 三個片段皆逐字取自真實例句："Ngaʼay ho^ kiso, singsi^?"(你好嗎，老師？)、
        # "Hay, ngaʼay ho^. Kiso i?"(是的，我很好。你呢？)、"Arayom!"(再見！)
        "passage_ab": "Ngaʼay ho^ kiso, singsi^? Hay, ngaʼay ho^. {blank5} i? Arayom!",
        "passage_ch": "你好嗎，老師？是的，我很好。你呢？再見！",
        "blanks": {
            "blank5": {
                "options": ["Kiso", "Kako", "Cira", "Kamo"],
                "answer": 1,
                "distractor_type": "grammar",
                "note": "回問對方「你呢？」要用第二人稱「Kiso(你)」，"
                        "Kako(我)/Cira(他)/Kamo(你們)人稱不合。",
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
