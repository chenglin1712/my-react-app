"""音檔解碼與 wav2vec2 嵌入計算——跟 audio_fetch.py（音檔從哪裡下載）是
完全不同的關注點，這裡只管「拿到 bytes 之後怎麼轉成可比對的向量」。
"""
import io
import logging as _logging
import os
import shutil
import threading

import soundfile as sf
import torch
import torch.nn.functional as F
import torchaudio
from pydub import AudioSegment

# 自動偵測 ffmpeg，優先讀環境變數，找不到才用 shutil.which
# 啟動時只發出警告，呼叫 /compare_audio 時才真正檢查
def _find_ffmpeg() -> str | None:
    from_env = os.getenv("FFMPEG_PATH")
    if from_env and os.path.isfile(from_env):
        return from_env
    found = shutil.which("ffmpeg")
    return found

def _find_ffprobe() -> str | None:
    # 優先從 FFPROBE_PATH，否則從 FFMPEG_PATH 推導同目錄的 ffprobe
    from_env = os.getenv("FFPROBE_PATH")
    if from_env and os.path.isfile(from_env):
        return from_env
    ffmpeg = _find_ffmpeg()
    if ffmpeg:
        ffprobe = os.path.join(os.path.dirname(ffmpeg), "ffprobe.exe")
        if os.path.isfile(ffprobe):
            return ffprobe
        # Linux/macOS 無 .exe
        ffprobe_nix = os.path.join(os.path.dirname(ffmpeg), "ffprobe")
        if os.path.isfile(ffprobe_nix):
            return ffprobe_nix
    found = shutil.which("ffprobe")
    return found

_ffmpeg_path  = _find_ffmpeg()
_ffprobe_path = _find_ffprobe()

# compare_audio 上傳的使用者錄音大小上限，避免超大音檔送進 wav2vec2 拖垮記憶體
MAX_AUDIO_BYTES = 10 * 1024 * 1024  # 10 MB

# 稽核 BE4-01：檔案大小限制擋不住「很小的檔案解碼後很長」（高壓縮的 opus 10 MB 可以是數小時），
# 解碼成 PCM 再送進 wav2vec2 會讓唯一的 FastAPI 行程記憶體爆掉。所以另外限制音訊「長度」，
# 並在 ffmpeg 解碼時就用 -t 截斷，不先解出整段。遊戲的單字／例句錄音遠短於這個長度。
MAX_AUDIO_SECONDS = 30
# wav2vec2 的訓練取樣率；一律重採樣成這個值（稽核 BE4-04）
MODEL_SAMPLE_RATE = 16000


class AudioTooLongError(Exception):
    """音訊長度超過 MAX_AUDIO_SECONDS。"""

if _ffmpeg_path:
    # 把 ffmpeg bin 目錄加進 PATH，讓 pydub subprocess 找得到 ffprobe
    _bin_dir = os.path.dirname(_ffmpeg_path)
    if _bin_dir not in os.environ.get("PATH", ""):
        os.environ["PATH"] = _bin_dir + os.pathsep + os.environ.get("PATH", "")
    AudioSegment.converter = _ffmpeg_path
    if _ffprobe_path:
        AudioSegment.ffprobe = _ffprobe_path
else:
    _logging.warning(
        "[pronunciation] 找不到 ffmpeg，語音比對功能 (/compare_audio) 將無法使用。"
        "請安裝 ffmpeg 或在 .env 設定 FFMPEG_PATH=/path/to/ffmpeg"
    )


# 2. WebM → WAV
def convert_to_wav(audio_bytes):
    try:
        # duration 多留 1 秒：解碼最多只吐出 MAX_AUDIO_SECONDS + 1 秒，超過就能判定太長，又不會把整段長音檔解出來。
        # 注意要用 duration 參數，不能用 parameters=["-t", ...]：pydub 會把 parameters 接在輸出 "-" 之後，
        # ffmpeg 會把它當成多餘的選項忽略（實測 600 秒的檔案仍整段解碼）。
        audio = AudioSegment.from_file(
            io.BytesIO(audio_bytes), format=None, duration=MAX_AUDIO_SECONDS + 1,
        )
    except Exception as e:
        _logging.warning("[pronunciation] 無法解碼音檔，前 10 bytes: %s", list(audio_bytes[:10]))
        raise Exception(f"無法解碼音檔：{str(e)}")

    if len(audio) > MAX_AUDIO_SECONDS * 1000:
        raise AudioTooLongError(f"音訊長度超過 {MAX_AUDIO_SECONDS} 秒")

    # 稽核 BE4-04：使用者錄音（瀏覽器通常 48 kHz）與官方音檔（各種取樣率）原本各用自己的取樣率餵給
    # wav2vec2（它只認 16 kHz），分數失真。統一重採樣成 16 kHz 單聲道。
    audio = audio.set_frame_rate(MODEL_SAMPLE_RATE).set_channels(1)

    wav_io = io.BytesIO()
    audio.export(wav_io, format="wav")
    wav_io.seek(0)
    return wav_io


# 3. bytes → tensor
def bytes_to_tensor(wav_io):
    try:
        wav_io.seek(0)
        data, sr = sf.read(wav_io)  # 用 soundfile 讀 WAV
        waveform = torch.tensor(data, dtype=torch.float32).T  # shape [channel, time]
        if waveform.ndim == 1:
            waveform = waveform.unsqueeze(0)
    except Exception as e:
        raise Exception(f"soundfile 無法讀 WAV：{str(e)}")

    # 多聲道轉單聲道
    if waveform.size(0) > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    # 保險：convert_to_wav 已重採樣成 16 kHz；直接餵進來的其他來源也一律對齊模型要的取樣率
    if sr != MODEL_SAMPLE_RATE:
        waveform = torchaudio.functional.resample(waveform, sr, MODEL_SAMPLE_RATE)
        sr = MODEL_SAMPLE_RATE
    return waveform, sr

# 4. wav2vec2（懶載入，第一次呼叫時才下載模型，Lock 保護執行緒安全）
_wav2vec2_model = None
_wav2vec2_lock = threading.Lock()

def get_wav2vec2():
    global _wav2vec2_model
    if _wav2vec2_model is None:
        with _wav2vec2_lock:
            if _wav2vec2_model is None:
                bundle = torchaudio.pipelines.WAV2VEC2_BASE
                _wav2vec2_model = bundle.get_model()
    return _wav2vec2_model


def _get_embedding(model, wave):
    """wav tensor → 最後一層 transformer 特徵向量"""
    # 稽核 BE4-01：推論不需要梯度，包在 inference_mode 內省下反向傳播要保留的中間張量
    with torch.inference_mode():
        features, _ = model.extract_features(wave)
        return features[-1].mean(dim=1)


def _score_from_bytes(model, user_emb, audio_bytes):
    """把 audio bytes 轉成嵌入後與 user_emb 計算相似度，回傳 0-100 分"""
    wav = convert_to_wav(audio_bytes)
    wave, _ = bytes_to_tensor(wav)
    emb = _get_embedding(model, wave)
    with torch.inference_mode():
        sim = F.cosine_similarity(user_emb, emb).item()
    return round(sim * 100, 2)
