"""VNPT SmartVoice STT + TTS server-side client.

STT: POST a wav/pcm audio file → transcript (synchronous gRPC "standard" model,
     /stt-service/v1/grpc/standard).
TTS: POST text → a public audio_link (wav on idg-obs.vnpt.vn, valid 24h) that the
     browser plays directly (/tts-service/v2/standard).

Creds (access_token / token_id / token_key) stay server-side — same reason the
Smartbot BFF kept them off the browser. Spec: SmartVoice/ docs, VNPT API v1.0.
"""
import time

import httpx

from app.config import settings

# Shared keep-alive client: a fresh TLS handshake to api.idg.vnpt.vn per call
# added ~0.1-0.3s to every STT/TTS round trip.
_client = httpx.AsyncClient(timeout=60)

# TTS audio links stay valid 24h on VNPT's OBS — repeated lines (the fixed
# consent opening, the "please repeat" phrases) can skip generation entirely.
_TTS_TTL = 20 * 3600  # refresh well before the 24h link expiry
_tts_cache: dict[tuple, tuple[float, str]] = {}


def _headers(access: str, token_id: str, token_key: str, json: bool = False) -> dict:
    # Tolerate a token pasted with or without the "Bearer " prefix — sending
    # "Bearer Bearer <jwt>" trips VNPT's "Cannot convert access token to JSON".
    access = (access or "").strip()
    if not access.lower().startswith("bearer "):
        access = f"Bearer {access}"
    h = {
        "Authorization": access,
        "Token-id": token_id,
        "Token-key": token_key,
    }
    if json:
        h["Content-Type"] = "application/json"
    return h


def _parse_stt(data: dict) -> str:
    """First transcript out of the STT response envelope."""
    for res in ((data.get("object") or {}).get("results") or []):
        for alt in res.get("alternatives") or []:
            if alt.get("transcript"):
                return alt["transcript"].strip()
    return ""


def _parse_tts(data: dict) -> str:
    """First audio_link out of the TTS response envelope."""
    for item in ((data.get("object") or {}).get("playlist") or []):
        if item.get("audio_link"):
            return item["audio_link"]
    return ""


async def stt(audio: bytes, filename: str, client_session: str) -> str:
    url = f"{settings.SMARTVOICE_BASE_URL}/stt-service/v1/grpc/standard"
    headers = _headers(settings.SMARTVOICE_STT_ACCESS_TOKEN,
                       settings.SMARTVOICE_STT_TOKEN_ID, settings.SMARTVOICE_STT_TOKEN_KEY)
    files = {"audioFile": (filename or "audio.wav", audio, "audio/wav")}
    r = await _client.post(url, headers=headers, files=files,
                           data={"clientSession": client_session or "sess"})
    r.raise_for_status()
    return _parse_stt(r.json())


async def tts(text: str, region: str = "", speed: str = "") -> str:
    key = (text, region or settings.SMARTVOICE_TTS_REGION,
           speed or settings.SMARTVOICE_TTS_SPEED)
    hit = _tts_cache.get(key)
    if hit and time.time() - hit[0] < _TTS_TTL:
        return hit[1]
    url = f"{settings.SMARTVOICE_BASE_URL}/tts-service/v2/standard"
    headers = _headers(settings.SMARTVOICE_TTS_ACCESS_TOKEN, settings.SMARTVOICE_TTS_TOKEN_ID,
                       settings.SMARTVOICE_TTS_TOKEN_KEY, json=True)
    body = {"text": text, "text_split": False, "model": "news",
            "speed": key[2], "region": key[1]}
    r = await _client.post(url, headers=headers, json=body)
    r.raise_for_status()
    link = _parse_tts(r.json())
    if link:
        if len(_tts_cache) > 256:  # ponytail: crude cap; hot lines re-warm in one call
            _tts_cache.clear()
        _tts_cache[key] = (time.time(), link)
    return link


if __name__ == "__main__":  # parse self-check against the doc sample payloads
    stt_sample = {"message": "IDG-00000000", "object": {"results": [
        {"alternatives": [{"transcript": "Đây là nền tảng giọng nói", "confidence": -1.1}],
         "channelTag": 1.0}], "status": "OK", "audio_duration": 91.2}}
    assert _parse_stt(stt_sample) == "Đây là nền tảng giọng nói", _parse_stt(stt_sample)
    tts_sample = {"message": "IDG-00000000", "object": {"code": "success", "playlist": [
        {"audio_link": "https://idg-obs.vnpt.vn/text-speech/x.wav", "idx": "1"}]}}
    assert _parse_tts(tts_sample).endswith("x.wav"), _parse_tts(tts_sample)
    assert _parse_stt({}) == "" and _parse_tts({}) == ""
    print("smartvoice parse self-check OK")
