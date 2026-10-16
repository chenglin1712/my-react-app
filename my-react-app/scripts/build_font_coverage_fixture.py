#!/usr/bin/env python3
"""重新產生 frontend/static/css/fontCoverage.fixture.json（不要手動改那個 JSON）。

做兩件事：
1. 下載 index.html 請求的 Google Fonts 完整字型檔，用 fontTools 讀字元對照表（字型有沒有字形）。
2. 用瀏覽器 UA 下載同一個網址的 CSS，讀每個 @font-face 的 unicode-range（Google 會不會把該切片送出）。

用法（需要 pip install fonttools，官方文件選用 pypdf）：
  python scripts/build_font_coverage_fixture.py            # 沿用 fixture 內已記錄的官方文件字元
  python scripts/build_font_coverage_fixture.py --pdf 書寫系統.pdf   # 重新從官方 PDF 抽字元
改了 index.html 的字型網址，或 Google 更新字型版本後，重跑並檢視 git diff。
"""
import argparse, io, json, os, re, tempfile, unicodedata, urllib.request
from datetime import datetime, timezone
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURE = os.path.join(ROOT, "frontend", "static", "css", "fontCoverage.fixture.json")
CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
# 專案程式碼實際出現的族語相關字元（已排除 Unicode 正規化測試資料）
REPO_CODE = {0x2BB, 0x2BC, 0x2BE, 0x301, 0x307, 0x1E63}


def fetch(url, ua=None):
    req = urllib.request.Request(url, headers={"User-Agent": ua} if ua else {})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def fonts_url():
    html = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    html = re.sub(r"<noscript>[\s\S]*?</noscript>", "", html)
    return re.search(r'href="(https://fonts\.googleapis\.com/css2[^"]+)"', html).group(1)


def official_from_pdf(path):
    from pypdf import PdfReader
    out = set()
    for page in PdfReader(path).pages:
        for ch in page.extract_text() or "":
            o = ord(ch)
            if o < 0x80 or o in (0x2192, 0x2500) or 0xE000 <= o <= 0xF8FF:
                continue
            if 0x4E00 <= o <= 0x9FFF or 0x3000 <= o <= 0x303F or 0xFF00 <= o <= 0xFFEF or 0x2000 <= o <= 0x206F or 0x3400 <= o <= 0x4DBF or 0xF900 <= o <= 0xFAFF:
                continue
            out.add(o)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pdf")
    args = ap.parse_args()
    url = fonts_url()
    if args.pdf:
        official = official_from_pdf(args.pdf)
    else:
        old = json.load(io.open(FIXTURE, encoding="utf-8"))
        official = {int(c["cp"][2:], 16) for c in old["chars"] if "official-writing-system-pdf" in c["sources"]}

    # 1) 字型有沒有字形（預設 UA 會拿到 TTF）
    ttf_css = fetch(url).decode("utf-8")
    cmaps, font_urls = {}, {}
    with tempfile.TemporaryDirectory() as tmp:
        for m in re.finditer(r"font-family: '([^']+)'.*?url\((https[^)]+)\)", ttf_css, re.S):
            fam, u = m.group(1), m.group(2)
            path = os.path.join(tmp, re.sub(r"\W", "_", fam) + ".ttf")
            io.open(path, "wb").write(fetch(u))
            with TTFont(path, lazy=True) as tt:  # 讀完立刻關檔，Windows 才刪得掉暫存檔
                cmaps[fam] = set(tt.getBestCmap().keys())
            font_urls[fam] = u

    # 2) Google 會不會送出該切片（瀏覽器 UA 拿到 woff2 與 unicode-range）
    slices = {}
    for block in re.findall(r"@font-face\s*{(.*?)}", fetch(url, CHROME_UA).decode("utf-8"), re.S):
        fam = re.search(r"font-family:\s*'([^']+)'", block).group(1)
        for r in re.search(r"unicode-range:\s*([^;]+);", block).group(1).split(","):
            r = r.strip()[2:]
            a, b = r.split("-") if "-" in r else (r, r)
            slices.setdefault(fam, []).append((int(a, 16), int(b, 16)))

    chars = []
    for cp in sorted(official | REPO_CODE):
        src = (["official-writing-system-pdf"] if cp in official else []) + (["repo-code"] if cp in REPO_CODE else [])
        has = [f for f in cmaps if cp in cmaps[f]]
        chars.append({"cp": "U+%04X" % cp, "name": unicodedata.name(chr(cp), "?"), "sources": src, "coveredBy": has,
                      "deliveredBy": [f for f in has if any(a <= cp <= b for a, b in slices.get(f, []))]})
    out = {
        "note": "涵蓋上界：官方《原住民族語言書寫系統》113年修正對照表出現的全部非中日韓字元（含音標，未區分書寫符號與音標）加上專案程式碼實際出現的字元。coveredBy = 字型檔有字形（fontTools 讀完整字型檔的字元對照表）；deliveredBy = 同時 Google 送出的 unicode-range 切片也包含該碼位。由 scripts/build_font_coverage_fixture.py 產生，不要手動修改。",
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "fontsUrl": url,
        "fonts": {f: {"url": u} for f, u in font_urls.items()},
        "chars": chars,
    }
    io.open(FIXTURE, "w", encoding="utf-8", newline="\n").write(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print("wrote", FIXTURE, len(chars), "chars")


main()
