"""Summarise a finished follow-up call and classify its risk tier.

Uses GPT when OPENAI_API_KEY is set; falls back to a keyword heuristic so the
demo still classifies offline (or when the key is out of quota).

ponytail: heuristic keyword lists, not a model — good enough to drive the demo
tier colour; the GPT path is the real one.
"""
import json

from app.config import settings

RED_KW = [
    "chảy dịch", "chảy mủ", " mủ", "khó thở", "đau ngực", "chảy máu",
    "huyết khối", "tím", "39°", "39 độ", "38.5", "38.6", "38.7", "38.8", "38.9",
    "ngất", "co giật", "lơ mơ",
    "đau dữ dội", "rất đau", "đau không chịu", "đau không đỡ", "đau không giảm",
]
AMBER_KW = [
    "sốt", "đau tăng", "sưng", "tê", "đỏ", "khàn", "chóng mặt",
    "buồn nôn", "nôn", "mệt", "ra huyết", "khó chịu",
    # medication non-compliance is a follow-up flag, not "stable"
    "không uống thuốc", "quên uống", "bỏ thuốc", "ngừng thuốc", "chưa uống thuốc",
]


def _is_patient(turn: dict) -> bool:
    who = str(turn.get("who", "")).lower()
    return "trợ lý" not in who and "bot" not in who


def _patient_text(transcript: list[dict]) -> str:
    return " ".join(t.get("text", "") for t in transcript if _is_patient(t)).lower()


def _failed(status: str, summary: str, source: str) -> dict:
    """Failed call: no tier (patient stays 'chưa đánh giá'), nothing extracted."""
    return {"summary": summary, "tier": None, "escalated": False,
            "extracted": {}, "call_status": status, "source": source}


REFUSE_KW = ["từ chối", "không đồng ý", "đừng gọi", "không nghe"]


def _heuristic(transcript: list[dict]) -> dict:
    text = _patient_text(transcript)
    turns = [t for t in transcript if _is_patient(t) and t.get("text")]
    # ponytail: refusal = refusal keyword within the first couple of replies;
    # the GPT path does this semantically.
    if len(turns) <= 2 and any(k in text for k in REFUSE_KW):
        return _failed("refused", "Bệnh nhân từ chối nhận cuộc gọi.", "heuristic")
    tier = "green"
    if any(k in text for k in AMBER_KW):
        tier = "amber"
    if any(k in text for k in RED_KW):
        tier = "red"
    label = {"red": "nguy cơ cao", "amber": "cần theo dõi", "green": "ổn định"}[tier]
    # short extractive summary: the patient's turns, trimmed.
    said = [t.get("text", "") for t in transcript if _is_patient(t) and t.get("text")]
    body = " ".join(said)[:280]
    summary = f"Bệnh nhân cho biết: {body} → phân loại {label}."
    return {"summary": summary, "tier": tier, "escalated": tier == "red",
            "extracted": {}, "call_status": "completed", "source": "heuristic"}


def _gpt(transcript: list[dict], questions: list[dict] | None = None) -> dict:
    from openai import OpenAI

    # 20s: summary + per-variable extraction over a whole call transcript can
    # exceed the old 8s, and a timeout silently degrades to the heuristic.
    client = OpenAI(api_key=settings.OPENAI_API_KEY, max_retries=0, timeout=20)
    convo = "\n".join(f"{t.get('who')}: {t.get('text')}" for t in transcript)
    extract_task = ""
    if questions:
        vars_block = "\n".join(
            f"- {q['expected_var']}: {q['text']}" if q.get("expected_var")
            else f"- (tự đặt nhãn): {q['text']}"
            for q in questions)
        extract_task = (
            "; (4) trích 'extracted': với MỖI câu hỏi dưới đây mà bệnh nhân ĐÃ trả lời, "
            "thêm một cặp khóa-giá trị — khóa là tên biến cho sẵn; câu ghi '(tự đặt nhãn)' "
            "thì tự đặt nhãn tiếng Việt ngắn 1-3 từ làm khóa (vd \"Sốt\", \"Vết mổ\"); "
            "giá trị là câu trả lời tóm gọn (vd \"không\", \"có - sốt 38 độ\"). "
            "BỎ QUA câu chưa hỏi hoặc không có câu trả lời. Nếu bệnh nhân nêu dấu hiệu "
            "quan trọng ngoài các câu hỏi, thêm nhãn riêng cho dấu hiệu đó:\n"
            f"{vars_block}\n"
        )
    prompt = (
        "Bạn là điều dưỡng theo dõi hậu phẫu. Dưới đây là bản ghi cuộc gọi theo dõi "
        "giữa trợ lý và bệnh nhân. Hãy: (1) tóm tắt ngắn gọn tình trạng bệnh nhân bằng "
        "tiếng Việt; (2) phân loại mức nguy cơ 'tier' THEO ĐÚNG TIÊU CHÍ SAU:\n"
        "- 'red': BẤT KỲ câu trả lời nào có dấu hiệu nguy hiểm — khó thở, đau ngực, "
        "chảy máu, sốt từ 38.5°C, vết mổ chảy mủ/dịch hôi/sưng đỏ lan rộng, ĐAU DỮ DỘI, "
        "đau nhiều, đau ngày càng tăng hoặc không giảm dù đã dùng thuốc, ngất/lơ mơ/co giật, "
        "bắp chân sưng nóng đau một bên, hoặc dấu hiệu nặng tương đương;\n"
        "- 'amber': không có dấu hiệu nguy hiểm nhưng có ít nhất MỘT bất thường nhẹ — "
        "sốt nhẹ dưới 38.5°C, đau tăng/sưng nhẹ, KHÔNG uống đủ thuốc (quên, bỏ, tự ngừng), "
        "ăn kém, mất ngủ kéo dài, vết mổ hơi đỏ, lo lắng nhiều;\n"
        "- 'green': CHỈ khi bệnh nhân đã thật sự trả lời các câu hỏi theo dõi và MỌI câu "
        "trả lời đều bình thường. Bệnh nhân mới đồng ý nghe máy mà chưa trả lời gì, hoặc "
        "trả lời quá ít câu để kết luận — KHÔNG được chọn 'green'.\n"
        "(3) đánh giá kết quả cuộc gọi 'call_status': 'refused' nếu bệnh nhân từ chối "
        "nhận cuộc gọi hoặc không đồng ý ghi âm, 'no_answer' nếu bệnh nhân không trả lời "
        "được câu hỏi THEO DÕI nào (kể cả khi đã đồng ý nghe máy), 'completed' nếu cuộc "
        "gọi diễn ra bình thường"
        f"{extract_task}. "
        'Trả về JSON: {"summary":"...","tier":"red|amber|green","escalated":true/false,'
        '"call_status":"completed|refused|no_answer"'
        + (',"extracted":{"ten_bien":"trả lời"}' if questions else "") + "}.\n\n"
        f"BẢN GHI:\n{convo}"
    )
    resp = client.chat.completions.create(
        model=settings.OPENAI_MODEL,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.2,
    )
    data = json.loads(resp.choices[0].message.content)
    if data.get("call_status") in ("refused", "no_answer"):
        fallback = ("Bệnh nhân từ chối nhận cuộc gọi."
                    if data["call_status"] == "refused"
                    else "Không nhận được câu trả lời từ bệnh nhân.")
        return _failed(data["call_status"], data.get("summary") or fallback, "gpt")
    tier = data.get("tier") if data.get("tier") in ("red", "amber", "green") else "amber"
    extracted = data.get("extracted")
    return {
        "summary": data.get("summary") or "(không có tóm tắt)",
        "tier": tier,
        "escalated": bool(data.get("escalated")) or tier == "red",
        "extracted": {k: v for k, v in extracted.items() if v is not None}
                     if isinstance(extracted, dict) else {},
        "call_status": "completed",
        "source": "gpt",
    }


# "Ổn định" là kết luận cần bằng chứng: phải trả lời được ít nhất nửa số câu
# dự kiến thì green mới đứng vững. Ít hơn → amber (gọi lại); 0 câu → no_answer.
GREEN_MIN_COVERAGE = 0.5


def _coverage_guard(result: dict, questions: list[dict] | None) -> dict:
    """Server-side backstop for a lenient GPT: a 'green' with no/too few
    collected signals gets downgraded. Only applies to the GPT path (the
    heuristic never extracts) and only when extraction was requested."""
    if not questions or result.get("source") != "gpt":
        return result
    if result.get("call_status") != "completed" or result.get("tier") != "green":
        return result
    answered = len(result.get("extracted") or {})
    if answered == 0:
        # e.g. consented then hung up — nothing medical was collected.
        return _failed("no_answer",
                       "Bệnh nhân đồng ý nghe máy nhưng chưa trả lời câu hỏi theo dõi nào.",
                       "gpt")
    if answered / len(questions) < GREEN_MIN_COVERAGE:
        result["tier"] = "amber"
        result["escalated"] = False
        result["summary"] = ((result.get("summary") or "").rstrip(". ") +
                             f". Cuộc gọi chưa hoàn tất — mới thu được {answered}/"
                             f"{len(questions)} dấu hiệu, cần gọi lại để đánh giá đầy đủ.")
    return result


def analyze(transcript: list[dict], questions: list[dict] | None = None) -> dict:
    """questions: [{"text", "expected_var"}] — when given, the GPT path also
    extracts each variable's answer into result["extracted"]."""
    # No patient speech at all (hung up / never answered) — deterministic, no GPT.
    if not _patient_text(transcript).strip():
        return _failed("no_answer",
                       "Không nhận được câu trả lời từ bệnh nhân.", "rule")
    if settings.OPENAI_API_KEY:
        try:
            return _coverage_guard(_gpt(transcript, questions), questions)
        except Exception as e:  # noqa: BLE001 — demo must not crash on AI errors
            print(f"[call_analysis] GPT failed, using heuristic: {e}", flush=True)
    return _heuristic(transcript)


if __name__ == "__main__":  # tiny self-check
    t = [
        {"who": "Trợ lý", "text": "Anh có sốt không?"},
        {"who": "Anh Bảo", "text": "Có, tôi sốt 38.7 và vết mổ chảy dịch."},
    ]
    r = _heuristic(t)
    assert r["tier"] == "red" and r["escalated"], r
    g = _heuristic([{"who": "Trợ lý", "text": "?"}, {"who": "BN", "text": "Tôi khỏe, ăn uống tốt."}])
    assert g["tier"] == "green" and g["call_status"] == "completed", g
    na = analyze([{"who": "Trợ lý", "text": "Xin chào..."}])
    assert na["call_status"] == "no_answer" and na["tier"] is None and na["extracted"] == {}, na
    rf = _heuristic([{"who": "Trợ lý", "text": "...đồng ý chứ ạ?"}, {"who": "BN", "text": "Tôi từ chối."}])
    assert rf["call_status"] == "refused" and rf["tier"] is None, rf
    # coverage guard: a GPT "green" needs actual answered signals to stand
    qs = [{"text": f"q{i}", "expected_var": f"v{i}"} for i in range(4)]
    base = {"tier": "green", "call_status": "completed", "source": "gpt",
            "escalated": False, "summary": "Ổn."}
    g0 = _coverage_guard({**base, "extracted": {}}, qs)
    assert g0["call_status"] == "no_answer" and g0["tier"] is None, g0
    g1 = _coverage_guard({**base, "extracted": {"Sốt": "không"}}, qs)
    assert g1["tier"] == "amber" and "chưa hoàn tất" in g1["summary"], g1
    g3 = _coverage_guard({**base, "extracted": {"a": 1, "b": 2, "c": 3}}, qs)
    assert g3["tier"] == "green", g3
    rd = _coverage_guard({**base, "tier": "red", "extracted": {}}, qs)
    assert rd["tier"] == "red", rd  # red/amber never touched by coverage
    print("call_analysis self-check OK")
