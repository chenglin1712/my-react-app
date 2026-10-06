"""rebuild_translation_attested_forms 重建完語料詞形表後，要通知 FastAPI 端失效（翻譯詞形分析器、
測驗詞形干擾項都拿這張表建快取，不通知就會一直沿用舊的）。"""
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.test import SimpleTestCase

from config.tribes import TRIBES


class RebuildAttestedFormsNotifiesCacheTest(SimpleTestCase):
    def _run(self, **kwargs):
        with patch("adminapi.management.commands.rebuild_translation_attested_forms.Command._rebuild_one", return_value=3), \
             patch("adminapi.management.commands.rebuild_translation_attested_forms.invalidate_dictionary_cache") as notify:
            call_command("rebuild_translation_attested_forms", stdout=StringIO(), **kwargs)
        return notify

    def test_single_tribe_rebuild_notifies_only_that_tribe_with_the_words_scope(self):
        notify = self._run(tribe="tayal")
        notify.assert_called_once_with(["words"], tribes=["tayal"])

    def test_full_rebuild_notifies_every_tribe(self):
        notify = self._run()
        notify.assert_called_once_with(["words"], tribes=[t.slug for t in TRIBES])
