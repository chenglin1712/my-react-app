import adminapi.article_doc
from django.db import migrations, models


def _text(value):
    return {"type": "text", "text": value}


def _link(value, href):
    return {"type": "text", "text": value, "marks": [{"type": "link", "attrs": {"href": href}}]}


def _p(*parts):
    return {"type": "paragraph", "content": [_text(p) if isinstance(p, str) else p for p in parts]}


def _h(value):
    return {"type": "heading", "attrs": {"level": 2}, "content": [_text(value)]}


def _ul(*items):
    return {"type": "bulletList", "content": [{"type": "listItem", "content": [_p(item)]} for item in items]}


def default_doc():
    """目前系統實際運作的隱私說明（原本寫在前端頁面裡），首次部署時當作初始內文，之後由後台維護。"""
    return {"type": "doc", "content": [
        _h("帳號資料"),
        _p("註冊時會保存你的使用者名稱、電子郵件、身分、頭像網址與加入日期，以及你的收藏與答錯紀錄，另外會記錄你的登入／上線狀態與最後狀態變更時間。這些資料存放在 Google 的 Firebase 服務，用來讓你登入並保存學習進度。"),
        _p("筆記預設只存在你的瀏覽器裡；只有你選擇分享的筆記，才會存到 Firebase。"),
        _h("使用功能時傳送的內容"),
        _ul(
            "影像辨識：你選擇的圖片會傳送到 Google 的影像辨識服務，取得辨識結果；辨識出的標籤文字可能再送到 Google 的翻譯服務。",
            "翻譯與 AI 助手：你輸入的文字會傳送到 AI 服務處理，用來產生翻譯或回答。",
            "發音遊戲：錄音用來評分，不會自動公開；評分完成後，是否分享到社群示範發音頁由你自己選擇。選擇分享後，錄音會上傳到 Firebase，其他使用者可以聽到，分數較高的錄音也可能被選為其他人練習時的參考發音。",
        ),
        _h("未登入的試用"),
        _p("未登入使用翻譯試用時，為了限制每天的次數、避免被大量濫用，系統會把瀏覽器代號和連線來源 IP 各自轉換成雜湊值（無法直接還原成原本的內容），連同日期、當天的使用次數和更新時間一起保存。這份次數表不保存明文 IP。"),
        _p("這些紀錄原則上只保留 3 天，超過的紀錄會由系統定期清除；實際刪除的時間可能稍有延遲。"),
        _p("一般的網站伺服器存取紀錄另有保存期限，不屬於上述次數表。"),
        _h("你的資料"),
        _p("對你的資料有疑問，或想詢問、更正、刪除，請見", _link("聯絡我們", "/contact"), "。"),
    ]}


def seed_default(apps, schema_editor):
    PrivacyPolicy = apps.get_model("adminapi", "PrivacyPolicy")
    PrivacyPolicy.objects.get_or_create(pk=1, defaults={"content": default_doc()})


class Migration(migrations.Migration):

    dependencies = [
        ("adminapi", "0025_featured_topic_rich_content"),
    ]

    operations = [
        migrations.CreateModel(
            name="PrivacyPolicy",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("content", models.JSONField(blank=True, default=dict, validators=[adminapi.article_doc.validate_article_doc])),
                ("updated_by", models.CharField(blank=True, max_length=128)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"abstract": False},
        ),
        migrations.RunPython(seed_default, migrations.RunPython.noop),
    ]
