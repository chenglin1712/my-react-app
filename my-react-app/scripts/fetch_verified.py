"""下載一個檔案，核對 SHA-256 通過才放到目的地（稽核 SUP-8）。

用法：python fetch_verified.py <https 網址> <目的檔路徑> <預期 SHA-256> [大小上限位元組]

Dockerfile 用它下載 wav2vec2 權重：這個檔案是 torch.load 要讀的 pickle，被偷換就等於在建置階段執行任意程式碼，
所以雜湊不符就不留下檔案、以非 0 結束碼讓 docker build 失敗。
- 只接受 https（含重新導向後的最終網址）。
- 邊下載邊算雜湊，不把整個檔案讀進記憶體；超過大小上限或總時限就中止，避免異常回應耗盡磁碟或讓 build 無限期卡住。
- 先寫到同目錄的暫存檔，驗證通過才換名；中途失敗不會留下半個檔案。
"""
import hashlib
import os
import sys
import tempfile
import time
import urllib.request

CHUNK = 1024 * 1024
TIMEOUT_SECONDS = 60  # 單次連線／讀取的逾時；持續慢速送資料不會觸發，所以另有下面的總時限
TOTAL_DEADLINE_SECONDS = 1800
DEFAULT_MAX_BYTES = 1024 * 1024 * 1024  # 1 GiB


def fetch_verified(url, dest, expected_sha256, max_bytes=DEFAULT_MAX_BYTES, deadline_seconds=TOTAL_DEADLINE_SECONDS):
    if not url.startswith("https://"):
        raise SystemExit(f"只接受 https 網址：{url}")
    expected = expected_sha256.strip().lower()
    if len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected):
        raise SystemExit("預期的 SHA-256 必須是 64 個十六進位字元")

    dest_dir = os.path.dirname(os.path.abspath(dest))
    os.makedirs(dest_dir, exist_ok=True)
    digest = hashlib.sha256()
    total = 0
    deadline = time.monotonic() + deadline_seconds
    fd, tmp_path = tempfile.mkstemp(dir=dest_dir, suffix=".part")
    try:
        with os.fdopen(fd, "wb") as out, urllib.request.urlopen(url, timeout=TIMEOUT_SECONDS) as resp:
            if not resp.geturl().startswith("https://"):
                raise SystemExit(f"重新導向到非 https 網址：{resp.geturl()}")
            while True:
                chunk = resp.read(CHUNK)
                if not chunk:
                    break
                if time.monotonic() > deadline:
                    raise SystemExit(f"下載超過總時限 {deadline_seconds} 秒，中止")
                total += len(chunk)
                if total > max_bytes:
                    raise SystemExit(f"下載超過大小上限 {max_bytes} 位元組，中止")
                digest.update(chunk)
                out.write(chunk)
        if digest.hexdigest() != expected:
            raise SystemExit(f"SHA-256 不符：預期 {expected}，實際 {digest.hexdigest()}")
        os.replace(tmp_path, dest)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
    return total


def main(argv):
    if len(argv) not in (4, 5):
        raise SystemExit(__doc__)
    max_bytes = int(argv[4]) if len(argv) == 5 else DEFAULT_MAX_BYTES
    size = fetch_verified(argv[1], argv[2], argv[3], max_bytes)
    print(f"已下載並驗證 {argv[2]}（{size} 位元組）")


if __name__ == "__main__":
    main(sys.argv)
