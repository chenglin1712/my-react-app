"""WP-8 稽核：審核清單端點依 id 篩選（稽核 FE7b-07）。"""
from unittest.mock import patch

from django.test import Client, TestCase

from config.roles import OWNER

from .test_moderation import FakeCollection, _as_role, _build_client, _fake_snapshot


class NoteListIdFilterTest(TestCase):
    def setUp(self):
        self.client = Client()

    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_id_param_returns_only_that_note(self, mock_client_fn):
        notes = FakeCollection(docs=[
            _fake_snapshot("note1", {"preview": "a", "username": "A"}),
            _fake_snapshot("note2", {"preview": "b", "username": "B"}),
        ])
        mock_client_fn.return_value = _build_client(
            collections={"sharedNotes": notes, "reports": FakeCollection(docs=[])},
        )

        with _as_role(OWNER) as headers:
            resp = self.client.get('/adminapi/moderation/notes/?id=note2', **headers)
        data = resp.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["id"], "note2")

    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_unknown_id_returns_empty_list(self, mock_client_fn):
        notes = FakeCollection(docs=[_fake_snapshot("note1", {"preview": "a"})])
        mock_client_fn.return_value = _build_client(
            collections={"sharedNotes": notes, "reports": FakeCollection(docs=[])},
        )

        with _as_role(OWNER) as headers:
            resp = self.client.get('/adminapi/moderation/notes/?id=nope', **headers)
        self.assertEqual(resp.json()["count"], 0)


class RecordingListIdFilterTest(TestCase):
    def setUp(self):
        self.client = Client()

    @patch("adminapi.firebase_ops.get_firestore_client")
    def test_id_plus_tribe_disambiguates_same_id(self, mock_client_fn):
        recordings = FakeCollection(docs=[
            _fake_snapshot("rec1", {"word": "abas"}, path="pronunciations/tayal/recordings/rec1"),
            _fake_snapshot("rec1", {"word": "kolong"}, path="pronunciations/amis/recordings/rec1"),
            _fake_snapshot("rec2", {"word": "x"}, path="pronunciations/amis/recordings/rec2"),
        ])
        mock_client_fn.return_value = _build_client(
            collections={"reports": FakeCollection(docs=[])}, groups={"recordings": recordings},
        )

        with _as_role(OWNER) as headers:
            resp = self.client.get('/adminapi/moderation/recordings/?id=rec1&tribe=amis', **headers)
        data = resp.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["results"][0]["tribe"], "amis")
        self.assertEqual(data["results"][0]["word"], "kolong")

        with _as_role(OWNER) as headers:
            resp = self.client.get('/adminapi/moderation/recordings/?id=rec1', **headers)
        self.assertEqual(resp.json()["count"], 2)
