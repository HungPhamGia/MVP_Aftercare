"""GPT brain for the follow-up voicebot — replaces the VNPT Smartbot.

Call script: every session opens with the same fixed consent line (recording
disclosure). Refusal → apologize and hang up (done=true). Consent → GPT
introduces itself as the doctor's AI nurse, confirms the patient's identity
(name, surgery, dates), then works through the patient's approved questions
one at a time — short clarifying follow-ups allowed, diagnosis never. Same
{text, handoff, done} contract chatbot.js consumes (speech-to-speech: no
quickreply buttons).

ponytail: session history is an in-memory dict — fine for a single-process demo.
Move to Redis/DB only if you run multiple workers or need calls to survive a restart.
"""
import json

from app.config import settings

# session_id -> {"messages": [ ... chat history ... ]}
_SESSIONS: dict[str, dict] = {}

HOSPITAL = "bệnh viện X"  # ponytail: placeholder, set when a real hospital signs on

# Fixed consent opening — identical for every session (recording disclosure).
OPENING = (
    f"Xin chào, cháu là Aftercare, điều dưỡng theo dõi AI của {HOSPITAL}. "
    "Cháu gọi đến mình để hỏi thăm tình trạng định kì. Cuộc gọi sẽ được ghi âm "
    "xuyên suốt để phục vụ thu nhận thông tin và hỗ trợ bác sĩ. "
    "Mình có đồng ý kết nối cuộc gọi không ạ? Nếu không đồng ý hãy nói từ chối."
)


def _system_prompt(questions: list[str], patient: dict) -> str:
    qlist = "\n".join(f"{i + 1}. {q}" for i, q in enumerate(questions)) or "(không có câu hỏi)"
    p = patient or {}
    return (
        f"Bạn là 'Aftercare' — điều dưỡng AI của {HOSPITAL}, gọi điện theo dõi bệnh nhân "
        "hậu phẫu. Xưng 'cháu', gọi bệnh nhân bằng xưng hô phù hợp tuổi/giới "
        "(cô/chú/anh/chị...). Nói tiếng Việt, thân thiện, ngắn gọn tự nhiên như trên điện thoại.\n\n"
        "THÔNG TIN BỆNH NHÂN:\n"
        f"- Họ tên: {p.get('ho_ten') or '(chưa rõ)'}\n"
        f"- Giới tính / tuổi: {p.get('gioi_tinh') or '?'} / {p.get('tuoi') or '?'}\n"
        f"- Bác sĩ phụ trách: {p.get('bac_si_phu_trach') or '(chưa rõ)'}\n"
        f"- Phẫu thuật: {p.get('phau_thuat') or '(chưa rõ)'}\n"
        f"- Ngày xuất viện: {p.get('ngay_xuat_vien') or '(chưa rõ)'}\n"
        f"- Lịch tái khám: {p.get('lich_tai_kham') or '(chưa có)'}\n\n"
        "KỊCH BẢN BẮT BUỘC:\n"
        "1. Lời mở đầu xin phép ghi âm đã được đọc (tin nhắn đầu tiên của bạn). Lượt kế "
        "tiếp là phản hồi của người nghe về việc đồng ý kết nối hay không.\n"
        "2. Nếu người nghe TỪ CHỐI hoặc không muốn nói chuyện: xin lỗi vì đã làm phiền, "
        "chào tạm biệt lịch sự, đặt done=true. KHÔNG thuyết phục thêm.\n"
        "3. Nếu ĐỒNG Ý: giới thiệu và xác nhận danh tính theo mẫu: 'Cháu là điều dưỡng "
        f"thông minh của {p.get('bac_si_phu_trach') or '(bác sĩ phụ trách)'}. Đây có phải "
        f"số điện thoại của {p.get('ho_ten') or 'bệnh nhân'} không ạ? Mình có ca "
        f"{p.get('phau_thuat') or 'phẫu thuật'} và xuất viện ngày {p.get('ngay_xuat_vien') or '...'}' "
        "— tự nhiên hoá câu chữ, điều chỉnh xưng hô cho phù hợp.\n"
        "4. Nếu nhầm số / người nghe không phải bệnh nhân hay người nhà: xin lỗi, chào, done=true.\n"
        "5. Xác nhận đúng người xong, hỏi LẦN LƯỢT từng câu trong BỘ CÂU HỎI — mỗi lượt CHỈ "
        "MỘT câu, theo thứ tự. Với câu trả lời tự do của bệnh nhân, được hỏi thêm tối đa 1 câu "
        "ngắn để làm rõ (mức độ, thời gian, vị trí...) rồi quay lại bộ câu hỏi.\n"
        "6. TUYỆT ĐỐI KHÔNG chẩn đoán, không kết luận bệnh, không kê hay tư vấn thuốc. Chỉ ghi "
        "nhận, trấn an ngắn gọn ('dạ, cháu ghi nhận rồi ạ, thông tin sẽ được gửi bác sĩ xem...') "
        "rồi chuyển tiếp sang câu hỏi khác của bộ câu hỏi.\n"
        "7. Bệnh nhân báo dấu hiệu nguy hiểm (sốt cao khó hạ, khó thở, đau ngực, chảy máu nhiều, "
        "vết mổ chảy mủ, ngất...) hoặc yêu cầu gặp nhân viên y tế: trấn an, đặt handoff=true.\n"
        "8. Khi đã hỏi hết các câu: nhắc lịch tái khám (nếu có), dặn liên hệ bác sĩ phụ trách "
        "hoặc 115 khi có dấu hiệu bất thường, cảm ơn và chào tạm biệt, done=true.\n\n"
        f"BỘ CÂU HỎI:\n{qlist}\n\n"
        'Luôn trả về JSON: {"reply":"lời nói với bệnh nhân","handoff":false,"done":false}.'
    )


def converse(
    text: str, session_id: str, ma_ho_so: str, first_turn: bool,
    questions: list[str], patient: dict | None = None,
) -> dict:
    sess = _SESSIONS.get(session_id)
    if first_turn or sess is None:
        # Scripted consent opening — deterministic, no GPT call; the incoming
        # "alo" seed text is not real patient speech, so it isn't recorded.
        _SESSIONS[session_id] = {"messages": [
            {"role": "system", "content": _system_prompt(questions, patient or {})},
            {"role": "assistant", "content": json.dumps(
                {"reply": OPENING, "handoff": False, "done": False}, ensure_ascii=False)},
        ]}
        return {"text": OPENING, "handoff": False, "done": False}

    if not settings.OPENAI_API_KEY:
        # Stub so the Voicebot view works without an OpenAI key.
        return {
            "text": f"[GPT chưa cấu hình] Bạn vừa nói: “{text}”",
            "handoff": False, "done": False,
        }

    sess["messages"].append({"role": "user", "content": text})

    try:
        from openai import OpenAI

        client = OpenAI(api_key=settings.OPENAI_API_KEY, max_retries=0, timeout=15)
        resp = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=sess["messages"],
            response_format={"type": "json_object"},
            temperature=0.4,
        )
        content = resp.choices[0].message.content
        sess["messages"].append({"role": "assistant", "content": content})
        data = json.loads(content)
    except Exception as exc:  # noqa: BLE001 — demo must degrade, not 500
        print(f"[gptbot] error: {exc}", flush=True)
        return {
            "text": "Trợ lý tạm thời không phản hồi (lỗi kết nối tới GPT). "
                    "Vui lòng kiểm tra OPENAI_API_KEY.",
            "handoff": False, "done": False,
        }

    if data.get("done"):
        _SESSIONS.pop(session_id, None)  # free history; call is over
    return {
        "text": (data.get("reply") or "").strip(),
        "handoff": bool(data.get("handoff")),
        "done": bool(data.get("done")),
    }


if __name__ == "__main__":  # tiny self-check (no network)
    settings.OPENAI_API_KEY = ""  # force stub path after the scripted opening
    r = converse("alo", "s1", "HS001", True, ["Anh có sốt không?"], {"ho_ten": "Anh Bảo"})
    assert r["text"].startswith("Xin chào, cháu là Aftercare") and r["done"] is False, r
    r2 = converse("Đồng ý", "s1", "HS001", False, [])
    assert r2["text"] and r2["handoff"] is False and r2["done"] is False, r2
    print("gptbot self-check OK")
