"""S3-3 本期專題：模型驗證、狀態機、最多 3 筆已發布、編輯已發布、審核佇列與公開端點。

契約見 HOMEPAGE_CONTRACT.md 3.3 與 4.2。
"""
import json
import os
from contextlib import contextmanager
from unittest.mock import patch

from django.core.exceptions import ValidationError
from django.core.cache import cache
from django.test import Client, TestCase
from django.test.utils import override_settings

from adminapi.auth_fixtures import fresh_auth
from config.roles import ADMIN, ANALYST, EDITOR, OWNER, REVIEWER

from . import featured_topic_service
from .models import AuditLog, FeaturedTopic, HomepageConfig, PendingRevision

ADMIN_URL = "/adminapi/featured-topics/"
PUBLIC_URL = "/adminapi/public/featured-topics/"
IMG = "https://res.cloudinary.com/democloud/image/upload/v1/sample.jpg"


@contextmanager
def _as_role(role, uid="test-uid"):
    with override_settings(AUTH_DEV_BYPASS=False):
        with patch("core.firebase_auth.ensure_firebase_initialized"):
            decoded = {"uid": uid}
            if role is not None:
                decoded["role"] = role
            with patch("firebase_admin.auth.verify_id_token", return_value=fresh_auth(decoded)):
                yield {"HTTP_AUTHORIZATION": "Bearer test-token"}


def _body(**kwargs):
    data = {"title": "專題標題"}
    data.update(kwargs)
    return data


class Base(TestCase):
    def setUp(self):
        cache.clear()  # 限流計數存在快取，不清會讓後面的測試吃到 429
        self.client = Client()

    def call(self, method, path, payload=None, role=OWNER, uid="test-uid"):
        with _as_role(role, uid) as headers:
            fn = getattr(self.client, method)
            if method == "get" or payload is None:
                return fn(path, **headers)
            return fn(path, data=json.dumps(payload), content_type="application/json", **headers)

    def create(self, role=EDITOR, **kwargs):
        response = self.call("post", ADMIN_URL, _body(**kwargs), role=role)
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()["id"]

    def act(self, pk, action, payload=None, role=OWNER):
        return self.call("post", f"{ADMIN_URL}{pk}/{action}/", payload if payload is not None else {}, role=role)

    def publish(self, **kwargs):
        pk = self.create(**kwargs)
        self.assertEqual(self.act(pk, "submit", role=EDITOR).status_code, 200)
        response = self.act(pk, "approve", {"review_comment": "ok"})
        self.assertEqual(response.status_code, 200, response.content)
        return pk


class ModelValidationTest(TestCase):
    def _topic(self, **kwargs):
        data = {"title": "專題標題", "created_by": "u"}
        data.update(kwargs)
        return FeaturedTopic(**data)

    def test_minimal_and_full_valid(self):
        self._topic().full_clean()
        self._topic(
            summary="字" * 120, image_url=IMG, link_url="/news", category_label="字" * 12, sort_order=99,
        ).full_clean()

    def test_title_limits(self):
        self._topic(title="字" * 40).full_clean()
        for title in ("", "   ", "　", "字" * 41, "兩行\n文字", "含​零寬", "前‮後"):
            with self.subTest(title=title[:8]):
                with self.assertRaises(ValidationError):
                    self._topic(title=title).full_clean()

    def test_other_text_limits(self):
        for kwargs in (
            {"summary": "字" * 121}, {"summary": "兩行\n文字"},
            {"category_label": "字" * 13}, {"category_label": "兩行\n文字"},
            {"sort_order": 100}, {"sort_order": -1},
        ):
            with self.subTest(**kwargs):
                with self.assertRaises(ValidationError):
                    self._topic(**kwargs).full_clean()

    def test_image_url_only_accepts_cloudinary_https(self):
        bad = [
            "http://res.cloudinary.com/democloud/a.jpg",
            "https://example.com/a.jpg",
            "https://res.cloudinary.com.evil.example/a.jpg",
            "https://evil.example/res.cloudinary.com/a.jpg",
            "https://res.cloudinary.com@evil.example/a.jpg",
            "https://user:pw@res.cloudinary.com/a.jpg",
            "https://res.cloudinary.com:8443/a.jpg",
            "https://res.cloudinary.com\\@evil.example/a.jpg",
            "https://res.cloudinary.com/a b.jpg",
            "https://res.cloudinary.com/a.jpg\n",
            "javascript:alert(1)",
            "//res.cloudinary.com/a.jpg",
            "data:image/png;base64,AAAA",
            "https://RES.cloudinary.com.evil.example/a.jpg",
        ]
        for value in bad:
            with self.subTest(value=value):
                with self.assertRaises(ValidationError):
                    self._topic(image_url=value).full_clean()

    def test_image_url_cloud_name_restriction_only_when_configured(self):
        with patch.dict(os.environ, {"CLOUDINARY_CLOUD_NAME": "mycloud"}):
            self._topic(image_url="https://res.cloudinary.com/mycloud/image/upload/a.jpg").full_clean()
            with self.assertRaises(ValidationError):
                self._topic(image_url=IMG).full_clean()
        with patch.dict(os.environ, {"CLOUDINARY_CLOUD_NAME": ""}):
            self._topic(image_url=IMG).full_clean()

    def test_image_url_path_traversal_and_encoded_tricks_are_rejected(self):
        base = "https://res.cloudinary.com"
        bad = [
            base + "/mycloud/../othercloud/a.jpg",
            base + "/mycloud/%2e%2e/othercloud/a.jpg",
            base + "/mycloud/%2E%2E/othercloud/a.jpg",
            base + "/mycloud/a/./b.jpg",
            base + "/mycloud/a%5cb.jpg",
            base + "/mycloud/a%00b.jpg",
            base + "/mycloud/a%0ab.jpg",
        ]
        with patch.dict(os.environ, {"CLOUDINARY_CLOUD_NAME": "mycloud"}):
            for value in bad:
                with self.subTest(value=value):
                    with self.assertRaises(ValidationError):
                        self._topic(image_url=value).full_clean()
        # 沒設帳號名稱時，穿越寫法同樣不能通過
        with patch.dict(os.environ, {"CLOUDINARY_CLOUD_NAME": ""}):
            with self.assertRaises(ValidationError):
                self._topic(image_url=base + "/a/../b.jpg").full_clean()

    def test_malformed_urls_raise_validation_error_not_value_error(self):
        for field, value in (
            ("image_url", "https://[::1/a.jpg"), ("image_url", "https://res.cloudinary.com:abc/a.jpg"),
            ("link_url", "https://[::1/x"), ("link_url", "https://example.com:99999/x"),
        ):
            with self.subTest(field=field, value=value):
                with self.assertRaises(ValidationError):
                    self._topic(**{field: value}).full_clean()

    def test_default_port_and_trailing_dot_behavior(self):
        self._topic(image_url="https://res.cloudinary.com:443/democloud/a.jpg").full_clean()
        # 結尾點是不同的主機名稱字串，白名單不放行
        with self.assertRaises(ValidationError):
            self._topic(image_url="https://res.cloudinary.com./democloud/a.jpg").full_clean()

    def test_link_url_rules(self):
        for ok in ("", "/news", "/a/b?x=1#y", "https://example.com/page"):
            with self.subTest(value=ok):
                self._topic(link_url=ok).full_clean()
        bad = [
            "//evil.example", "/\\evil.example", "\\\\evil.example", "http://example.com",
            "javascript:alert(1)", "data:text/html,x", "https://", "https:///x",
            "/a b", "/a\nb", "/a​b", "mailto:a@b.c", "news",
            "/%09/evil.example", "/%5cevil.example", "/%00", "/%0d%0aSet-Cookie:x",
            "https://user:pw@example.com/", "https://example.com:99999/x", "https://[::1/x",
        ]
        for value in bad:
            with self.subTest(value=value):
                with self.assertRaises(ValidationError):
                    self._topic(link_url=value).full_clean()


class CrudAndRolesTest(Base):
    def test_create_defaults_to_draft_and_ignores_status_and_review_fields(self):
        response = self.call("post", ADMIN_URL, _body(
            status="published", reviewed_by="x", review_comment="x", created_by="x", submitted_by="x",
        ), role=EDITOR, uid="editor-1")
        self.assertEqual(response.status_code, 201)
        data = response.json()
        self.assertEqual(data["status"], "draft")
        self.assertEqual(data["created_by"], "editor-1")
        self.assertEqual(data["reviewed_by"], "")
        self.assertEqual(data["review_comment"], "")
        self.assertEqual(data["submitted_by"], "")

    def test_roles_for_writing(self):
        for role in (OWNER, ADMIN, EDITOR):
            self.assertEqual(self.call("post", ADMIN_URL, _body(), role=role).status_code, 201)
        for role in (REVIEWER, ANALYST, None):
            self.assertIn(self.call("post", ADMIN_URL, _body(), role=role).status_code, (401, 403))
        self.assertEqual(FeaturedTopic.objects.count(), 3)

    def test_staff_can_list_and_get(self):
        pk = self.create()
        for role in (OWNER, EDITOR, REVIEWER, ANALYST):
            self.assertEqual(self.call("get", ADMIN_URL, role=role).status_code, 200)
            self.assertEqual(self.call("get", f"{ADMIN_URL}{pk}/", role=role).status_code, 200)
        self.assertIn(self.call("get", ADMIN_URL, role=None).status_code, (401, 403))

    def test_list_is_ordered_by_sort_order_then_id_and_filterable(self):
        a = self.create(title="甲", sort_order=5)
        b = self.create(title="乙", sort_order=1)
        c = self.create(title="丙", sort_order=1)
        ids = [r["id"] for r in self.call("get", ADMIN_URL).json()["results"]]
        self.assertEqual(ids, [b, c, a])
        self.act(a, "submit", role=EDITOR)
        only = self.call("get", ADMIN_URL + "?status=pending_review").json()["results"]
        self.assertEqual([r["id"] for r in only], [a])

    def test_invalid_create_is_400_with_field_errors(self):
        cases = {
            "title": ["", "   ", "字" * 41],
            "image_url": ["https://example.com/a.jpg"],
            "link_url": ["javascript:alert(1)", "//evil.example"],
            "sort_order": [100, -1, "x"],
            "summary": ["字" * 121],
            "category_label": ["字" * 13],
        }
        for field, values in cases.items():
            for value in values:
                with self.subTest(field=field, value=value):
                    response = self.call("post", ADMIN_URL, _body(**{field: value}), role=EDITOR)
                    self.assertEqual(response.status_code, 400)
                    self.assertIn(field, response.json()["errors"])
        self.assertEqual(FeaturedTopic.objects.count(), 0)

    def test_patch_draft_and_audit_log(self):
        pk = self.create(title="舊")
        response = self.call("patch", f"{ADMIN_URL}{pk}/", {"title": "新", "sort_order": 3}, role=EDITOR)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["title"], "新")
        log = AuditLog.objects.filter(target_type="featured_topic", action="update").latest("pk")
        self.assertEqual(log.before["title"], "舊")
        self.assertEqual(log.after["title"], "新")

    def test_patch_cannot_change_status(self):
        pk = self.create()
        self.call("patch", f"{ADMIN_URL}{pk}/", {"status": "published"}, role=EDITOR)
        self.assertEqual(FeaturedTopic.objects.get(pk=pk).status, "draft")

    def test_patch_pending_or_published_is_409(self):
        pk = self.create()
        self.act(pk, "submit", role=EDITOR)
        self.assertEqual(self.call("patch", f"{ADMIN_URL}{pk}/", {"title": "x"}, role=EDITOR).status_code, 409)
        self.act(pk, "approve", {"review_comment": "ok"})
        self.assertEqual(self.call("patch", f"{ADMIN_URL}{pk}/", {"title": "x"}, role=EDITOR).status_code, 409)

    def test_patch_unpublished_returns_to_draft(self):
        pk = self.publish()
        self.act(pk, "unpublish")
        response = self.call("patch", f"{ADMIN_URL}{pk}/", {"title": "改過"}, role=EDITOR)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "draft")
        self.assertNotIn(pk, [i["id"] for i in self.client.get(PUBLIC_URL).json()["items"]])

    def test_unknown_topic_is_404(self):
        self.assertEqual(self.call("get", f"{ADMIN_URL}9999/").status_code, 404)
        self.assertEqual(self.act(9999, "approve", {"review_comment": "x"}).status_code, 404)


class WorkflowTest(Base):
    def test_full_lifecycle_and_roles(self):
        pk = self.create()
        self.assertEqual(self.act(pk, "approve", {"review_comment": "x"}).status_code, 409)  # 草稿不能核准
        self.assertEqual(self.act(pk, "submit", role=EDITOR).status_code, 200)
        topic = FeaturedTopic.objects.get(pk=pk)
        self.assertEqual((topic.status, topic.submitted_by), ("pending_review", "test-uid"))
        self.assertIsNotNone(topic.submitted_at)

        # editor 不能核准、退件、下架
        self.assertEqual(self.act(pk, "approve", {"review_comment": "x"}, role=EDITOR).status_code, 403)
        self.assertEqual(self.act(pk, "reject", {"review_comment": "x"}, role=EDITOR).status_code, 403)

        # 撤回後可再送審
        self.assertEqual(self.act(pk, "withdraw", role=EDITOR).status_code, 200)
        self.assertEqual(FeaturedTopic.objects.get(pk=pk).status, "draft")
        self.act(pk, "submit", role=EDITOR)

        # 退件必須附理由
        self.assertEqual(self.act(pk, "reject", {"review_comment": "  "}).status_code, 400)
        response = self.act(pk, "reject", {"review_comment": "圖片太小"}, role=ADMIN)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "rejected")
        self.assertEqual(response.json()["review_comment"], "圖片太小")

        # 退件後可直接再次送審，核准
        self.act(pk, "submit", role=EDITOR)
        response = self.act(pk, "approve", {"review_comment": "可以"}, role=ADMIN, )
        self.assertEqual(response.json()["status"], "published")
        self.assertEqual(FeaturedTopic.objects.get(pk=pk).reviewed_by, "test-uid")

        # 下架與重新發布
        self.assertEqual(self.act(pk, "republish").status_code, 409)  # 已發布不能重新發布
        self.assertEqual(self.act(pk, "unpublish").json()["status"], "unpublished")
        self.assertEqual(self.act(pk, "unpublish").status_code, 409)
        self.assertEqual(self.act(pk, "republish", role=EDITOR).status_code, 403)
        self.assertEqual(self.act(pk, "republish").json()["status"], "published")

        actions = list(AuditLog.objects.filter(target_type="featured_topic", target_id=str(pk))
                       .order_by("pk").values_list("action", flat=True))
        self.assertEqual(actions, [
            "create", "submit", "withdraw", "submit", "reject", "submit", "approve", "unpublish", "republish",
        ])

    def test_withdraw_requires_pending(self):
        pk = self.create()
        self.assertEqual(self.act(pk, "withdraw", role=EDITOR).status_code, 409)

    def test_cannot_submit_twice(self):
        pk = self.create()
        self.act(pk, "submit", role=EDITOR)
        self.assertEqual(self.act(pk, "submit", role=EDITOR).status_code, 409)

    def test_approve_does_not_change_content(self):
        pk = self.create(title="原標題", summary="原摘要", image_url=IMG, link_url="/x", sort_order=2)
        self.act(pk, "submit", role=EDITOR)
        self.act(pk, "approve", {"review_comment": "ok"})
        topic = FeaturedTopic.objects.get(pk=pk)
        self.assertEqual((topic.title, topic.summary, topic.image_url, topic.link_url, topic.sort_order),
                         ("原標題", "原摘要", IMG, "/x", 2))


class PublishLimitTest(Base):
    def test_fourth_published_topic_is_rejected_with_names(self):
        pks = [self.publish(title=f"專題{i}", sort_order=i) for i in range(3)]
        pk = self.create(title="第四個")
        self.act(pk, "submit", role=EDITOR)
        response = self.act(pk, "approve", {"review_comment": "ok"})
        self.assertEqual(response.status_code, 409)
        detail = response.json()["detail"]
        self.assertIn("3", detail)
        for i in range(3):
            self.assertIn(f"專題{i}", detail)
        self.assertEqual(FeaturedTopic.objects.get(pk=pk).status, "pending_review")
        self.assertEqual(FeaturedTopic.live.filter(status="published").count(), 3)

        # 下架其中一筆就可以核准
        self.act(pks[0], "unpublish")
        self.assertEqual(self.act(pk, "approve", {"review_comment": "ok"}).status_code, 200)

    def test_republish_also_respects_the_limit(self):
        first = self.publish(title="一")
        self.act(first, "unpublish")
        for i in range(3):
            self.publish(title=f"其他{i}")
        self.assertEqual(self.act(first, "republish").status_code, 409)
        self.assertEqual(FeaturedTopic.objects.get(pk=first).status, "unpublished")

    def test_count_excludes_the_topic_itself(self):
        # 已有 2 筆發布，第 3 筆核准應成功；若把自己算進去或多算就會誤擋
        self.publish(title="一")
        self.publish(title="二")
        self.publish(title="三")
        self.assertEqual(FeaturedTopic.live.filter(status="published").count(), 3)

    def test_soft_deleted_and_non_published_do_not_count(self):
        for i in range(2):
            self.publish(title=f"專題{i}")
        draft = self.create(title="草稿")
        self.act(draft, "submit", role=EDITOR)  # 待審核不算
        self.create(title="另一個草稿")
        extra = self.publish(title="第三個")
        self.assertEqual(FeaturedTopic.live.filter(status="published").count(), 3)
        # 下架後軟刪，再核准待審的那筆應成功
        self.act(extra, "unpublish")
        self.assertEqual(self.call("delete", f"{ADMIN_URL}{extra}/").status_code, 200)
        self.assertEqual(self.act(draft, "approve", {"review_comment": "ok"}).status_code, 200)

    def test_service_locks_homepage_config_before_topic(self):
        # 單例列必須先被鎖：確認服務函式會建立單例列並走到鎖（SQLite 下不報錯即可）
        HomepageConfig.objects.all().delete()
        pk = self.create()
        self.act(pk, "submit", role=EDITOR)
        self.assertEqual(self.act(pk, "approve", {"review_comment": "ok"}).status_code, 200)
        self.assertTrue(HomepageConfig.objects.filter(pk=1).exists())

    def test_publish_revalidates_stale_content(self):
        pk = self.create(image_url=IMG)
        self.act(pk, "submit", role=EDITOR)
        # 送審之後驗證規則變嚴（設定了不同的 Cloudinary 帳號名稱）：不能讓過期內容上線
        with patch.dict(os.environ, {"CLOUDINARY_CLOUD_NAME": "othercloud"}):
            response = self.act(pk, "approve", {"review_comment": "ok"})
        self.assertEqual(response.status_code, 409)
        self.assertIn("image_url", response.json()["errors"])
        self.assertEqual(FeaturedTopic.objects.get(pk=pk).status, "pending_review")

    def test_count_excludes_the_topic_itself_at_the_service_level(self):
        # 核准與重新發布流程中，目標專題本來就不在已發布集合裡，所以「排除自己」在 API 層碰不到；
        # 直接以服務函式驗證這個不變式：已有 3 筆發布時，對其中一筆再呼叫不能因為把自己算進去而被擋。
        from django.db import transaction
        pks = [self.publish(title=f"專題{i}") for i in range(3)]
        with transaction.atomic():
            topic, _ = featured_topic_service.publish_topic(
                pks[0], expected_status=FeaturedTopic.STATUS_PUBLISHED, actor_uid="u")
        self.assertEqual(topic.pk, pks[0])
        self.assertEqual(FeaturedTopic.live.filter(status="published").count(), 3)

    def test_publishing_requires_an_actor(self):
        from django.db import transaction
        pk = self.create()
        self.act(pk, "submit", role=EDITOR)
        for actor in ("", None):
            with self.assertRaises(ValueError):
                with transaction.atomic():
                    featured_topic_service.publish_topic(
                        pk, expected_status=FeaturedTopic.STATUS_PENDING_REVIEW, actor_uid=actor)
        self.assertEqual(FeaturedTopic.objects.get(pk=pk).status, "pending_review")

    def test_model_is_not_registered_in_django_admin(self):
        # 「轉為已發布」只有服務函式一條路徑；Django admin 若註冊，就能繞過上限直接改 status
        from django.contrib import admin
        self.assertFalse(admin.site.is_registered(FeaturedTopic))

    def test_unexpected_status_never_publishes(self):
        pk = self.create()
        with self.assertRaises(featured_topic_service.InvalidState):
            from django.db import transaction
            with transaction.atomic():
                featured_topic_service.publish_topic(
                    pk, expected_status=FeaturedTopic.STATUS_PENDING_REVIEW, actor_uid="u")
        self.assertEqual(FeaturedTopic.objects.get(pk=pk).status, "draft")


class DeleteTest(Base):
    def test_never_submitted_draft_is_hard_deleted(self):
        pk = self.create()
        self.assertEqual(self.call("delete", f"{ADMIN_URL}{pk}/").status_code, 200)
        self.assertFalse(FeaturedTopic.objects.filter(pk=pk).exists())
        self.assertTrue(AuditLog.objects.filter(target_type="featured_topic", action="delete").exists())

    def test_submitted_then_rejected_is_soft_deleted(self):
        pk = self.create()
        self.act(pk, "submit", role=EDITOR)
        self.act(pk, "reject", {"review_comment": "no"})
        self.assertEqual(self.call("delete", f"{ADMIN_URL}{pk}/").status_code, 200)
        topic = FeaturedTopic.objects.get(pk=pk)
        self.assertIsNotNone(topic.deleted_at)
        self.assertEqual(self.call("get", f"{ADMIN_URL}{pk}/").status_code, 404)
        self.assertEqual(self.call("get", ADMIN_URL).json()["count"], 0)
        self.assertEqual(self.call("patch", f"{ADMIN_URL}{pk}/", {"title": "x"}, role=EDITOR).status_code, 404)

    def test_pending_and_published_cannot_be_deleted(self):
        pk = self.create()
        self.act(pk, "submit", role=EDITOR)
        self.assertEqual(self.call("delete", f"{ADMIN_URL}{pk}/").status_code, 409)
        self.act(pk, "approve", {"review_comment": "ok"})
        self.assertEqual(self.call("delete", f"{ADMIN_URL}{pk}/").status_code, 409)

    def test_only_publishers_can_delete(self):
        pk = self.create()
        self.assertEqual(self.call("delete", f"{ADMIN_URL}{pk}/", role=EDITOR).status_code, 403)

    def test_deleted_topic_cannot_be_approved_or_published(self):
        pk = self.publish()
        self.act(pk, "unpublish")
        self.call("delete", f"{ADMIN_URL}{pk}/")
        self.assertEqual(self.act(pk, "republish").status_code, 404)

    def test_soft_delete_audit_keeps_id_title_and_actor(self):
        pk = self.create(title="要刪的專題")
        self.act(pk, "submit", role=EDITOR)
        self.act(pk, "withdraw", role=EDITOR)  # 撤回後回草稿，但 submitted_at 仍有值 -> 軟刪
        self.call("delete", f"{ADMIN_URL}{pk}/", uid="admin-9")
        self.assertTrue(FeaturedTopic.objects.filter(pk=pk).exists())
        log = AuditLog.objects.get(target_type="featured_topic", action="soft_delete")
        self.assertEqual((log.target_id, log.actor_uid), (str(pk), "admin-9"))
        self.assertEqual(log.before["title"], "要刪的專題")
        self.assertEqual(log.after["previous_status"], "draft")

    def test_delete_cancels_orphan_pending_revision(self):
        pk = self.publish()
        PendingRevision.objects.create(
            target_type="featured_topic", target_id=pk, payload={"title": "x"}, submitted_by="u",
        )
        self.act(pk, "unpublish")  # 下架時就取消待審修改
        self.assertFalse(PendingRevision.objects.filter(
            target_type="featured_topic", target_id=pk, status="pending_review").exists())


class RevisionTest(Base):
    def _propose(self, pk, payload, role=EDITOR):
        return self.call("post", f"{ADMIN_URL}{pk}/pending-revision/", payload, role=role)

    def test_edit_published_goes_through_revision_without_unpublishing(self):
        pk = self.publish(title="原標題")
        response = self._propose(pk, {"title": "新標題"})
        self.assertEqual(response.status_code, 201)
        topic = FeaturedTopic.objects.get(pk=pk)
        self.assertEqual((topic.title, topic.status), ("原標題", "published"))
        self.assertEqual(self.client.get(PUBLIC_URL).json()["items"][0]["title"], "原標題")

        response = self.call("post", f"{ADMIN_URL}{pk}/pending-revision/approve/", {"review_comment": "ok"})
        self.assertEqual(response.status_code, 200)
        topic.refresh_from_db()
        self.assertEqual((topic.title, topic.status), ("新標題", "published"))
        self.assertEqual(self.client.get(PUBLIC_URL).json()["items"][0]["title"], "新標題")

    def test_revision_validation_and_editor_cannot_approve(self):
        pk = self.publish()
        self.assertEqual(self._propose(pk, {"image_url": "https://example.com/a.jpg"}).status_code, 400)
        self.assertEqual(self._propose(pk, {"title": "新"}).status_code, 201)
        approve = f"{ADMIN_URL}{pk}/pending-revision/approve/"
        self.assertEqual(self.call("post", approve, {}, role=EDITOR).status_code, 403)

    def test_revision_payload_cannot_carry_status_or_review_fields(self):
        pk = self.publish()
        self._propose(pk, {"title": "新", "status": "draft", "reviewed_by": "x", "created_by": "x"})
        payload = PendingRevision.objects.get(target_type="featured_topic", target_id=pk).payload
        self.assertEqual(set(payload), {"title"})
        self.call("post", f"{ADMIN_URL}{pk}/pending-revision/approve/", {})
        topic = FeaturedTopic.objects.get(pk=pk)
        self.assertEqual((topic.status, topic.reviewed_by), ("published", "test-uid"))
        self.assertNotEqual(topic.created_by, "x")

    def test_stale_revision_is_revalidated_at_approval(self):
        pk = self.publish()
        self._propose(pk, {"image_url": IMG})
        with patch.dict(os.environ, {"CLOUDINARY_CLOUD_NAME": "othercloud"}):
            with self.assertRaises(ValidationError):
                self.call("post", f"{ADMIN_URL}{pk}/pending-revision/approve/", {})
        self.assertEqual(FeaturedTopic.objects.get(pk=pk).image_url, "")

    def test_revision_reject_leaves_content_alone(self):
        pk = self.publish(title="原標題")
        self._propose(pk, {"title": "新標題"})
        response = self.call("post", f"{ADMIN_URL}{pk}/pending-revision/reject/", {"review_comment": "不行"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(FeaturedTopic.objects.get(pk=pk).title, "原標題")

    def test_cannot_propose_revision_for_unpublished_content(self):
        pk = self.create()
        self.assertEqual(self._propose(pk, {"title": "x"}).status_code, 409)

    def test_list_flags_pending_revision(self):
        pk = self.publish()
        self._propose(pk, {"title": "新"})
        row = self.call("get", ADMIN_URL).json()["results"][0]
        self.assertTrue(row["has_pending_revision"])


class ReviewQueueTest(Base):
    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_pending_topics_and_revisions_appear_in_the_review_queue(self, mock_client_fn):
        # 佇列還會聚合 Firestore 的檢舉，這裡不測，回空
        mock_client_fn.return_value.collection.return_value.where.return_value.stream.return_value = []
        pk = self.create(title="待審專題")
        self.act(pk, "submit", role=EDITOR)
        published = self.publish(title="已發布專題")
        self.call("post", f"{ADMIN_URL}{published}/pending-revision/", {"title": "改"}, role=EDITOR)

        with _as_role(OWNER) as headers:
            response = self.client.get("/adminapi/review-queue/?page_size=100", **headers)
        self.assertEqual(response.status_code, 200, response.content)
        items = [i for i in response.json()["results"] if i["content_type"] == "featured_topic"]
        by_type = {i["type"]: i for i in items}
        self.assertEqual(by_type["submission"]["id"], pk)
        self.assertEqual(by_type["submission"]["title"], "待審專題")
        self.assertEqual(by_type["revision"]["id"], published)
        self.assertEqual(by_type["revision"]["title"], "已發布專題")
        self.assertTrue(by_type["submission"]["link"].startswith("/admin/"))


class DeployCheckTest(TestCase):
    def test_warns_when_cloud_name_is_missing_and_is_silent_when_set(self):
        from adminapi.checks import cloudinary_cloud_name_is_set
        with patch.dict(os.environ, {"CLOUDINARY_CLOUD_NAME": ""}):
            result = cloudinary_cloud_name_is_set(None)
        self.assertEqual([w.id for w in result], ["adminapi.W001"])
        with patch.dict(os.environ, {"CLOUDINARY_CLOUD_NAME": "mycloud"}):
            self.assertEqual(cloudinary_cloud_name_is_set(None), [])


class SoftDeletedHiddenTest(Base):
    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_soft_deleted_pending_topic_is_not_in_review_queue(self, mock_client_fn):
        mock_client_fn.return_value.collection.return_value.where.return_value.stream.return_value = []
        FeaturedTopic.objects.create(
            title="殘留待審", created_by="u", status="pending_review",
            submitted_at="2026-01-01T00:00:00Z", deleted_at="2026-01-02T00:00:00Z",
        )
        with _as_role(OWNER) as headers:
            results = self.client.get("/adminapi/review-queue/?page_size=100", **headers).json()["results"]
        self.assertEqual([r for r in results if r["content_type"] == "featured_topic"], [])


class PublicEndpointTest(Base):
    def test_empty_returns_empty_items(self):
        response = self.client.get(PUBLIC_URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"items": []})
        self.assertEqual(response["Cache-Control"], "no-cache")

    def test_only_published_in_order_with_public_fields_only(self):
        c = self.publish(title="丙", sort_order=2, summary="摘要", image_url=IMG, link_url="/x", category_label="類")
        a = self.publish(title="甲", sort_order=1)
        b = self.publish(title="乙", sort_order=1)
        self.create(title="草稿")
        pending = self.create(title="待審")
        self.act(pending, "submit", role=EDITOR)
        items = self.client.get(PUBLIC_URL).json()["items"]
        self.assertEqual([i["id"] for i in items], [a, b, c])
        self.assertEqual(set(items[2]), {"id", "title", "summary", "image_url", "category_label"})
        self.assertEqual(items[2]["image_url"], IMG)
        self.assertEqual(items[0]["summary"], "")  # 空值照實輸出，前台不放示意文字

    def test_same_sort_order_is_ordered_by_id(self):
        ids = [self.publish(title=f"同序{i}", sort_order=7) for i in range(3)]
        self.assertEqual([i["id"] for i in self.client.get(PUBLIC_URL).json()["items"]], ids)

    def test_hard_cap_of_three_even_if_data_is_inconsistent(self):
        for i in range(5):
            FeaturedTopic.objects.create(title=f"專題{i}", created_by="u", status="published", sort_order=i)
        items = self.client.get(PUBLIC_URL).json()["items"]
        self.assertEqual([i["title"] for i in items], ["專題0", "專題1", "專題2"])

    def test_soft_deleted_never_public(self):
        FeaturedTopic.objects.create(title="已刪", created_by="u", status="published", deleted_at="2026-01-01T00:00:00Z")
        self.assertEqual(self.client.get(PUBLIC_URL).json()["items"], [])

    def test_unpublish_removes_immediately_and_republish_restores(self):
        pk = self.publish(title="專題")
        self.assertEqual(len(self.client.get(PUBLIC_URL).json()["items"]), 1)
        self.act(pk, "unpublish")
        self.assertEqual(self.client.get(PUBLIC_URL).json()["items"], [])
        self.act(pk, "republish")
        self.assertEqual(len(self.client.get(PUBLIC_URL).json()["items"]), 1)

    def test_only_get_is_allowed(self):
        self.assertEqual(self.client.post(PUBLIC_URL).status_code, 405)

    def test_does_not_require_login_and_does_not_leak_internal_fields(self):
        self.publish(title="專題")
        text = self.client.get(PUBLIC_URL).content.decode()
        for leaked in ("created_by", "reviewed_by", "review_comment", "status", "submitted"):
            self.assertNotIn(leaked, text)


IMG_OK = "https://res.cloudinary.com/democloud/image/upload/v1/body.jpg"


def _text(value, *marks):
    node = {"type": "text", "text": value}
    if marks:
        node["marks"] = [{"type": m} if isinstance(m, str) else m for m in marks]
    return node


def _doc(*blocks):
    return {"type": "doc", "content": list(blocks)}


def _p(*inline):
    return {"type": "paragraph", "content": list(inline)}


GOOD_DOC = _doc(
    {"type": "heading", "attrs": {"level": 2}, "content": [_text("小標")]},
    _p(_text("第一段，", "bold"), _text("連結", {"type": "link", "attrs": {"href": "https://example.org/x", "target": "_blank", "rel": "noopener noreferrer nofollow", "class": None, "title": None}})),
    {"type": "bulletList", "content": [{"type": "listItem", "content": [_p(_text("項目"))]}]},
    {"type": "blockquote", "content": [_p(_text("引用"))]},
    {"type": "horizontalRule"},
    {"type": "image", "attrs": {"src": IMG_OK, "alt": "替代文字", "title": "圖說"}},
)


class ArticleDocValidationTest(TestCase):
    """富文字內容（TipTap 文件樹）的白名單驗證：只有白名單內的節點、屬性、網址存得進來。"""

    def _topic(self, content):
        return FeaturedTopic(title="專題標題", created_by="u", content=content)

    def assertInvalid(self, content, label=""):
        with self.subTest(label or str(content)[:60]):
            with self.assertRaises(ValidationError):
                self._topic(content).full_clean()

    def test_empty_and_full_valid(self):
        self._topic({}).full_clean()
        self._topic(_doc()).full_clean()
        self._topic(GOOD_DOC).full_clean()

    def test_rejects_non_document_shapes(self):
        for value in ("文字", 3, {"type": "paragraph"}, {"type": "doc", "content": "x"}, {"type": "doc", "content": [3]}):
            self.assertInvalid(value)

    def test_rejects_unknown_nodes_marks_and_attributes(self):
        self.assertInvalid(_doc({"type": "script", "content": []}), "未知節點")
        self.assertInvalid(_doc({"type": "codeBlock", "content": []}), "未開放節點")
        self.assertInvalid(_doc(_p(_text("x", "code"))), "未開放的樣式")
        self.assertInvalid(_doc({"type": "paragraph", "attrs": {"style": "color:red"}}), "段落多出屬性")
        self.assertInvalid(_doc(_p(_text("x", {"type": "link", "attrs": {"href": "/a", "onclick": "x"}}))), "連結多出屬性")

    def test_heading_levels_only_two_to_four(self):
        for level in (1, 5, 6, "2", None):
            self.assertInvalid(_doc({"type": "heading", "attrs": {"level": level}, "content": [_text("x")]}), f"level={level}")
        _ = self._topic(_doc({"type": "heading", "attrs": {"level": 3}, "content": [_text("x")]})).full_clean()

    def test_links_only_internal_paths_and_https(self):
        for href in ("javascript:alert(1)", "http://example.org", "//evil.example", "data:text/html,x", "mailto:a@b.c?subject=x", "", "https://u:p@example.org"):
            self.assertInvalid(_doc(_p(_text("x", {"type": "link", "attrs": {"href": href}}))), href)
        for href in ("/quiz/select", "https://example.org/a?b=1"):
            self._topic(_doc(_p(_text("x", {"type": "link", "attrs": {"href": href}})))).full_clean()

    def test_images_only_cloudinary_https_with_limits(self):
        for src in ("http://res.cloudinary.com/a.jpg", "https://example.com/a.jpg", "data:image/png;base64,AAAA", "javascript:alert(1)", "", None):
            self.assertInvalid(_doc({"type": "image", "attrs": {"src": src}}), str(src))
        self.assertInvalid(_doc({"type": "image", "attrs": {"src": IMG_OK, "alt": "字" * 201}}), "alt 過長")
        self.assertInvalid(_doc({"type": "image", "attrs": {"src": IMG_OK, "title": "字" * 121}}), "圖說過長")
        self.assertInvalid(_doc({"type": "image", "attrs": {"src": IMG_OK, "alt": "兩行\n文字"}}), "alt 換行")
        self.assertInvalid(_doc({"type": "image", "attrs": {"src": IMG_OK, "width": 10}}), "多出屬性")
        too_many = _doc(*[{"type": "image", "attrs": {"src": IMG_OK}} for _ in range(41)])
        self.assertInvalid(too_many, "超過 40 張圖")

    def test_text_rules_control_characters_and_invisible(self):
        for bad in ("含\x00空位元組", "兩行\n文字", "含​零寬", "前‮後"):
            self.assertInvalid(_doc(_p(_text(bad))), repr(bad))

    def test_structure_rules_nesting_depth_and_size(self):
        self.assertInvalid(_doc({"type": "bulletList", "content": [_p(_text("x"))]}), "清單裡直接放段落")
        self.assertInvalid(_doc(_p({"type": "paragraph", "content": []})), "段落裡放段落")
        self.assertInvalid(_doc({"type": "horizontalRule", "content": [_p()]}), "葉節點有子節點")
        deep = _p(_text("x"))
        for _ in range(10):
            deep = {"type": "blockquote", "content": [deep]}
        self.assertInvalid(_doc(deep), "巢狀過深")
        self.assertInvalid(_doc(*[_p(_text("字" * 500)) for _ in range(101)]), "文字超過 50000 字")
        self.assertInvalid(_doc(*[_p() for _ in range(5001)]), "節點過多")

    def test_extremely_deep_nesting_is_rejected_not_a_server_error(self):
        deep = {"type": "paragraph"}
        for _ in range(200):
            deep = {"type": "blockquote", "content": [deep]}
        self.assertInvalid(_doc(deep), "極深巢狀")

    def test_link_default_attributes_are_limited(self):
        for key in ("rel", "class", "title"):
            self.assertInvalid(_doc(_p(_text("x", {"type": "link", "attrs": {"href": "/a", key: "字" * 201}}))), f"{key} 過長")
            self.assertInvalid(_doc(_p(_text("x", {"type": "link", "attrs": {"href": "/a", key: "兩行\n文字"}}))), f"{key} 換行")

    def test_ordered_list_attributes(self):
        item = {"type": "listItem", "content": [_p(_text("x"))]}
        self._topic(_doc({"type": "orderedList", "attrs": {"start": 3}, "content": [item]})).full_clean()
        for attrs in ({"start": 0}, {"start": "3"}, {"start": True}, {"type": "x"}):
            self.assertInvalid(_doc({"type": "orderedList", "attrs": attrs, "content": [item]}), str(attrs))


class ArticleFieldsTest(TestCase):
    """作者／來源、圖說欄位。"""

    def _topic(self, **kwargs):
        data = {"title": "專題標題", "created_by": "u"}
        data.update(kwargs)
        return FeaturedTopic(**data)

    def test_source_and_caption_are_single_line_with_limits(self):
        self._topic(source_label="編輯部", image_caption="圖說").full_clean()
        for kwargs in ({"source_label": "字" * 31}, {"source_label": "兩行\n文字"},
                       {"image_caption": "字" * 81}, {"image_caption": "兩行\n文字"}):
            with self.subTest(**kwargs):
                with self.assertRaises(ValidationError):
                    self._topic(**kwargs).full_clean()


class PublicArticleTest(Base):
    def url(self, pk):
        return f"{PUBLIC_URL}{pk}/"

    def test_published_topic_returns_reading_fields_only(self):
        pk = self.publish(
            title="織紋裡的語言", summary="導言", content=GOOD_DOC, category_label="專題",
            source_label="編輯部", image_url=IMG, image_caption="織布的手",
        )
        response = self.client.get(self.url(pk))
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(set(data), {
            "id", "title", "summary", "image_url", "image_caption", "category_label",
            "source_label", "content", "published_at",
        })
        self.assertEqual(data["content"], GOOD_DOC)
        self.assertRegex(data["published_at"], r"^\d{4}-\d{2}-\d{2}$")
        self.assertEqual(response["Cache-Control"], "no-cache")
        for leaked in ("created_by", "reviewed_by", "review_comment", "submitted", "link_url", "status"):
            self.assertNotIn(leaked, response.content.decode())

    def test_every_published_topic_has_its_own_page_even_without_content(self):
        pk = self.publish(title="只有標題")
        data = self.client.get(self.url(pk)).json()
        self.assertEqual((data["id"], data["title"]), (pk, "只有標題"))
        self.assertEqual(data["content"], {})

    def test_not_published_or_deleted_is_404(self):
        draft = self.create(title="草稿", content=GOOD_DOC)
        pending = self.create(title="待審", content=GOOD_DOC)
        self.act(pending, "submit", role=EDITOR)
        unpublished = self.publish(title="已下架", content=GOOD_DOC)
        self.act(unpublished, "unpublish")
        deleted = FeaturedTopic.objects.create(
            title="已刪", created_by="u", status="published", deleted_at="2026-01-01T00:00:00Z",
        )
        for pk in (draft, pending, unpublished, deleted.pk, 999999):
            with self.subTest(pk=pk):
                self.assertEqual(self.client.get(self.url(pk)).status_code, 404)

    def test_unpublish_then_republish_toggles_article(self):
        pk = self.publish(title="專題", content=GOOD_DOC)
        self.assertEqual(self.client.get(self.url(pk)).status_code, 200)
        self.act(pk, "unpublish")
        self.assertEqual(self.client.get(self.url(pk)).status_code, 404)
        self.act(pk, "republish")
        self.assertEqual(self.client.get(self.url(pk)).status_code, 200)

    def test_article_of_a_fourth_published_topic_stays_readable_while_home_shows_three(self):
        # 資料不一致時（已發布超過 3 筆），已分享出去的文章連結不能因為排序而失效
        topics = [
            FeaturedTopic.objects.create(title=f"專題{i}", created_by="u", status="published", sort_order=i)
            for i in range(5)
        ]
        self.assertEqual(self.client.get(self.url(topics[4].pk)).status_code, 200)
        self.assertEqual(len(self.client.get(PUBLIC_URL).json()["items"]), 3)

    def test_only_get_is_allowed(self):
        pk = self.publish(title="專題")
        self.assertEqual(self.client.post(self.url(pk)).status_code, 405)

    def test_list_does_not_send_article_content(self):
        pk = self.publish(title="有文章", content=GOOD_DOC)
        item = next(i for i in self.client.get(PUBLIC_URL).json()["items"] if i["id"] == pk)
        self.assertNotIn("content", item)
        self.assertNotIn("link_url", item)

    def test_api_rejects_unsafe_content_on_create_and_edit(self):
        bad = _doc(_p(_text("x", {"type": "link", "attrs": {"href": "javascript:alert(1)"}})))
        response = self.call("post", ADMIN_URL, _body(content=bad), role=EDITOR)
        self.assertEqual(response.status_code, 400)
        pk = self.create(title="專題", content=GOOD_DOC)
        response = self.call("patch", f"{ADMIN_URL}{pk}/", {"content": _doc({"type": "script"})}, role=EDITOR)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(FeaturedTopic.objects.get(pk=pk).content, GOOD_DOC)

    def test_editing_published_article_goes_through_revision(self):
        old = _doc(_p(_text("舊內文")))
        new = _doc(_p(_text("新內文")))
        pk = self.publish(title="專題", content=old)
        response = self.call("post", f"{ADMIN_URL}{pk}/pending-revision/", {"content": new, "source_label": "新來源"}, role=EDITOR)
        self.assertIn(response.status_code, (200, 201), response.content)
        self.assertEqual(self.client.get(self.url(pk)).json()["content"], old)
        self.assertEqual(self.call("post", f"{ADMIN_URL}{pk}/pending-revision/approve/", {"review_comment": "ok"}).status_code, 200)
        data = self.client.get(self.url(pk)).json()
        self.assertEqual((data["content"], data["source_label"]), (new, "新來源"))

    def test_revision_with_unsafe_content_is_rejected(self):
        pk = self.publish(title="專題", content=GOOD_DOC)
        bad = _doc({"type": "image", "attrs": {"src": "https://evil.example/a.jpg"}})
        response = self.call("post", f"{ADMIN_URL}{pk}/pending-revision/", {"content": bad}, role=EDITOR)
        self.assertEqual(response.status_code, 400, response.content)


def _cell(*blocks, kind="tableCell", **attrs):
    return {"type": kind, "attrs": {"colspan": 1, "rowspan": 1, "colwidth": None, **attrs}, "content": list(blocks or [_p()])}


def _table(*rows):
    return {"type": "table", "content": [{"type": "tableRow", "content": list(row)} for row in rows]}


class ArticleDocRichFeaturesTest(TestCase):
    """進階排版（對齊、顏色、字級、表格、待辦、提示框、影片、圖片大小）的白名單：只收固定選項，不收任意值。"""

    def assertValid(self, content, label=""):
        with self.subTest(label or "valid"):
            FeaturedTopic(title="專題標題", created_by="u", content=content).full_clean()

    def assertInvalid(self, content, label=""):
        with self.subTest(label or str(content)[:60]):
            with self.assertRaises(ValidationError):
                FeaturedTopic(title="專題標題", created_by="u", content=content).full_clean()

    def test_alignment_and_heading_levels(self):
        for align in ("left", "center", "right", "justify", None):
            self.assertValid(_doc({"type": "paragraph", "attrs": {"textAlign": align}, "content": [_text("x")]}), f"對齊 {align}")
        for level in (2, 3, 4):
            self.assertValid(_doc({"type": "heading", "attrs": {"level": level, "textAlign": "center"}, "content": [_text("x")]}))
        self.assertInvalid(_doc({"type": "heading", "attrs": {"level": 5}, "content": [_text("x")]}), "5 級標題")
        self.assertInvalid(_doc({"type": "heading", "attrs": {"level": 1}, "content": [_text("x")]}), "1 級標題")
        self.assertInvalid(_doc({"type": "paragraph", "attrs": {"textAlign": "start"}, "content": [_text("x")]}), "非清單內對齊")
        self.assertInvalid(_doc({"type": "paragraph", "attrs": {"textAlign": "center; background:url(x)"}, "content": [_text("x")]}), "對齊夾帶 CSS")

    def test_text_style_marks_only_take_fixed_choices(self):
        def mark(kind, **attrs):
            return {"type": kind, "attrs": attrs}

        self.assertValid(_doc(_p(_text("x", mark("textColor", color="red"), mark("highlight", color="yellow"), mark("fontSize", size="lg"), "subscript"))))
        self.assertValid(_doc(_p(_text("x", "superscript", "bold"))))
        self.assertInvalid(_doc(_p(_text("x", mark("textColor", color="#ff0000")))), "色碼")
        self.assertInvalid(_doc(_p(_text("x", mark("textColor", color="red; x:y")))), "夾帶 CSS")
        self.assertInvalid(_doc(_p(_text("x", mark("textColor")))), "沒有顏色")
        self.assertInvalid(_doc(_p(_text("x", mark("highlight", color="red")))), "螢光筆用了文字色")
        self.assertInvalid(_doc(_p(_text("x", mark("fontSize", size="72px")))), "任意字級")
        self.assertInvalid(_doc(_p(_text("x", mark("fontSize", size="sm", style="x")))), "多餘屬性")

    def test_table_structure_and_limits(self):
        self.assertValid(_doc(_table([_cell(kind="tableHeader"), _cell(kind="tableHeader")], [_cell(_p(_text("a"))), _cell(colspan=2)])))
        self.assertInvalid(_doc(_table([_cell(colspan=13)])), "合併過大")
        self.assertInvalid(_doc(_table([_cell(colspan=0)])), "合併為 0")
        self.assertInvalid(_doc(_table([_cell(colwidth=[100])])), "自訂欄寬")
        self.assertInvalid(_doc(_table(*([[_cell()]] * 51))), "超過 50 列")
        self.assertInvalid(_doc(_table([_cell()] * 13)), "超過 12 欄")
        self.assertInvalid(_doc({"type": "table", "content": [_p()]}), "表格裡直接放段落")
        self.assertInvalid(_doc(_table([_cell({"type": "heading", "attrs": {"level": 2}, "content": [_text("x")]})])), "儲存格放標題")
        self.assertInvalid(_doc({"type": "blockquote", "content": [_table([_cell()])]}), "引用裡放表格")

    def test_task_list_and_callout(self):
        item = {"type": "taskItem", "attrs": {"checked": True}, "content": [_p(_text("完成"))]}
        self.assertValid(_doc({"type": "taskList", "content": [item, {**item, "attrs": {"checked": False}}]}))
        self.assertInvalid(_doc({"type": "taskList", "content": [{"type": "taskItem", "attrs": {"checked": "yes"}, "content": [_p()]}]}), "狀態非布林")
        self.assertInvalid(_doc({"type": "taskList", "content": [{"type": "listItem", "content": [_p()]}]}), "待辦裡放一般項目")
        for tone in ("info", "success", "warning", "danger"):
            self.assertValid(_doc({"type": "callout", "attrs": {"tone": tone}, "content": [_p(_text("注意"))]}), tone)
        self.assertInvalid(_doc({"type": "callout", "attrs": {"tone": "pink"}, "content": [_p()]}), "未知種類")
        self.assertInvalid(_doc({"type": "callout", "content": [_p()]}), "沒有種類")
        self.assertInvalid(_doc({"type": "callout", "attrs": {"tone": "info"}, "content": [_table([_cell()])]}), "提示框裡放表格")

    def test_youtube_only_takes_a_video_id(self):
        self.assertValid(_doc({"type": "youtube", "attrs": {"videoId": "dQw4w9WgXcQ", "title": "說明"}}))
        for bad in ("short", "dQw4w9WgXcQ1", "dQw4w9WgXc!", "https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ\n", None, 12345678901):
            self.assertInvalid(_doc({"type": "youtube", "attrs": {"videoId": bad}}), f"代號 {bad!r}")
        self.assertInvalid(_doc({"type": "youtube", "attrs": {"videoId": "dQw4w9WgXcQ", "src": "https://evil"}}), "多餘屬性")
        self.assertInvalid(_doc({"type": "youtube", "attrs": {"videoId": "dQw4w9WgXcQ"}, "content": [_p()]}), "影片有子節點")
        too_many = [{"type": "youtube", "attrs": {"videoId": "dQw4w9WgXcQ"}}] * 11
        self.assertInvalid(_doc(*too_many), "超過 10 支")

    def test_image_alignment_and_size(self):
        base = {"src": IMG_OK, "alt": "", "title": ""}
        self.assertValid(_doc({"type": "image", "attrs": {**base, "align": "center", "size": "md"}}))
        self.assertValid(_doc({"type": "image", "attrs": {**base, "align": None, "size": None}}))
        self.assertInvalid(_doc({"type": "image", "attrs": {**base, "align": "justify"}}), "圖片不能兩端對齊")
        self.assertInvalid(_doc({"type": "image", "attrs": {**base, "size": "500px"}}), "任意大小")

    def test_unhashable_and_loose_values_are_400_not_500(self):
        for bad in ([], {}, ["red"], {"a": 1}, 1, True):
            self.assertInvalid(_doc(_p(_text("x", {"type": "textColor", "attrs": {"color": bad}}))), f"顏色 {bad!r}")
            self.assertInvalid(_doc({"type": "paragraph", "attrs": {"textAlign": bad}, "content": [_text("x")]}), f"對齊 {bad!r}")
            self.assertInvalid(_doc({"type": "callout", "attrs": {"tone": bad}, "content": [_p()]}), f"提示框 {bad!r}")
        for bad in (0, 1, "true", []):
            self.assertInvalid(_doc({"type": "taskList", "content": [{"type": "taskItem", "attrs": {"checked": bad}, "content": [_p()]}]}), f"checked {bad!r}")

    def test_deepest_realistic_table_content_still_fits(self):
        nested = {"type": "bulletList", "content": [{"type": "listItem", "content": [_p(_text("深"))]}]}
        self.assertValid(_doc(_table([_cell(nested)])))
