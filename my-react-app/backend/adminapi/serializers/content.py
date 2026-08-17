"""公告／首頁版位／考試時程覆寫，以及送審流程共用的 Reject/Approve
serializer（跨 Announcement 與題庫內容都會用到，見 quizbank.py 的
QuizVocabItemSerializer 等——放在這裡是因為 Announcement 是最早、最典型
的送審流程使用者，不是這兩個 serializer 只服務 Announcement）。"""
from config.tribes import TRIBE_IDS

from rest_framework import serializers

from ..models import Announcement, ExamScheduleOverride, HomepageConfig


class AnnouncementSerializer(serializers.ModelSerializer):
    class Meta:
        model = Announcement
        fields = [
            'id', 'title', 'body', 'category', 'tribes', 'cover_image_url',
            'link_url', 'is_pinned', 'pin_until', 'publish_at', 'unpublish_at',
            'status', 'source', 'display_date_text', 'created_by', 'submitted_by',
            'submitted_at', 'reviewed_by', 'reviewed_at', 'review_comment',
            'created_at', 'updated_at',
        ]
        # 狀態機欄位（status 以下）一律由 views.py 的動作端點（submit/approve/
        # reject/...）改，不開放透過一般的 create/update 直接寫入——不然
        # editor 可以自己把 status 設成 published，繞過核准流程。source 只讀
        # 的理由不同：它是「這筆從哪來的」事實記錄，不該被任何 API 呼叫改掉
        # （crawler_sync.sync_crawler_announcements() 直接用 ORM 寫入，不經過
        # 這個 serializer）。display_date_text 則相反，刻意開放給後台編輯——
        # 爬蟲匯入的日期文字如果顯示有誤，允許人工修正。
        #
        # 注意：external_id 刻意不放進 fields——它是爬蟲匯入專用的去重鍵，
        # 如果透過這個 serializer 開放寫入，後台自建公告在沒有明確帶值時
        # DRF 會送出預設值（空字串），第二篇後台自建公告存檔時就會撞上
        # 這個欄位的 unique 約束而噴錯。
        read_only_fields = [
            'id', 'status', 'source', 'created_by', 'submitted_by', 'submitted_at',
            'reviewed_by', 'reviewed_at', 'review_comment',
            'created_at', 'updated_at',
        ]

    def validate_title(self, value):
        if not value.strip():
            raise serializers.ValidationError('標題不能空白')
        return value

    def validate_tribes(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('tribes 必須是陣列')
        invalid = [t for t in value if t not in TRIBE_IDS]
        if invalid:
            raise serializers.ValidationError(f'不支援的族語：{", ".join(invalid)}')
        return value

    def validate(self, data):
        # is_pinned/pin_until、publish_at/unpublish_at 這兩組跨欄位規則
        # model.clean() 也有一份一樣的檢查（見 models.py 的說明：確保未來
        # 就算繞過 serializer 直接用 ORM 操作也擋得住）；這裡在 API 層先擋一次，
        # 讓錯誤能回傳成一般的 400 + 欄位訊息，而不是 model.clean() 丟出的
        # ValidationError 一路往外拋變成 500。
        is_pinned = data.get('is_pinned', getattr(self.instance, 'is_pinned', False))
        pin_until = data.get('pin_until', getattr(self.instance, 'pin_until', None))
        if is_pinned and not pin_until:
            raise serializers.ValidationError({'pin_until': '置頂必須設定到期日'})

        publish_at = data.get('publish_at', getattr(self.instance, 'publish_at', None))
        unpublish_at = data.get('unpublish_at', getattr(self.instance, 'unpublish_at', None))
        if unpublish_at and publish_at and unpublish_at <= publish_at:
            raise serializers.ValidationError({'unpublish_at': '下架時間必須晚於發布時間'})
        return data


class RejectSerializer(serializers.Serializer):
    # 退件一定要附理由，不然送審者不知道要改哪裡——跟前端原型「審查意見：
    # 退件時必填」的規格一致。
    review_comment = serializers.CharField(max_length=1000, trim_whitespace=True)

    def validate_review_comment(self, value):
        if not value.strip():
            raise serializers.ValidationError('退件必須填寫審查意見')
        return value


class ApproveSerializer(serializers.Serializer):
    # 核准時的意見是選填備註，不像退件那樣強制。
    review_comment = serializers.CharField(max_length=1000, allow_blank=True, required=False, default='')


class ExamScheduleOverrideSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExamScheduleOverride
        fields = ['phase', 'label', 'start_date', 'end_date', 'is_active', 'updated_by', 'updated_at']
        read_only_fields = ['updated_by', 'updated_at']

    def validate(self, data):
        # model.clean() 也有一份一樣的檢查，這裡在 API 層先擋，錯誤才能回傳
        # 成一般的 400 + 欄位訊息（理由跟 AnnouncementSerializer.validate 一致）。
        start_date = data.get('start_date', getattr(self.instance, 'start_date', None))
        end_date = data.get('end_date', getattr(self.instance, 'end_date', None))
        if end_date and start_date and end_date < start_date:
            raise serializers.ValidationError({'end_date': '結束日期不能早於開始日期'})
        return data


class HomepageConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = HomepageConfig
        fields = [
            'hero_image_url', 'hero_link_url', 'hero_title_override',
            'show_news_section', 'show_calendar_section', 'news_display_count',
            'button1_enabled', 'button2_enabled', 'button3_enabled',
            'updated_by', 'updated_at',
        ]
        read_only_fields = ['updated_by', 'updated_at']

    def validate_hero_link_url(self, value):
        # 這個欄位最終會變成公開首頁的 <a href>，任何訪客都會執行到——只接受
        # 內部相對路徑（開頭 "/" 但不是 "//"，避免 protocol-relative URL 被
        # 瀏覽器當成外部網址，跟這個專案登入頁 next 參數的開放重導向防護
        # 同一個理由）或 http(s) 網址，擋掉 javascript: 之類的危險 scheme。
        if not value:
            return value
        # 瀏覽器的 WHATWG URL 解析對 http(s) 這類 special scheme 會把反斜線
        # 視同斜線——"/\evil.example/path" 這種字串用純字串比對看起來是
        # 「以單一 / 開頭、不是 //」的合法內部路徑，瀏覽器卻可能解讀成
        # protocol-relative 的外部網址，等於防護被繞過（獨立審查找到的
        # 問題，跟這個專案登入頁 next 參數先前修過的同一類漏洞）。判斷前
        # 先把反斜線正規化成正斜線再檢查，貼近瀏覽器實際的解析行為。
        normalized = value.replace('\\', '/')
        if normalized.startswith('/') and not normalized.startswith('//'):
            return value
        if value.startswith('http://') or value.startswith('https://'):
            return value
        raise serializers.ValidationError('連結必須是內部路徑（以 / 開頭）或 http(s) 網址')

    def validate_news_display_count(self, value):
        if not (1 <= value <= 20):
            raise serializers.ValidationError('消息顯示筆數必須介於 1 到 20 之間')
        return value


class PublicHomepageConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = HomepageConfig
        # 公開首頁讀取用，不含 updated_by／updated_at 這些後台維運資訊。
        fields = [
            'hero_image_url', 'hero_link_url', 'hero_title_override',
            'show_news_section', 'show_calendar_section', 'news_display_count',
            'button1_enabled', 'button2_enabled', 'button3_enabled',
        ]


class PublicAnnouncementSerializer(serializers.ModelSerializer):
    class Meta:
        model = Announcement
        # 給首頁公開讀取用（見 views.py 的 public_announcement_list，任何人
        # 不需登入即可打）：只給前台會用到的展示欄位，刻意不含 status／
        # created_by／submitted_by／reviewed_by／review_comment 這些後台
        # 工作流程與人員資訊——沒有理由讓匿名訪客看到是誰審核、誰寫的內部意見。
        fields = [
            'id', 'title', 'body', 'category', 'tribes',
            'cover_image_url', 'link_url', 'is_pinned', 'publish_at',
            'display_date_text', 'source_tag',
        ]
