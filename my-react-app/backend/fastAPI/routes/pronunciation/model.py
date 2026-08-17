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
        audio = AudioSegment.from_file(io.BytesIO(audio_bytes), format=None)
    except Exception as e:
        _logging.warning("[pronunciation] 無法解碼音檔，前 10 bytes: %s", list(audio_bytes[:10]))
        raise Exception(f"無法解碼音檔：{str(e)}")

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
    features, _ = model.extract_features(wave)
    return features[-1].mean(dim=1)


def _score_from_bytes(model, user_emb, audio_bytes):
    """把 audio bytes 轉成嵌入後與 user_emb 計算相似度，回傳 0-100 分"""
    wav = convert_to_wav(audio_bytes)
    wave, _ = bytes_to_tensor(wav)
    emb = _get_embedding(model, wave)
    sim = F.cosine_similarity(user_emb, emb).item()
    return round(sim * 100, 2)
