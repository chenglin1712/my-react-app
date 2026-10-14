"""把族群審閱單（F-3）的判定接進 tribes.json。

用法（在 backend/ 底下）：
    python -m config.apply_tribe_review <匯出資料夾>            # 只預覽，不寫檔
    python -m config.apply_tribe_review <匯出資料夾> --write    # 寫入

匯出資料夾是審閱單資料庫 reviews 集合的匯出，裡面每個檔案是一筆審閱，檔名 <slug>__<項目>.json，
欄位 tribe、element、verdict（none／ok／warn／bad）、who、date、source、note。

規則（保守，文化內容不自動改）：
- 只有判定「ok」且確認人、確認日期、出處三欄都有填的項目才算數。
- 七個項目全部算數，該族的 reviewStatus 才會是 confirmed，否則 unconfirmed。
  已是 confirmed 的族群只要有任何項目不再成立，就退回 unconfirmed。
- 判定 warn（需修改）或 bad（不可用）只會列在報告裡，不會改任何顯示值；
  要改識別色、族名、羅馬字、介紹文案、方言別，請依意見欄手動修改 tribes.json。
- 逐項紀錄寫到 tribe_reviews.json，tribes.json 只更新各族的 reviewStatus 那一個值，其他格式不動。
"""
import argparse
import datetime
import json
import re
import sys
from pathlib import Path

_HERE = Path(__file__).parent
TRIBES_PATH = _HERE / "tribes.json"
REVIEWS_PATH = _HERE / "tribe_reviews.json"

ELEMENTS = ("color", "name", "roman", "code", "layout", "copy", "dialect")
ELEMENT_TITLES = {
    "color": "識別色", "name": "族名用字", "roman": "羅馬字或自稱", "code": "語言代碼",
    "layout": "版面構成與裝飾", "copy": "介紹文案", "dialect": "方言別",
}
VERDICTS = ("none", "ok", "warn", "bad")


def load_review_docs(folder):
    """讀匯出資料夾（可以是 reviews 子資料夾的上一層），回傳文件字典清單。"""
    folder = Path(folder)
    sub = folder / "reviews"
    base = sub if sub.is_dir() else folder
    docs = []
    for path in sorted(base.glob("*.json")):
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            docs.append({"_bad_file": path.name})
            continue
        if not isinstance(doc, dict):
            docs.append({"_bad_file": path.name})
            continue
        doc.setdefault("_doc_id", path.stem)
        docs.append(doc)
    return docs


def _one_line(value, limit=200):
    """審閱單內容來自可寫入的使用者，印進報告前壓成單行，避免換行偽造多筆紀錄。"""
    return " ".join(str(value).split())[:limit]


def _valid_date(value):
    """確認日期必須是真實存在的 YYYY-MM-DD。"""
    if not isinstance(value, str) or len(value) != 10:
        return False
    try:
        datetime.date.fromisoformat(value)
    except ValueError:
        return False
    return True


def _accepted(doc):
    """判定 ok、確認人與出處是非空字串、確認日期是有效的 YYYY-MM-DD 才算數。"""
    return (
        doc.get("verdict") == "ok"
        and all(isinstance(doc.get(k), str) and doc[k].strip() for k in ("who", "source"))
        and _valid_date(doc.get("date"))
    )


def evaluate(tribes, docs):
    """回傳 (records, statuses, report)。

    records：{slug: {element: {verdict, who, date, source, note}}}，只含有效的審閱文件。
    statuses：{slug: "confirmed" | "unconfirmed"}，每個已知族群都有。
    report：給人看的文字行。
    """
    slugs = {t["slug"] for t in tribes}
    records = {s: {} for s in slugs}
    report = []

    for doc in docs:
        if "_bad_file" in doc:
            report.append(f"略過無法讀取的檔案：{doc['_bad_file']}")
            continue
        slug, element, verdict = doc.get("tribe"), doc.get("element"), doc.get("verdict", "none")
        if not all(isinstance(v, str) for v in (slug, element, verdict)):
            report.append(f"略過欄位型別不對的文件：{_one_line(doc.get('_doc_id'))}")
            continue
        if doc.get("_doc_id") != f"{slug}__{element}":
            report.append(f"略過檔名與內容不一致的文件：{_one_line(doc.get('_doc_id'))}")
            continue
        if slug not in slugs:
            report.append(f"略過未知的族群：{_one_line(slug)!r}（{_one_line(doc.get('_doc_id'))}）")
            continue
        if element not in ELEMENTS:
            report.append(f"略過未知的項目：{slug} / {_one_line(element)!r}")
            continue
        if verdict not in VERDICTS:
            report.append(f"略過未知的判定：{slug} / {element} / {_one_line(verdict)!r}")
            continue
        if verdict == "none":
            continue
        records[slug][element] = {
            "verdict": verdict,
            "who": doc.get("who"),
            "date": doc.get("date"),
            "source": doc.get("source"),
            "note": doc.get("note", ""),
        }

    statuses = {}
    names = {t["slug"]: t.get("name", t["slug"]) for t in tribes}
    for slug in sorted(slugs):
        recs = records[slug]
        ok = [e for e in ELEMENTS if e in recs and _accepted(recs[e])]
        statuses[slug] = "confirmed" if len(ok) == len(ELEMENTS) else "unconfirmed"
        for e in ELEMENTS:
            r = recs.get(e)
            if not r:
                continue
            if r["verdict"] == "ok" and not _accepted(r):
                report.append(f"{names[slug]} / {ELEMENT_TITLES[e]}：判定可用，但確認人、日期（YYYY-MM-DD）或出處沒填對，不算數")
            elif r["verdict"] in ("warn", "bad"):
                label = "需修改" if r["verdict"] == "warn" else "不可用"
                note = _one_line(r["note"]) or "（沒有意見）"
                report.append(f"{names[slug]} / {ELEMENT_TITLES[e]}：{label}，請手動處理。意見：{note}")
        report.append(f"{names[slug]}：{len(ok)}/{len(ELEMENTS)} 項已確認 -> {statuses[slug]}")
    return records, statuses, report


_STATUS_RE = r'("reviewStatus"\s*:\s*")(unconfirmed|confirmed)(")'


def set_review_status(text, slug, status):
    """只改 tribes.json 裡指定族群的 reviewStatus 那個值，其他格式不動。回傳新文字。"""
    m = re.search(r'"slug"\s*:\s*"%s"' % re.escape(slug), text)
    if not m:
        raise ValueError(f"tribes.json 找不到 slug：{slug}")
    sm = re.compile(_STATUS_RE).search(text, m.end())
    if not sm:
        raise ValueError(f"tribes.json：{slug} 之後找不到 reviewStatus")
    # 下一個 slug 出現在 reviewStatus 之前，代表這一族沒有自己的 reviewStatus
    nxt = re.compile(r'"slug"\s*:').search(text, m.end())
    if nxt and nxt.start() < sm.start():
        raise ValueError(f"tribes.json：{slug} 沒有自己的 reviewStatus")
    return text[: sm.start(2)] + status + text[sm.end(2):]


def apply(folder, write=False, tribes_path=TRIBES_PATH, reviews_path=REVIEWS_PATH):
    with open(tribes_path, encoding="utf-8", newline="") as f:  # 保留原本的換行字元
        text = f.read()
    data = json.loads(text)
    tribes = data["tribes"]
    records, statuses, report = evaluate(tribes, load_review_docs(folder))

    new_text = text
    current = {t["slug"]: t.get("reviewStatus", "unconfirmed") for t in tribes}
    for slug, status in statuses.items():
        if current.get(slug) != status:
            report.append(f"reviewStatus：{slug} {current.get(slug)} -> {status}")
            new_text = set_review_status(new_text, slug, status)

    if write:
        out = {s: {e: records[s][e] for e in ELEMENTS if e in records[s]} for s in sorted(records) if records[s]}
        Path(reviews_path).write_text(json.dumps(out, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        if new_text != text:
            with open(tribes_path, "w", encoding="utf-8", newline="") as f:
                f.write(new_text)
    return statuses, report


def main(argv=None):
    parser = argparse.ArgumentParser(description="把族群審閱單的判定接進 tribes.json")
    parser.add_argument("folder", help="審閱單 reviews 集合的匯出資料夾")
    parser.add_argument("--write", action="store_true", help="真的寫入（預設只預覽）")
    args = parser.parse_args(argv)
    _, report = apply(args.folder, write=args.write)
    print("\n".join(report))
    print("已寫入。" if args.write else "預覽完成，沒有寫檔；確認後加 --write。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
