from types import SimpleNamespace
from unittest.mock import patch, MagicMock

from django.core.cache import cache
from django.test import TestCase, Client
from django.test.utils import override_settings

from crawler.dictionary_source import fetch_words_by_glosses
from adminapi.models import (
    ExamScheduleCrawlStatus, ExamScheduleOverride, FeatureFlag, QuizChoiceItem, QuizClozePassage,
    QuizSituationItem, QuizTrueFalseItem, QuizVocabItem,
)


class GetQuizDataTest(TestCase):
    """get_quiz_data 現在要求登入 + 限流，且四個等級全部改讀本地題庫（P2.5
    遷移，見 views.py 的說明）——不再即時代理外部 API，也不再需要
    QuizSourceConfig 才能回應（那張表現在只給 migrate_quiz_level12_to_db
    一次性匯入用，不影響即時出題）。"""

    def setUp(self):
        self.client = Client()
        cache.clear()

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_requires_login_when_bypass_disabled(self):
        response = self.client.get('/crawler/?tribe=tayal&level=1')
        self.assertEqual(response.status_code, 401)

    @patch('crawler.views.is_ratelimited', return_value=True)
    def test_rate_limited_returns_429(self, _mock_limited):
        response = self.client.get('/crawler/?tribe=tayal&level=1')
        self.assertEqual(response.status_code, 429)

    def test_unsupported_tribe_returns_400(self):
        response = self.client.get('/crawler/?tribe=not_a_tribe&level=1')
        self.assertEqual(response.status_code, 400)
        self.assertIn('不支援的族語', response.json()['detail'])

    def test_unsupported_level_returns_400(self):
        response = self.client.get('/crawler/?tribe=tayal&level=9')
        self.assertEqual(response.status_code, 400)
        self.assertIn('不支援的等級', response.json()['detail'])

    def test_disabled_tribe_flag_returns_403_not_empty_list(self):
        # 族語測驗總開關關閉時要明確回 403，不是靜默回空題目陣列——空陣列
        # 會讓學生誤以為題庫剛好是空的，403 才能讓前端顯示「暫停開放」。
        FeatureFlag.objects.create(key='quiz_enabled_tayal', label='泰雅語測驗', enabled=False)
        response = self.client.get('/crawler/?tribe=tayal&level=1')
        self.assertEqual(response.status_code, 403)

    def test_disabled_flag_does_not_affect_other_tribes(self):
        FeatureFlag.objects.create(key='quiz_enabled_tayal', label='泰雅語測驗', enabled=False)
        with patch('crawler.exam_site.requests.get') as mock_get:
            mock_get.return_value = MagicMock(status_code=200, json=lambda: {})
            response = self.client.get('/crawler/?tribe=amis&level=3')
        self.assertNotEqual(response.status_code, 403)

    def test_no_flag_record_defaults_to_enabled(self):
        # seed_feature_flags 沒跑過、或這個族語從未被登錄過 FeatureFlag 時，
        # 視為未關閉——維持現況行為，不強制每個族語都要先在資料庫登錄過。
        response = self.client.get('/crawler/?tribe=tayal&level=3')
        self.assertNotEqual(response.status_code, 403)

    def test_enabled_true_flag_does_not_block(self):
        FeatureFlag.objects.create(key='quiz_enabled_tayal', label='泰雅語測驗', enabled=True)
        response = self.client.get('/crawler/?tribe=tayal&level=3')
        self.assertNotEqual(response.status_code, 403)

    def test_level_3_uses_local_bank_not_external_api(self):
        # level 3/4 完全不碰 requests.get——資料來源是後台題庫（QuizVocabItem／
        # QuizClozePassage），不是外部 API，也不是寫死在 *_bank.py 的常數。
        with patch('crawler.exam_site.requests.get') as mock_get:
            response = self.client.get('/crawler/?tribe=tayal&level=3')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn('parts', data)
        mock_get.assert_not_called()

    def test_level_3_only_serves_published_vocab_items(self):
        # 草稿／待審核／已退件的詞彙不能被學生抽到——這是把題庫搬進資料庫、
        # 接上族語老師審定流程的核心目的，不是可有可無的細節。額外建 3 筆
        # 填充用已核准詞彙湊滿一組（MATCHING_PAIRS_PER_BOARD=4），否則題庫
        # 不足只有 1 筆已核准詞彙時，build_matching_test_from_db 現在會
        # 直接不產生任何題組（見同一輪修正），這支測試的重點是「草稿不會
        # 被抽到」，不是題庫不足的行為。
        QuizVocabItem.objects.create(
            tribe='tayal', category='noun', foreign_word='huzil', chinese_gloss='狗',
            status=QuizVocabItem.STATUS_PUBLISHED, created_by='tester',
        )
        for i in range(3):
            QuizVocabItem.objects.create(
                tribe='tayal', category='noun', foreign_word=f'filler{i}', chinese_gloss=f'填充詞{i}',
                status=QuizVocabItem.STATUS_PUBLISHED, created_by='tester',
            )
        QuizVocabItem.objects.create(
            tribe='tayal', category='noun', foreign_word='bzyok', chinese_gloss='豬',
            status=QuizVocabItem.STATUS_DRAFT, created_by='tester',
        )

        response = self.client.get('/crawler/?tribe=tayal&level=3')

        self.assertEqual(response.status_code, 200)
        all_words = [
            pair['word']['word']
            for question in response.json()['parts'][0]['questions']
            for pair in question['pairs']
        ]
        self.assertIn('huzil', all_words)
        self.assertNotIn('bzyok', all_words)

    def test_level_4_only_serves_published_cloze_passages(self):
        QuizClozePassage.objects.create(
            tribe='tayal', passage_foreign='Lokah! {blank1}', passage_chinese='你好！',
            blanks={'blank1': {'options': ['a', 'b', 'c', 'd'], 'answer': 1}},
            status=QuizClozePassage.STATUS_PUBLISHED, created_by='tester',
        )
        QuizClozePassage.objects.create(
            tribe='tayal', passage_foreign='Musa {blank1} rgyax.', passage_chinese='去山上。',
            blanks={'blank1': {'options': ['a', 'b', 'c', 'd'], 'answer': 1}},
            status=QuizClozePassage.STATUS_DRAFT, created_by='tester',
        )

        response = self.client.get('/crawler/?tribe=tayal&level=4')

        self.assertEqual(response.status_code, 200)
        passages = [q['passage_ch'] for q in response.json()['parts'][0]['questions']]
        self.assertIn('你好！', passages)
        self.assertNotIn('去山上。', passages)

    def test_level_1_uses_local_bank_not_external_api(self):
        # level 1/2 也已經改讀本地題庫（QuizTrueFalseItem／QuizChoiceItem），
        # 完全不碰 requests.get（P2.5 遷移，取代原本即時代理外部 API 的做法）。
        with patch('crawler.exam_site.requests.get') as mock_get:
            response = self.client.get('/crawler/?tribe=tayal&level=1')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn('parts', data)
        mock_get.assert_not_called()

    def test_level_1_only_serves_published_true_false_items(self):
        QuizTrueFalseItem.objects.create(
            tribe='tayal', question_ab='qani ga, huzil.', question_ch='這是狗。',
            audio_url='https://res.cloudinary.com/demo/video/upload/a.mp3',
            image_url='https://res.cloudinary.com/demo/image/upload/a.png',
            answer=QuizTrueFalseItem.ANSWER_TRUE,
            status=QuizTrueFalseItem.STATUS_PUBLISHED, created_by='tester',
        )
        QuizTrueFalseItem.objects.create(
            tribe='tayal', question_ab='qani ga, bzyok.', question_ch='這是豬。',
            audio_url='https://res.cloudinary.com/demo/video/upload/b.mp3',
            image_url='https://res.cloudinary.com/demo/image/upload/b.png',
            answer=QuizTrueFalseItem.ANSWER_TRUE,
            status=QuizTrueFalseItem.STATUS_DRAFT, created_by='tester',
        )

        response = self.client.get('/crawler/?tribe=tayal&level=1')

        self.assertEqual(response.status_code, 200)
        questions = [q['question_ab'] for q in response.json()['parts'][0]['questions']]
        self.assertIn('qani ga, huzil.', questions)
        self.assertNotIn('qani ga, bzyok.', questions)

    def test_level_2_uses_local_bank_not_external_api(self):
        with patch('crawler.exam_site.requests.get') as mock_get:
            response = self.client.get('/crawler/?tribe=tayal&level=2')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn('parts', data)
        mock_get.assert_not_called()

    def test_level_2_only_serves_published_choice_items(self):
        QuizChoiceItem.objects.create(
            tribe='tayal', question_ab='nyux qutux huzil maku.', question_ch='我有一隻狗。',
            image_a_url='https://res.cloudinary.com/demo/image/upload/a.png',
            image_b_url='https://res.cloudinary.com/demo/image/upload/b.png',
            image_c_url='https://res.cloudinary.com/demo/image/upload/c.png',
            answer=1, status=QuizChoiceItem.STATUS_PUBLISHED, created_by='tester',
        )
        QuizChoiceItem.objects.create(
            tribe='tayal', question_ab='cyux bbiru nha.', question_ch='他們有鉛筆。',
            image_a_url='https://res.cloudinary.com/demo/image/upload/d.png',
            image_b_url='https://res.cloudinary.com/demo/image/upload/e.png',
            image_c_url='https://res.cloudinary.com/demo/image/upload/f.png',
            answer=1, status=QuizChoiceItem.STATUS_DRAFT, created_by='tester',
        )

        response = self.client.get('/crawler/?tribe=tayal&level=2')

        self.assertEqual(response.status_code, 200)
        questions = [q['question_ab'] for q in response.json()['parts'][0]['questions']]
        self.assertIn('nyux qutux huzil maku.', questions)
        self.assertNotIn('cyux bbiru nha.', questions)

    def test_level_1_questions_carry_item_id(self):
        # P5.3 題目品質分析地基：出題端點要帶回資料庫 pk，前端才能在作答時
        # 回報「答的是哪一題」，見 views.py build_true_false_test_from_db 的說明。
        item = QuizTrueFalseItem.objects.create(
            tribe='tayal', question_ab='qani ga, huzil.', question_ch='這是狗。',
            audio_url='https://res.cloudinary.com/demo/video/upload/a.mp3',
            image_url='https://res.cloudinary.com/demo/image/upload/a.png',
            answer=QuizTrueFalseItem.ANSWER_TRUE,
            status=QuizTrueFalseItem.STATUS_PUBLISHED, created_by='tester',
        )
        response = self.client.get('/crawler/?tribe=tayal&level=1')
        questions = response.json()['parts'][0]['questions']
        self.assertEqual(questions[0]['item_id'], item.id)

    def test_level_2_questions_carry_item_id(self):
        item = QuizChoiceItem.objects.create(
            tribe='tayal', question_ab='nyux qutux huzil maku.', question_ch='我有一隻狗。',
            image_a_url='https://res.cloudinary.com/demo/image/upload/a.png',
            image_b_url='https://res.cloudinary.com/demo/image/upload/b.png',
            image_c_url='https://res.cloudinary.com/demo/image/upload/c.png',
            answer=1, status=QuizChoiceItem.STATUS_PUBLISHED, created_by='tester',
        )
        response = self.client.get('/crawler/?tribe=tayal&level=2')
        questions = response.json()['parts'][0]['questions']
        self.assertEqual(questions[0]['item_id'], item.id)

    def test_level_3_pairs_carry_item_id(self):
        # 配合題一「題」是好幾個 QuizVocabItem 的組合，item_id 放在每個 pair
        # 上（不是題目層級），見 views.py build_matching_test_from_db 的說明。
        # 這裡建 4 筆（MATCHING_PAIRS_PER_BOARD）才能湊出一個「完整」題組——
        # 少於 4 筆的話，build_matching_test_from_db 現在會直接不產生任何
        # 題組（見同一輪修正的 test_insufficient_vocab_pool_produces_no_incomplete_board），
        # 這支測試只在乎 item_id 有沒有正確帶出來，不是題庫不足的行為。
        item = QuizVocabItem.objects.create(
            tribe='tayal', category='noun', foreign_word='huzil', chinese_gloss='狗',
            status=QuizVocabItem.STATUS_PUBLISHED, created_by='tester',
        )
        for i in range(3):
            QuizVocabItem.objects.create(
                tribe='tayal', category='noun', foreign_word=f'filler{i}', chinese_gloss=f'填充詞{i}',
                status=QuizVocabItem.STATUS_PUBLISHED, created_by='tester',
            )
        response = self.client.get('/crawler/?tribe=tayal&level=3')
        all_pairs = [
            pair
            for question in response.json()['parts'][0]['questions']
            for pair in question['pairs']
        ]
        huzil_pair = next(p for p in all_pairs if p['word']['word'] == 'huzil')
        self.assertEqual(huzil_pair['item_id'], item.id)

    def test_insufficient_vocab_pool_produces_no_incomplete_board(self):
        """獨立審查找到的問題：題庫不足時，原本仍固定產生 5 題，最後幾組
        會是不滿 4 配對甚至完全空的殘缺題組，學生看到卻無法作答。現在只
        會產生「完整」的題組（每組固定 4 配對），題庫不足時題數就是變少，
        不製造殘缺的題目——這裡只建 5 筆（湊 1 組滿的還多 1 筆），驗證只
        產生 1 題、且那 1 題確實有滿滿 4 個配對，多出來的 1 筆不會被拿去
        湊一個不完整的第 2 題。"""
        for i in range(5):
            QuizVocabItem.objects.create(
                tribe='tayal', category='noun', foreign_word=f'word{i}', chinese_gloss=f'詞{i}',
                status=QuizVocabItem.STATUS_PUBLISHED, created_by='tester',
            )
        response = self.client.get('/crawler/?tribe=tayal&level=3')
        part = response.json()['parts'][0]
        self.assertEqual(len(part['questions']), 1)
        self.assertEqual(len(part['questions'][0]['pairs']), 4)
        self.assertIn('本部分共1題', part['intro'])

    def test_empty_vocab_pool_produces_zero_questions_not_error(self):
        """完全沒有已核准詞彙時（picked 總數 0），比照 build_cloze_test_from_db
        遇到題庫全空時的既有降級行為——回傳空題目陣列，不是報錯或整個
        端點崩潰。"""
        response = self.client.get('/crawler/?tribe=tayal&level=3')
        part = response.json()['parts'][0]
        self.assertEqual(part['questions'], [])

    def test_level_4_questions_carry_composite_item_id(self):
        # 克漏字一「題」是一個空格，不是一整篇短文，item_id 是
        # "{passage.id}:{blank_key}" 複合字串，見 views.py
        # build_cloze_test_from_db 的說明。
        passage = QuizClozePassage.objects.create(
            tribe='tayal', passage_foreign='Lokah! {blank1}', passage_chinese='你好！',
            blanks={'blank1': {'options': ['a', 'b', 'c', 'd'], 'answer': 1}},
            status=QuizClozePassage.STATUS_PUBLISHED, created_by='tester',
        )
        response = self.client.get('/crawler/?tribe=tayal&level=4')
        questions = response.json()['parts'][0]['questions']
        self.assertEqual(questions[0]['item_id'], f'{passage.id}:blank1')


class GetSituationQuizDataTest(TestCase):
    """情境題的獨立出題端點——P5.3 第一次真的把 QuizSituationItem 接上
    學生端（P2 上線後只有後台管理，沒有任何學生端出題路徑）。"""

    def setUp(self):
        self.client = Client()
        cache.clear()

    @override_settings(AUTH_DEV_BYPASS=False)
    def test_requires_login_when_bypass_disabled(self):
        response = self.client.get('/crawler/situation-quiz/?tribe=tayal')
        self.assertEqual(response.status_code, 401)

    @patch('crawler.views.is_ratelimited', return_value=True)
    def test_rate_limited_returns_429(self, _mock_limited):
        response = self.client.get('/crawler/situation-quiz/?tribe=tayal')
        self.assertEqual(response.status_code, 429)

    def test_unsupported_tribe_returns_400(self):
        response = self.client.get('/crawler/situation-quiz/?tribe=not_a_tribe')
        self.assertEqual(response.status_code, 400)
        self.assertIn('不支援的族語', response.json()['detail'])

    def test_disabled_tribe_flag_returns_403(self):
        FeatureFlag.objects.create(key='quiz_enabled_tayal', label='泰雅語測驗', enabled=False)
        response = self.client.get('/crawler/situation-quiz/?tribe=tayal')
        self.assertEqual(response.status_code, 403)

    def test_only_serves_published_items_and_carries_item_id(self):
        published = QuizSituationItem.objects.create(
            tribe='tayal', scenario_chinese='長輩遞給你食物，你要怎麼用族語回應？',
            options=[
                {'foreign': 'Mhway su balay.', 'chinese': '非常謝謝你。'},
                {'foreign': 'Lokah su?', 'chinese': '你好嗎？'},
                {'foreign': 'Musa su inu?', 'chinese': '你要去哪裡？'},
                {'foreign': 'Baq su balay.', 'chinese': '你很棒。'},
            ],
            answer=1, status=QuizSituationItem.STATUS_PUBLISHED, created_by='tester',
        )
        QuizSituationItem.objects.create(
            tribe='tayal', scenario_chinese='草稿題目，不應該被抽到。',
            options=[
                {'foreign': 'a', 'chinese': 'a'}, {'foreign': 'b', 'chinese': 'b'},
                {'foreign': 'c', 'chinese': 'c'}, {'foreign': 'd', 'chinese': 'd'},
            ],
            answer=1, status=QuizSituationItem.STATUS_DRAFT, created_by='tester',
        )

        response = self.client.get('/crawler/situation-quiz/?tribe=tayal')

        self.assertEqual(response.status_code, 200)
        questions = response.json()['parts'][0]['questions']
        self.assertEqual(len(questions), 1)
        self.assertEqual(questions[0]['item_id'], published.id)
        self.assertEqual(questions[0]['scenario_ch'], '長輩遞給你食物，你要怎麼用族語回應？')
        self.assertEqual(len(questions[0]['options']), 4)

    def test_response_shape_matches_get_quiz_data_envelope(self):
        # 前端沿用既有 quiz_panel.jsx 的資料流程，回應信封（chapter_name／
        # parts[0].type/title/intro/questions）要跟 get_quiz_data 一致。
        response = self.client.get('/crawler/situation-quiz/?tribe=tayal')
        data = response.json()
        self.assertIn('chapter_name', data)
        self.assertEqual(data['parts'][0]['type'], 'situation')
        self.assertIn('title', data['parts'][0])
        self.assertIn('intro', data['parts'][0])


class GetTayalImformationTest(TestCase):
    """首頁新聞端點：維持公開（不要求登入），但要有限流。"""

    def setUp(self):
        self.client = Client()
        cache.clear()

    @patch('crawler.views.is_ratelimited', return_value=True)
    def test_rate_limited_returns_429(self, _mock_limited):
        response = self.client.get('/crawler/news/')
        self.assertEqual(response.status_code, 429)

    def test_does_not_require_login(self):
        with override_settings(AUTH_DEV_BYPASS=False):
            with patch('crawler.exam_site.requests.get') as mock_get:
                mock_response = MagicMock()
                mock_response.status_code = 200
                mock_response.json.return_value = {"data": []}
                mock_response.text = "<html></html>"
                mock_get.return_value = mock_response
                response = self.client.get('/crawler/news/')
        self.assertEqual(response.status_code, 200)

    @patch('crawler.exam_site.BeautifulSoup')
    @patch('crawler.exam_site.requests.get')
    def test_both_sources_failing_returns_502_not_cached_empty_200(self, mock_get, mock_soup):
        # 原本兩個來源都用 bare except 吞掉例外、只記 log，最後一律回 200，呼叫端
        # 沒辦法分辨「今天真的沒新聞」跟「爬蟲已經壞掉」。兩個來源都真的丟例外時
        # 應該回 502，且不該把這次的空結果快取下來（否則要等 TTL 過期才會重新
        # 嘗試，502 狀況會被快取的空結果多拖 15 分鐘）。
        mock_get.side_effect = Exception("tacp/exam 皆連線失敗")

        response = self.client.get('/crawler/news/')

        self.assertEqual(response.status_code, 502)
        from django.core.cache import cache as django_cache
        self.assertIsNone(django_cache.get('crawler_news_data'))

    @patch('crawler.exam_site.requests.get')
    def test_partial_success_still_returns_200(self, mock_get):
        # tacp 來源成功、exam 來源（BeautifulSoup 解析）就算沒抓到任何項目也不算
        # 「失敗」，只要有一個來源正常跑完，就仍視為部分成功。
        def fake_get(url, headers=None, timeout=None):
            resp = MagicMock()
            if "tacp.gov.tw" in url:
                resp.status_code = 200
                resp.json.return_value = {"data": []}
            else:
                resp.status_code = 200
                resp.text = "<html></html>"
            return resp

        mock_get.side_effect = fake_get

        response = self.client.get('/crawler/news/')

        self.assertEqual(response.status_code, 200)

    @patch('crawler.exam_site.requests.get')
    def test_source_key_present_for_tacp_and_ntnu_items(self, mock_get):
        # source_key 是 adminapi/crawler_sync.py 拿來去重的鍵，格式要能區分
        # 兩個資料來源（tacp:<id> / ntnu-abst:<url>），不能兩邊撞在一起。
        def fake_get(url, headers=None, timeout=None):
            resp = MagicMock()
            resp.status_code = 200
            if "tacp.gov.tw" in url:
                resp.json.return_value = {"data": [
                    {"id": 999, "category_id": 1, "title": "測試活動", "images": []},
                ]}
            else:
                resp.text = (
                    '<html><body><div class="pnlArticles"><ul>'
                    '<li><small>115年8月1日</small><a href="x.html">測試考試新聞</a></li>'
                    '</ul></div></body></html>'
                )
            return resp

        mock_get.side_effect = fake_get

        response = self.client.get('/crawler/news/')
        data = response.json()

        tacp_item = next(i for i in data if i['isExam'] == 'F')
        exam_item = next(i for i in data if i['isExam'] == 'T')
        self.assertEqual(tacp_item['source_key'], 'tacp:999')
        self.assertEqual(exam_item['source_key'], 'ntnu-abst:https://exam.sce.ntnu.edu.tw/abst/x.html')

    @patch('crawler.exam_site.requests.get')
    def test_javascript_href_in_exam_news_is_rejected(self, mock_get):
        # 上游 HTML 若被竄改成危險 scheme 的 href，detail/source_key 都必須
        # 是 None，不能把 javascript: 網址存進任何後續會被渲染成 <a href>
        # 的地方（見 _safe_external_url 的說明）。
        def fake_get(url, headers=None, timeout=None):
            resp = MagicMock()
            resp.status_code = 200
            if "tacp.gov.tw" in url:
                resp.json.return_value = {"data": []}
            else:
                resp.text = (
                    '<html><body><div class="pnlArticles"><ul>'
                    '<li><small>115年8月1日</small><a href="javascript:alert(1)">壞連結</a></li>'
                    '</ul></div></body></html>'
                )
            return resp

        mock_get.side_effect = fake_get

        response = self.client.get('/crawler/news/')
        data = response.json()

        exam_item = next(i for i in data if i['isExam'] == 'T')
        self.assertIsNone(exam_item['detail'])
        self.assertIsNone(exam_item['source_key'])

    @patch('crawler.exam_site.requests.get')
    def test_force_refresh_bypasses_both_cache_layers(self, mock_get):
        # get_news_data 底下疊了兩層快取（自己的 NEWS_CACHE_KEY，以及跟考試
        # 時程共用的 EXAM_SITE_HTML_CACHE_KEY）；force_refresh 必須連共用的
        # HTML 快取也一起略過，否則「看起來重爬、其實還是吃 15 分鐘前的
        # 內容」——同一個坑 get_exam_schedule_data 已經踩過一次。
        from crawler.views import get_news_data

        def fake_get(url, headers=None, timeout=None):
            resp = MagicMock()
            resp.status_code = 200
            if "tacp.gov.tw" in url:
                resp.json.return_value = {"data": []}
            else:
                resp.text = "<html></html>"
            return resp

        mock_get.side_effect = fake_get

        get_news_data()  # 第一次：填滿兩層快取
        self.assertEqual(mock_get.call_count, 2)  # tacp + exam html 各一次

        get_news_data()  # 快取命中，不應該再打外部網站
        self.assertEqual(mock_get.call_count, 2)

        get_news_data(force_refresh=True)  # 強制重爬，兩層快取都要略過
        self.assertEqual(mock_get.call_count, 4)


# 官網（exam.sce.ntnu.edu.tw/abst/）日程表頁面結構的精簡版，只留下解析邏輯真正
# 依賴的部分：排除 news-tab 的第一個梯次分頁按鈕（取得梯次標題），以及該分頁
# 底下 table 的其中兩列（期程名稱 + 帶 dates= 參數的 Google 行事曆連結）。
FAKE_EXAM_SCHEDULE_HTML = """
<html><body>
<ul class="nav nav-tabs">
  <li><button class="nav-link active" id="news-tab">最新消息</button></li>
  <li><button class="nav-link" id="0-tab">115年度第1次原住民族語言能力認證測驗日程表</button></li>
</ul>
<div class="tab-pane" id="news-pane"></div>
<div class="tab-pane" id="0-pane">
  <table><tbody>
    <tr>
      <td><span class="fw-bold">報名日期</span></td>
      <td><a href="https://www.google.com/calendar/event?action=TEMPLATE&text=x&dates=20260121T100000/20260226T235900">115年1月21日(三) ~ 115年2月26日(四)</a></td>
    </tr>
    <tr>
      <td><span class="fw-bold">測驗日期</span></td>
      <td><a href="https://www.google.com/calendar/event?action=TEMPLATE&text=x&dates=20260418T000000/20260418T000000">115年4月18日(六)</a></td>
    </tr>
  </tbody></table>
</div>
</body></html>
"""


class GetExamScheduleTest(TestCase):
    """族語認證考試時程：爬官網日程表取代前端原本寫死的 examSchedule 假資料。"""

    def setUp(self):
        self.client = Client()
        cache.clear()

    @patch('crawler.views.is_ratelimited', return_value=True)
    def test_rate_limited_returns_429(self, _mock_limited):
        response = self.client.get('/crawler/exam_schedule/')
        self.assertEqual(response.status_code, 429)

    def test_does_not_require_login(self):
        with override_settings(AUTH_DEV_BYPASS=False):
            with patch('crawler.exam_site.requests.get') as mock_get:
                mock_response = MagicMock()
                mock_response.status_code = 200
                mock_response.text = FAKE_EXAM_SCHEDULE_HTML
                mock_get.return_value = mock_response
                response = self.client.get('/crawler/exam_schedule/')
        self.assertEqual(response.status_code, 200)

    @patch('crawler.exam_site.requests.get')
    def test_upstream_request_failure_returns_502(self, mock_get):
        import requests
        mock_get.side_effect = requests.exceptions.ConnectTimeout("upstream timed out")

        response = self.client.get('/crawler/exam_schedule/')

        self.assertEqual(response.status_code, 502)

    @patch('crawler.exam_site.requests.get')
    def test_no_phases_parsed_returns_502_not_cached(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "<html><body>沒有日程表</body></html>"
        mock_get.return_value = mock_response

        response = self.client.get('/crawler/exam_schedule/')

        self.assertEqual(response.status_code, 502)
        from django.core.cache import cache as django_cache
        self.assertIsNone(django_cache.get('crawler_exam_schedule_data'))

    @patch('crawler.exam_site.requests.get')
    def test_parses_session_name_and_phases_with_dates(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = FAKE_EXAM_SCHEDULE_HTML
        mock_get.return_value = mock_response

        response = self.client.get('/crawler/exam_schedule/')

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['session'], '115年度第1次原住民族語言能力認證測驗日程表')
        self.assertEqual(len(data['phases']), 2)

        registration = data['phases'][0]
        self.assertEqual(registration['phase'], '報名')
        self.assertEqual(registration['start_date'], '2026-01-21')
        self.assertEqual(registration['end_date'], '2026-02-26')

        exam_date = data['phases'][1]
        self.assertEqual(exam_date['phase'], '測驗')
        self.assertEqual(exam_date['start_date'], '2026-04-18')
        # 起訖同一天時 end_date 應為 None，不是重複同一天的日期字串
        self.assertIsNone(exam_date['end_date'])

    @patch('crawler.exam_site.requests.get')
    def test_response_is_cached_across_requests(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = FAKE_EXAM_SCHEDULE_HTML
        mock_get.return_value = mock_response

        first = self.client.get('/crawler/exam_schedule/')
        second = self.client.get('/crawler/exam_schedule/')

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json(), second.json())
        mock_get.assert_called_once()


class ExamScheduleOverrideTest(TestCase):
    """後台人工覆寫套進公開端點的行為（見 crawler/views.py 的
    apply_exam_schedule_overrides／get_exam_schedule）。"""

    def setUp(self):
        self.client = Client()
        cache.clear()

    @patch('crawler.exam_site.requests.get')
    def test_active_override_replaces_matching_phase(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = FAKE_EXAM_SCHEDULE_HTML
        mock_get.return_value = mock_response
        ExamScheduleOverride.objects.create(
            phase='報名', label='報名日期（人工修正）', start_date='2026-01-25', end_date='2026-03-01',
        )

        response = self.client.get('/crawler/exam_schedule/')
        phases = {p['phase']: p for p in response.json()['phases']}

        self.assertEqual(len(response.json()['phases']), 2)  # 取代既有筆數，不是額外多一筆
        self.assertEqual(phases['報名']['label'], '報名日期（人工修正）')
        self.assertEqual(phases['報名']['start_date'], '2026-01-25')
        self.assertEqual(phases['測驗']['start_date'], '2026-04-18')  # 沒被覆寫的維持爬蟲原值

    @patch('crawler.exam_site.requests.get')
    def test_inactive_override_does_not_apply(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = FAKE_EXAM_SCHEDULE_HTML
        mock_get.return_value = mock_response
        ExamScheduleOverride.objects.create(
            phase='報名', start_date='2026-01-25', is_active=False,
        )

        response = self.client.get('/crawler/exam_schedule/')
        phases = {p['phase']: p for p in response.json()['phases']}
        self.assertEqual(phases['報名']['start_date'], '2026-01-21')  # 停用的覆寫不生效

    @patch('crawler.exam_site.requests.get')
    def test_override_for_phase_not_scraped_is_appended(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = FAKE_EXAM_SCHEDULE_HTML
        mock_get.return_value = mock_response
        ExamScheduleOverride.objects.create(phase='證書', label='寄發合格證書', start_date='2026-06-01')

        response = self.client.get('/crawler/exam_schedule/')
        phases = {p['phase']: p for p in response.json()['phases']}
        self.assertEqual(len(response.json()['phases']), 3)
        self.assertEqual(phases['證書']['start_date'], '2026-06-01')

    @patch('crawler.exam_site.requests.get')
    def test_crawl_failure_falls_back_to_override_only_instead_of_502(self, mock_get):
        import requests
        mock_get.side_effect = requests.exceptions.ConnectTimeout("upstream timed out")
        ExamScheduleOverride.objects.create(phase='報名', start_date='2026-01-25', end_date='2026-03-01')

        response = self.client.get('/crawler/exam_schedule/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()['phases']), 1)
        self.assertEqual(response.json()['phases'][0]['phase'], '報名')

    @patch('crawler.exam_site.requests.get')
    def test_crawl_failure_without_any_override_still_502s(self, mock_get):
        import requests
        mock_get.side_effect = requests.exceptions.ConnectTimeout("upstream timed out")

        response = self.client.get('/crawler/exam_schedule/')
        self.assertEqual(response.status_code, 502)

    @patch('crawler.exam_site.requests.get')
    def test_successful_crawl_records_status(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = FAKE_EXAM_SCHEDULE_HTML
        mock_get.return_value = mock_response

        self.client.get('/crawler/exam_schedule/')

        status = ExamScheduleCrawlStatus.load()
        self.assertIsNotNone(status.last_success_at)
        self.assertEqual(status.consecutive_failures, 0)

    @patch('crawler.exam_site.requests.get')
    def test_failed_crawl_increments_consecutive_failures(self, mock_get):
        import requests
        mock_get.side_effect = requests.exceptions.ConnectTimeout("upstream timed out")

        self.client.get('/crawler/exam_schedule/')
        self.client.get('/crawler/exam_schedule/')

        status = ExamScheduleCrawlStatus.load()
        self.assertEqual(status.consecutive_failures, 2)
        self.assertIn('上游請求失敗', status.last_failure_reason)

    @patch('crawler.exam_site.requests.get')
    def test_cache_hit_does_not_touch_crawl_status(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = FAKE_EXAM_SCHEDULE_HTML
        mock_get.return_value = mock_response

        self.client.get('/crawler/exam_schedule/')
        status_after_first = ExamScheduleCrawlStatus.load()
        first_success_at = status_after_first.last_success_at

        self.client.get('/crawler/exam_schedule/')  # 第二次應該吃快取，不重新爬
        status_after_second = ExamScheduleCrawlStatus.load()
        self.assertEqual(status_after_second.last_success_at, first_success_at)
        mock_get.assert_called_once()


class FetchWordsByGlossesTest(TestCase):
    """dictionary_source.fetch_words_by_glosses 原本用原生 sqlite3.connect() 直接開檔，
    繞過 dictionary_db/connect.py 的連線池與 WAL/外鍵 PRAGMA 保護（跟 CrosswordPuzzle
    的 _get_words_from_db 一致的問題，那邊已經修過，這裡原本沒有跟上）。改成
    SessionLocal + text() 之後，這裡驗證：查詢有透過共用的 SessionLocal、
    正確依詞義篩選比對、同一詞義取第一筆、查無資料的族語回傳空字典。"""

    def _fake_rows(self, rows):
        db = MagicMock()
        db.execute.return_value.fetchall.return_value = [
            SimpleNamespace(name=name, chinese_explanation=chinese) for name, chinese in rows
        ]
        return db

    @patch('crawler.dictionary_source.SessionLocal')
    def test_uses_shared_session_local(self, mock_session_local):
        db = self._fake_rows([("balay", "真的")])
        mock_session_local.return_value = db

        fetch_words_by_glosses("tayal", ["真的"])

        mock_session_local.assert_called_once()
        db.close.assert_called_once()

    @patch('crawler.dictionary_source.SessionLocal')
    def test_filters_to_requested_glosses_only(self, mock_session_local):
        mock_session_local.return_value = self._fake_rows([
            ("balay", "真的"), ("cyux", "在"), ("maku", "我的"),
        ])

        result = fetch_words_by_glosses("tayal", ["真的", "我的"])

        self.assertEqual(set(result.keys()), {"真的", "我的"})
        self.assertEqual(result["真的"], {"word": "balay", "chinese": "真的"})
        self.assertNotIn("在", result)

    @patch('crawler.dictionary_source.SessionLocal')
    def test_keeps_first_match_when_gloss_has_multiple_words(self, mock_session_local):
        mock_session_local.return_value = self._fake_rows([
            ("balay", "真的"), ("balay2", "真的"),
        ])

        result = fetch_words_by_glosses("tayal", ["真的"])

        self.assertEqual(result["真的"]["word"], "balay")

    def test_unknown_tribe_returns_empty_dict_without_querying(self):
        result = fetch_words_by_glosses("not-a-real-tribe", ["真的"])
        self.assertEqual(result, {})
