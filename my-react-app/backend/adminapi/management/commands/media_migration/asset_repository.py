"""media_asset 表的狀態機讀寫。跟 fetcher.py（怎麼把 bytes 抓回來）、
storage.py（上傳後怎麼驗證）是不同關注點，這裡只管「一個 (provider, kind,
locator) 現在該不該被處理、處理完了怎麼記錄結果」。

設計成 asset-level checkpoint 的粗粒度狀態機（不做 byte-range 續傳，這批
檔案平均只有幾十 KB～1MB，做續傳不划算；也不細分 downloading/downloaded/
uploading/uploaded 這幾個中間態，crash 後一律從頭重新下載+上傳，object
path 是內容 SHA-256，重傳頂多是覆寫同一個 path，不會產生垃圾物件）：
    DOWNLOADING -> VERIFIED
                \-> FAILED_RETRYABLE / FAILED_TERMINAL
"""
from datetime import datetime, timedelta

from sqlalchemy.exc import IntegrityError

from dictionary_db.connect import SessionLocal, dictionary_write_session
from dictionary_db.model import (
    MediaAsset,
    Word,
    WordAudio,
    WordExplanation,
    WordExplanationImage,
    WordExplanationSentence,
    WordExplanationSentenceAudio,
)


class AssetStatus:
    """media_asset.status 的合法值——原本是裸字串常數散落在檔案各處
    （P4 review BE-15），集中成有名字的常數後，打錯字（例如寫成
    "verifed"）在 import 當下就能被 IDE/linter 抓到，不必等到跑起來才發現
    篩選/比對永遠不會命中任何列。"""
    DOWNLOADING = "downloading"
    UPLOADING = "uploading"
    VERIFIED = "verified"
    FAILED_RETRYABLE = "failed_retryable"
    FAILED_TERMINAL = "failed_terminal"


_MAX_DB_ATTEMPTS = 5
_STALE_AFTER = timedelta(minutes=10)
_IN_PROGRESS_STATUSES = (AssetStatus.DOWNLOADING, AssetStatus.UPLOADING)


def _maybe_link_all(db, owning_table, owning_ids, asset_id):
    if owning_table is None:
        return
    for owning_id in owning_ids:
        owning_row = db.get(owning_table, owning_id)
        if owning_row is not None and owning_row.media_asset_id != asset_id:
            owning_row.media_asset_id = asset_id


def _claim_or_link_asset(source_provider, source_kind, source_locator, retry_failed, owning_table, owning_ids):
    """短交易：決定這個 locator 現在該不該被處理。

    回傳 (action, asset_id)：
      "process" —— 需要真的下載/上傳，呼叫端接著要跑網路流程
      "linked"  —— media_asset 早已 verified，這裡已經把 owning_ids 接上 FK，
                    不需要網路
      "skip"    —— 真的什麼都不用做（terminal 失敗、或還在冷卻期、或有其他
                    worker 正在處理且還沒卡住超過 staleness 門檻）

    只有 asset 已經是 verified 的分支才呼叫 _maybe_link_all()，回傳
    "process" 的兩個分支刻意不接 FK：曾經踩過的坑是，如果 claim 當下就把
    owning row 的 media_asset_id 接上去，不管最後下載/上傳成不成功，
    _list_candidates() 的 `media_asset_id IS NULL` 篩選條件會把這筆永遠
    排除在候選之外——下載失敗的項目會從此消失，連 --retry-failed 都救不
    回來，因為它根本不會再被列出來重試。FK 只在 _finalize_asset_success()
    真正確認驗證通過後才寫入（見該函式），media_asset_id 的語意就是「已驗證
    可用的副本」，不是「曾經嘗試過」。

    新增列時用 SAVEPOINT（begin_nested）包住：同一個 locator 可能同時被
    多個候選觸發（word_audio／sentence_audio 共用 kind 之後尤其常見、
    explanation_image 本身就有 136 筆重複 URL），先查無再 INSERT 在併發下
    會撞 (source_provider, source_kind, source_locator) 的 unique constraint
    丟 IntegrityError；不用 SAVEPOINT 接住的話，這個例外會讓外層整個
    session／transaction 進入 aborted 狀態，之後任何操作都會失敗。
    """
    now = datetime.utcnow()
    with dictionary_write_session() as db:
        row = (
            db.query(MediaAsset)
            .filter_by(source_provider=source_provider, source_kind=source_kind, source_locator=source_locator)
            .with_for_update()
            .first()
        )
        if row is None:
            nested = db.begin_nested()
            try:
                row = MediaAsset(
                    source_provider=source_provider, source_kind=source_kind, source_locator=source_locator,
                    status=AssetStatus.DOWNLOADING, attempt_count=0, updated_at=now,
                )
                db.add(row)
                db.flush()
            except IntegrityError:
                nested.rollback()
                row = (
                    db.query(MediaAsset)
                    .filter_by(source_provider=source_provider, source_kind=source_kind, source_locator=source_locator)
                    .with_for_update()
                    .first()
                )
                if row is None:
                    raise
            else:
                nested.commit()
                return "process", row.id

        asset_id = row.id
        if row.status == AssetStatus.VERIFIED:
            _maybe_link_all(db, owning_table, owning_ids, asset_id)
            return "linked", asset_id
        if row.status == AssetStatus.FAILED_TERMINAL:
            return "skip", asset_id
        if row.status in _IN_PROGRESS_STATUSES and row.updated_at and (now - row.updated_at) < _STALE_AFTER:
            return "skip", asset_id
        if row.status == AssetStatus.FAILED_RETRYABLE and not retry_failed:
            if row.next_retry_at and row.next_retry_at > now:
                return "skip", asset_id

        row.status = AssetStatus.DOWNLOADING
        row.updated_at = now
        return "process", asset_id


def _finalize_asset_success(asset_id, *, storage_bucket, storage_path, public_url,
                             content_type, byte_size, sha256_hex, owning_table, owning_ids):
    """回傳 True 代表真的寫入 verified；False 代表被狀態守衛擋下（asset 不存在，
    或狀態已經不是 downloading/uploading）——呼叫端要檢查這個回傳值，不能
    假設呼叫沒丟例外就等於真的寫進 verified，兩者在這支函式裡是分開的概念。"""
    now = datetime.utcnow()
    with dictionary_write_session() as db:
        asset = db.query(MediaAsset).filter_by(id=asset_id).with_for_update().first()
        if asset is None or asset.status not in _IN_PROGRESS_STATUSES:
            # 操作假設是同一時間只跑一個 process，正常不會走到這裡；這是防禦
            # 最壞情況（真的重疊跑了兩個 process）——寧可讓這次上傳變成
            # Storage 裡的孤兒物件（object path 是內容 hash，之後重跑要嘛
            # 自然去重、要嘛不影響任何人），也不要讓較舊的呼叫蓋掉已經記錄的
            # 較新結果。
            return False
        asset.status = AssetStatus.VERIFIED
        asset.storage_provider = "firebase"
        asset.storage_bucket = storage_bucket
        asset.storage_path = storage_path
        asset.public_url = public_url
        asset.content_type = content_type
        asset.byte_size = byte_size
        asset.sha256 = sha256_hex
        asset.last_error = None
        asset.migrated_at = now
        asset.verified_at = now
        asset.updated_at = now
        _maybe_link_all(db, owning_table, owning_ids, asset_id)
        return True


def _finalize_asset_failure(asset_id, *, terminal, error_message):
    now = datetime.utcnow()
    with dictionary_write_session() as db:
        asset = db.query(MediaAsset).filter_by(id=asset_id).with_for_update().first()
        if asset is None or asset.status not in _IN_PROGRESS_STATUSES:
            return
        asset.attempt_count = (asset.attempt_count or 0) + 1
        asset.last_error = error_message[:2000]
        asset.updated_at = now
        if terminal or asset.attempt_count >= _MAX_DB_ATTEMPTS:
            asset.status = AssetStatus.FAILED_TERMINAL
            asset.next_retry_at = None
        else:
            asset.status = AssetStatus.FAILED_RETRYABLE
            backoff_seconds = min(60 * (2 ** asset.attempt_count), 3600)
            asset.next_retry_at = now + timedelta(seconds=backoff_seconds)


def _list_candidates(source_kind, tribe_id, limit):
    """回傳 [{"locator": ..., "row_ids": [id, ...]}, ...]，同一個 locator 被
    多筆來源列引用時合併成一筆（見模組檔頭說明）。row_ids 是來源表
    （word_audio 等）自己的 PK 清單，給遷移成功後回填 media_asset_id 用；
    word_img 沒有獨立的 FK 欄位（words 表不能加欄位，理由見 migration
    檔頭），row_ids 一律是空 list。

    limit 是「最多處理幾個不重複的媒體物件」，不是「最多幾筆來源列」——
    groupby 之後才切 limit，pilot 測試時比較符合直覺（--limit 50 就是真的
    會嘗試下載 50 個不同的檔案，不會因為重複 URL 而少於預期）。"""
    db = SessionLocal()
    try:
        if source_kind == "word_audio":
            q = (
                db.query(WordAudio.id, WordAudio.file_id)
                .join(Word, Word.id == WordAudio.word_id)
                .filter(WordAudio.media_asset_id.is_(None), WordAudio.file_id.isnot(None), WordAudio.file_id != "")
            )
            if tribe_id:
                q = q.filter(Word.tribe_id == tribe_id)
            pairs = [(r.id, r.file_id) for r in q.all()]

        elif source_kind == "sentence_audio":
            q = (
                db.query(WordExplanationSentenceAudio.id, WordExplanationSentenceAudio.file_id)
                .join(WordExplanationSentence, WordExplanationSentence.id == WordExplanationSentenceAudio.sentence_id)
                .join(WordExplanation, WordExplanation.id == WordExplanationSentence.explanation_id)
                .join(Word, Word.id == WordExplanation.word_id)
                .filter(
                    WordExplanationSentenceAudio.media_asset_id.is_(None),
                    WordExplanationSentenceAudio.file_id.isnot(None),
                    WordExplanationSentenceAudio.file_id != "",
                )
            )
            if tribe_id:
                q = q.filter(Word.tribe_id == tribe_id)
            pairs = [(r.id, r.file_id) for r in q.all()]

        elif source_kind == "explanation_image":
            q = (
                db.query(WordExplanationImage.id, WordExplanationImage.image_url)
                .join(WordExplanation, WordExplanation.id == WordExplanationImage.explanation_id)
                .join(Word, Word.id == WordExplanation.word_id)
                .filter(
                    WordExplanationImage.media_asset_id.is_(None),
                    WordExplanationImage.image_url.isnot(None),
                    WordExplanationImage.image_url != "",
                )
            )
            if tribe_id:
                q = q.filter(Word.tribe_id == tribe_id)
            pairs = [(r.id, r.image_url) for r in q.all()]

        elif source_kind == "word_img":
            verified_locators = {
                row.source_locator
                for row in db.query(MediaAsset.source_locator).filter(
                    MediaAsset.source_kind == "word_img", MediaAsset.status == AssetStatus.VERIFIED,
                )
            }
            q = db.query(Word.word_img).filter(Word.word_img.isnot(None), Word.word_img != "")
            if tribe_id:
                q = q.filter(Word.tribe_id == tribe_id)
            pairs = [(None, word_img) for (word_img,) in q.all() if word_img not in verified_locators]

        else:
            raise ValueError(f"未知的 source_kind：{source_kind}")

        grouped = {}
        for row_id, locator in pairs:
            entry = grouped.setdefault(locator, [])
            if row_id is not None:
                entry.append(row_id)
        results = [{"locator": locator, "row_ids": row_ids} for locator, row_ids in grouped.items()]
        if limit:
            results = results[:limit]
        return results
    finally:
        db.close()
