import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.staticfiles import StaticFiles
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from app import gptbot, smartvoice
from app.config import settings
from app.db import get_db
from app.models import BenhAn, CallResult, Monitoring, Question, QuestionSet
from app.questions_gen import CORE, TEMPLATE, ai_suggest_questions, build_question_set
from app.schemas import (
    CallDemoIn, ConversationIn, GenerateIn, GhiChuIn, ManualCallIn, MonitoringIn,
    PatientQuestionSetIn, QuestionSetIn, QuestionsSaveIn, ReExamIn, SetVariablesIn,
    SetVariablesOut, TemplateIn, ThuocIn, TtsIn,
)

app = FastAPI(title="AfterCare Web Demo")

STATIC_DIR = Path(__file__).parent / "static"


@app.get("/health")
def health():
    return {"status": "ok"}


def now_utc() -> datetime:
    """Aware UTC timestamps for the timestamptz columns. Naive now_utc()
    depends on the server's local clock — the local (UTC+7) machine and Render
    (UTC) wrote instants 7h apart into the same DB, breaking event ordering
    (e.g. a case 'closed' in the future kept discarding newer calls)."""
    return datetime.now(timezone.utc)


def row_to_dict(obj) -> dict:
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


def get_record_or_404(db: Session, ma_ho_so: str) -> BenhAn:
    rec = db.get(BenhAn, ma_ho_so)
    if rec is None:
        raise HTTPException(404, f"record {ma_ho_so} not found")
    return rec


def latest_call_result(db: Session, ma_ho_so: str) -> CallResult | None:
    return db.scalars(
        select(CallResult)
        .where(CallResult.ma_ho_so == ma_ho_so)
        .order_by(CallResult.id.desc())
        .limit(1)
    ).first()


def _current(cr: CallResult | None, resolved_at) -> CallResult | None:
    """Latest call that still counts toward the patient's *current* state.
    A closed case (resolved_at set) discards calls made at/before it, so the
    patient falls back to 'chưa đánh giá' until a newer call comes in."""
    if cr and resolved_at and cr.ended_at and cr.ended_at <= resolved_at:
        return None
    return cr


def current_call_result(db: Session, ma_ho_so: str, resolved_at) -> CallResult | None:
    return _current(latest_call_result(db, ma_ho_so), resolved_at)


def latest_call_results_map(db: Session) -> dict[str, CallResult]:
    """Newest call per patient in ONE query (Postgres DISTINCT ON). The old
    per-row lookup made every page load fire 2 queries per patient — dozens of
    serial round trips to Supabase, which serialized concurrent users."""
    rows = db.scalars(
        select(CallResult)
        .distinct(CallResult.ma_ho_so)
        .order_by(CallResult.ma_ho_so, CallResult.id.desc())
    ).all()
    return {cr.ma_ho_so: cr for cr in rows}


def monitoring_map(db: Session) -> dict[str, Monitoring]:
    return {m.ma_ho_so: m for m in db.scalars(select(Monitoring)).all()}


def latest_question_set(db: Session, ma_ho_so: str) -> QuestionSet | None:
    return db.scalars(
        select(QuestionSet)
        .where(QuestionSet.ma_ho_so == ma_ho_so)
        .order_by(QuestionSet.id.desc())
        .limit(1)
    ).first()


def approved_question_set(db: Session, ma_ho_so: str) -> QuestionSet | None:
    return db.scalars(
        select(QuestionSet)
        .where(QuestionSet.ma_ho_so == ma_ho_so, QuestionSet.status == "approved")
        .order_by(QuestionSet.id.desc())
        .limit(1)
    ).first()


# ponytail: keyword heuristic maps a patient to one disease template. Good enough
# while every case is post-op; swap for an explicit patient→template field if the
# roster grows beyond these buckets.
DISEASE_KEYWORDS = {
    "Sản khoa": ["tử cung", "thai", "sản", "âm đạo", "buồng trứng"],
    "Chấn thương chỉnh hình": ["xương", "gãy", "khớp", "nẹp", "vít", "cổ tay", "mắt cá"],
}


def match_disease(rec: BenhAn) -> str:
    hay = " ".join(filter(None, [rec.chan_doan, rec.phau_thuat])).lower()
    for disease, kws in DISEASE_KEYWORDS.items():
        if any(k in hay for k in kws):
            return disease
    return "Hậu phẫu"


def _active_template_questions(db: Session, disease: str) -> list[dict]:
    """The active template's question list for a disease ([] if none)."""
    row = db.execute(
        text("SELECT questions FROM question_templates "
             "WHERE disease = :d AND active = true ORDER BY id LIMIT 1"),
        {"d": disease},
    ).scalar()
    return row or []


def _required_questions(db: Session, disease: str) -> list[dict]:
    return [q for q in _active_template_questions(db, disease)
            if q.get("required") and not q.get("disabled")]


# --- Bot-facing: set_variables contract ---
@app.post("/his/patient/fetch", response_model=SetVariablesOut)
def patient_fetch(body: SetVariablesIn, db: Session = Depends(get_db)):
    # ponytail: temp debug — log the real Smartbot payload, remove once shape confirmed.
    #print(f"[patient_fetch] set_variables={body.set_variables}", flush=True)
    ma_ho_so = body.set_variables.get("ma_ho_so")
    if not ma_ho_so:
        raise HTTPException(400, "set_variables.ma_ho_so required")
    rec = get_record_or_404(db, ma_ho_so)

    # PHI minimization: omit so_the_bhyt, chan_doan (ICD), xet_nghiem.
    # Console vars are strings; empty = "". ngay_hau_phau = lich_tai_kham
    # (dùng để nhắc lịch tái khám ở cuối cuộc gọi).
    return SetVariablesOut(set_variables={
        "ho_ten": rec.ho_ten or "",
        "phau_thuat": rec.phau_thuat or "",
        "ngay_hau_phau": str(rec.lich_tai_kham) if rec.lich_tai_kham else "",
        "bac_si_phu_trach": rec.bac_si_phu_trach or "",
    })


@app.post("/his/questions/fetch", response_model=SetVariablesOut)
def questions_fetch(body: SetVariablesIn, db: Session = Depends(get_db)):
    """API-Card cho Smartbot console: câu hỏi phẳng cau_hoi_1..cau_hoi_5.
    Ưu tiên bộ đã duyệt của bệnh nhân; chưa duyệt thì dùng bản mẫu theo bệnh
    (giống call-preview). Câu trống = ""."""
    ma_ho_so = body.set_variables.get("ma_ho_so")
    if not ma_ho_so:
        raise HTTPException(400, "set_variables.ma_ho_so required")
    rec = get_record_or_404(db, ma_ho_so)

    qset = approved_question_set(db, ma_ho_so)
    if qset:
        texts = [q.text for q in qset.questions]
    else:
        texts = [d["text"] for d in build_question_set({
            "phau_thuat": rec.phau_thuat, "thuoc_ke": rec.thuoc_ke,
            "ghi_chu_theo_doi": rec.ghi_chu_theo_doi,
        })]
    # ponytail: console template carries max 5 question slots; extras dropped.
    texts = texts[:5]
    sv = {f"cau_hoi_{i}": (texts[i - 1] if i <= len(texts) else "") for i in range(1, 6)}
    sv["so_cau_hoi"] = str(len(texts))
    return SetVariablesOut(set_variables=sv)


# --- Dashboard (plain JSON) ---
@app.get("/records")
def list_records(db: Session = Depends(get_db)):
    rows = db.scalars(select(BenhAn)).all()
    crs = latest_call_results_map(db)
    out = []
    for r in rows:
        cr = crs.get(r.ma_ho_so)
        out.append({
            "ma_ho_so": r.ma_ho_so,
            "ho_ten": r.ho_ten,
            "phau_thuat": r.phau_thuat,
            "ngay_xuat_vien": r.ngay_xuat_vien,
            "tier": cr.tier if cr else None,
        })
    return out


@app.get("/records/{ma_ho_so}")
def get_record(ma_ho_so: str, db: Session = Depends(get_db)):
    rec = get_record_or_404(db, ma_ho_so)
    cr = latest_call_result(db, ma_ho_so)
    return {"record": row_to_dict(rec), "latest_call_result": row_to_dict(cr) if cr else None}


@app.get("/records/{ma_ho_so}/call-results")
def call_result_history(ma_ho_so: str, db: Session = Depends(get_db)):
    rows = db.scalars(
        select(CallResult)
        .where(CallResult.ma_ho_so == ma_ho_so)
        .order_by(CallResult.id.desc())
    ).all()
    return [row_to_dict(r) for r in rows]


# --- Write-back (API-Card cuối cuộc gọi: đáp án trong set_variables) ---
@app.post("/his/call-result")
def create_call_result(body: SetVariablesIn, db: Session = Depends(get_db)):
    sv = body.set_variables
    ma_ho_so = sv.get("ma_ho_so")
    if not ma_ho_so:
        raise HTTPException(400, "set_variables.ma_ho_so required")
    get_record_or_404(db, ma_ho_so)
    cr = CallResult(
        ma_ho_so=ma_ho_so,
        session_id=sv.get("session_id"),
        raw_answers={k: v for k, v in sv.items() if k not in ("ma_ho_so", "session_id")},
        ended_at=now_utc(),
    )
    db.add(cr)
    db.commit()
    return {"status": "success", "code": 200}


@app.put("/records/{ma_ho_so}/ghi-chu")
def update_ghi_chu(ma_ho_so: str, body: GhiChuIn, db: Session = Depends(get_db)):
    rec = get_record_or_404(db, ma_ho_so)
    rec.ghi_chu_theo_doi = body.ghi_chu_theo_doi
    db.commit()
    return {"ma_ho_so": ma_ho_so, "ghi_chu_theo_doi": rec.ghi_chu_theo_doi}


@app.put("/records/{ma_ho_so}/thuoc")
def update_thuoc(ma_ho_so: str, body: ThuocIn, db: Session = Depends(get_db)):
    rec = get_record_or_404(db, ma_ho_so)
    rec.thuoc_ke = body.thuoc_ke
    db.commit()
    return {"ma_ho_so": ma_ho_so, "thuoc_ke": rec.thuoc_ke}


@app.put("/records/{ma_ho_so}/monitoring")
def update_monitoring(ma_ho_so: str, body: MonitoringIn, db: Session = Depends(get_db)):
    get_record_or_404(db, ma_ho_so)
    mon = db.get(Monitoring, ma_ho_so)
    if mon is None:
        mon = Monitoring(ma_ho_so=ma_ho_so)
        db.add(mon)
    if body.monitoring_status is not None:
        mon.monitoring_status = body.monitoring_status
    if body.next_call_at is not None:
        mon.next_call_at = body.next_call_at
        # a newly-scheduled call re-activates a closed case, but keep resolved_at:
        # the patient stays "chưa đánh giá" until the *new* call actually lands.
        mon.monitoring_status = body.monitoring_status or "active"
    mon.updated_at = now_utc()
    db.commit()
    return {
        "ma_ho_so": ma_ho_so,
        "monitoring_status": mon.monitoring_status,
        "next_call_at": mon.next_call_at,
    }


@app.post("/records/{ma_ho_so}/close")
def close_case(ma_ho_so: str, db: Session = Depends(get_db)):
    """Đóng ca: ca đã xử lý xong → về trạng thái 'chưa đánh giá'. Ghi resolved_at
    (các cuộc gọi tính đến lúc này thôi không còn là kết quả hiện tại) và xoá lịch
    gọi kế tiếp. Lịch sử cuộc gọi vẫn giữ nguyên."""
    get_record_or_404(db, ma_ho_so)
    mon = db.get(Monitoring, ma_ho_so)
    if mon is None:
        mon = Monitoring(ma_ho_so=ma_ho_so)
        db.add(mon)
    now = now_utc()
    mon.resolved_at = now
    mon.next_call_at = None
    mon.monitoring_status = "resolved"
    mon.updated_at = now
    db.commit()
    return {"ma_ho_so": ma_ho_so, "monitoring_status": mon.monitoring_status,
            "resolved_at": mon.resolved_at}


@app.put("/records/{ma_ho_so}/lich-tai-kham")
def update_re_exam(ma_ho_so: str, body: ReExamIn, db: Session = Depends(get_db)):
    """Đặt / đổi / xoá lịch tái khám (mỗi bệnh nhân một lịch)."""
    rec = get_record_or_404(db, ma_ho_so)
    rec.lich_tai_kham = body.lich_tai_kham
    db.commit()
    return {"ma_ho_so": ma_ho_so, "lich_tai_kham": rec.lich_tai_kham}


@app.post("/questions")
def create_question_set(body: QuestionSetIn, db: Session = Depends(get_db)):
    get_record_or_404(db, body.ma_ho_so)
    qset = QuestionSet(ma_ho_so=body.ma_ho_so, status="draft", created_at=now_utc())
    qset.questions = [
        Question(
            text=q.text, order_index=q.order_index,
            expected_var=q.expected_var, red_flag=q.red_flag, approved=False,
        )
        for q in body.questions
    ]
    db.add(qset)
    db.commit()
    db.refresh(qset)
    return {"question_set_id": qset.id, "status": qset.status}


@app.put("/questions/{set_id}/approve")
def approve_question_set(set_id: int, db: Session = Depends(get_db)):
    qset = db.get(QuestionSet, set_id)
    if qset is None:
        raise HTTPException(404, f"question_set {set_id} not found")
    qset.status = "approved"
    qset.approved_at = now_utc()
    for q in qset.questions:
        q.approved = True
    db.commit()
    return {"set_id": qset.id, "question_set_id": qset.id, "status": qset.status}


# ---------------------------------------------------------------------------
# Web demo: frontend-facing endpoints (browser only ever calls OUR endpoints)
# ---------------------------------------------------------------------------

# DB CHECK allows draft|pending|approved; the frontend contract calls it
# "pending_review". Store 'pending', report 'pending_review'.
def _status_label(status: str) -> str:
    return "pending_review" if status == "pending" else status


def q_to_spec(q: Question) -> dict:
    return {
        "id": q.id,
        "text": q.text,
        "expected_var": q.expected_var,
        "answer_type": "boolean" if q.red_flag else "text",
        "source": "core" if q.red_flag else "ai",
        "red_flag": bool(q.red_flag),
    }


@app.get("/his/patients")
def his_patients(db: Session = Depends(get_db)):
    rows = db.scalars(select(BenhAn)).all()
    crs = latest_call_results_map(db)
    mons = monitoring_map(db)
    out = []
    for r in rows:
        mon = mons.get(r.ma_ho_so)
        cr = _current(crs.get(r.ma_ho_so), mon.resolved_at if mon else None)
        out.append({
            "ma_ho_so": r.ma_ho_so,
            "ho_ten": r.ho_ten,
            "gioi_tinh": r.gioi_tinh,
            "tuoi": r.tuoi,
            "phau_thuat": r.phau_thuat,
            "chan_doan": r.chan_doan,
            "ngay_xuat_vien": r.ngay_xuat_vien,
            "bac_si_phu_trach": r.bac_si_phu_trach,
            "lich_tai_kham": r.lich_tai_kham,
            "sdt_benh_nhan": r.sdt_benh_nhan,
            "sdt_nguoi_nha": r.sdt_nguoi_nha,
            "latest_tier": cr.tier if cr else None,
            "latest_summary": cr.summary if cr else None,
            "escalated": bool(cr.escalated) if cr else False,
            # "đã gọi" vs "chưa gọi" for the roster's last-contact column;
            # refused/no_answer renders as "gọi thất bại" instead
            "last_call_at": cr.ended_at if cr else None,
            "last_call_status": cr.call_status if cr else None,
            "next_call_at": mon.next_call_at if mon else None,
        })
    return out


@app.get("/his/patient/{ma_ho_so}")
def his_patient(ma_ho_so: str, db: Session = Depends(get_db)):
    r = get_record_or_404(db, ma_ho_so)
    mon = db.get(Monitoring, ma_ho_so)
    # PHI: never expose so_the_bhyt.
    return {
        "ma_ho_so": r.ma_ho_so,
        "ho_ten": r.ho_ten,
        "gioi_tinh": r.gioi_tinh,
        "tuoi": r.tuoi,
        "ngay_nhap_vien": r.ngay_nhap_vien,
        "ngay_xuat_vien": r.ngay_xuat_vien,
        "ly_do_vao_vien": r.ly_do_vao_vien,
        "phau_thuat": r.phau_thuat,
        "bac_si_phu_trach": r.bac_si_phu_trach,
        "chan_doan": r.chan_doan,
        "sinh_hieu": r.sinh_hieu,
        "thuoc_ke": r.thuoc_ke,
        "ghi_chu_theo_doi": r.ghi_chu_theo_doi,
        "lich_tai_kham": r.lich_tai_kham,
        "sdt_benh_nhan": r.sdt_benh_nhan,
        "sdt_nguoi_nha": r.sdt_nguoi_nha,
        "next_call_at": mon.next_call_at if mon else None,
        "resolved_at": mon.resolved_at if mon else None,
    }


@app.get("/his/appointments")
def his_appointments(db: Session = Depends(get_db)):
    """Re-exam appointments derived from each record's lich_tai_kham."""
    rows = db.scalars(select(BenhAn).where(BenhAn.lich_tai_kham.is_not(None))).all()
    out = [{
        "ma_ho_so": r.ma_ho_so, "ho_ten": r.ho_ten, "chan_doan": r.chan_doan,
        "phau_thuat": r.phau_thuat, "bac_si_phu_trach": r.bac_si_phu_trach,
        "date": r.lich_tai_kham, "specialty": "Tái khám sau phẫu thuật",
    } for r in rows]
    out.sort(key=lambda a: str(a["date"]))
    return out


@app.get("/his/performance")
def his_performance(db: Session = Depends(get_db)):
    """Real call metrics computed from call_results / monitoring."""
    calls = db.scalars(select(CallResult)).all()
    by_tier = {"red": 0, "amber": 0, "green": 0}
    escalated = 0
    for cr in calls:
        if cr.tier in by_tier:
            by_tier[cr.tier] += 1
        if cr.escalated:
            escalated += 1
    total = len(calls)
    n_patients = db.scalar(select(func.count()).select_from(BenhAn))
    overdue = db.scalar(
        select(func.count()).select_from(Monitoring)
        .where(Monitoring.next_call_at < now_utc())
    )
    return {
        "total_calls": total, "by_tier": by_tier, "escalated": escalated,
        "patients": n_patients, "overdue": overdue,
        "escalation_rate": round(escalated / total * 100, 1) if total else 0,
    }


@app.get("/his/notifications")
def his_notifications(db: Session = Depends(get_db)):
    """Derived alerts: escalated/red cases and overdue monitoring."""
    recs = {r.ma_ho_so: r for r in db.scalars(select(BenhAn)).all()}
    crs = latest_call_results_map(db)
    mons = monitoring_map(db)
    groups = []
    red = []
    for r in recs.values():
        mon = mons.get(r.ma_ho_so)
        cr = _current(crs.get(r.ma_ho_so), mon.resolved_at if mon else None)
        if cr and (cr.tier == "red" or cr.escalated):
            red.append({"ma_ho_so": r.ma_ho_so,
                        "text": f"{r.ho_ten} — nguy cơ cao ({cr.summary or 'cần bác sĩ xem'})"})
    if red:
        groups.append({"group": "Bệnh nhân nguy cơ cao", "tone": "red", "items": red})

    overdue = []
    for m in db.scalars(select(Monitoring).where(Monitoring.next_call_at < now_utc())).all():
        rec = recs.get(m.ma_ho_so)
        overdue.append({"ma_ho_so": m.ma_ho_so,
                        "text": f"{rec.ho_ten if rec else m.ma_ho_so} — quá hạn cuộc gọi theo dõi"})
    if overdue:
        groups.append({"group": "Theo dõi quá hạn", "tone": "amber", "items": overdue})
    return groups


@app.get("/his/templates")
def his_templates(db: Session = Depends(get_db)):
    rows = db.execute(text(
        "SELECT id, disease, name, version, active, assign, questions, history "
        "FROM question_templates ORDER BY id"
    )).mappings().all()
    return [dict(r) for r in rows]


@app.post("/his/templates")
def create_template(body: TemplateIn, db: Session = Depends(get_db)):
    new_id = db.execute(
        text("INSERT INTO question_templates "
             "(disease, name, version, active, assign, questions, history) "
             "VALUES (:d, :n, 'v1', :a, :asg, CAST(:q AS JSONB), CAST('[]' AS JSONB)) "
             "RETURNING id"),
        {"d": body.disease, "n": body.name, "a": body.active, "asg": body.assign,
         "q": json.dumps(body.questions, ensure_ascii=False)},
    ).scalar()
    db.commit()
    return {"id": new_id}


@app.put("/his/templates/{tid}")
def update_template(tid: int, body: TemplateIn, db: Session = Depends(get_db)):
    res = db.execute(
        text("UPDATE question_templates "
             "SET disease = :d, name = :n, active = :a, assign = :asg, "
             "    questions = CAST(:q AS JSONB) "
             "WHERE id = :id"),
        {"d": body.disease, "n": body.name, "a": body.active, "asg": body.assign,
         "q": json.dumps(body.questions, ensure_ascii=False), "id": tid},
    )
    db.commit()
    if res.rowcount == 0:
        raise HTTPException(404, f"template {tid} not found")
    return {"id": tid}


@app.delete("/his/templates/{tid}")
def delete_template(tid: int, db: Session = Depends(get_db)):
    db.execute(text("DELETE FROM question_templates WHERE id = :id"), {"id": tid})
    db.commit()
    return {"deleted": tid}


@app.get("/his/escalation-rules")
def his_escalation_rules(db: Session = Depends(get_db)):
    rows = db.execute(text(
        "SELECT id, name, active, when_text, risk, recipients, auto_appt, approval "
        "FROM escalation_rules ORDER BY order_index, id"
    )).mappings().all()
    return [dict(r) for r in rows]


@app.get("/his/patient/{ma_ho_so}/call-preview")
def call_preview(ma_ho_so: str, db: Session = Depends(get_db)):
    """Read-only script of what the AI call will cover for this patient:
    the approved question set if one exists, otherwise the offline template
    draft. No DB write — safe for doctors to preview any time."""
    rec = get_record_or_404(db, ma_ho_so)
    qset = approved_question_set(db, ma_ho_so)
    if qset:
        source = "approved"
        questions = [
            {"text": q.text, "expected_var": q.expected_var, "red_flag": bool(q.red_flag)}
            for q in qset.questions
        ]
    else:
        source = "template"
        drafts = build_question_set({
            "phau_thuat": rec.phau_thuat, "thuoc_ke": rec.thuoc_ke,
            "ghi_chu_theo_doi": rec.ghi_chu_theo_doi,
        })
        questions = [
            {"text": d["text"], "expected_var": d["expected_var"], "red_flag": bool(d["red_flag"])}
            for d in drafts
        ]
    ten = rec.ho_ten or "anh/chị"
    # ponytail: greeting/closing are presentation copy, not stored — tweak freely.
    return {
        "source": source,
        "greeting": f"Dạ em chào {ten}, em là trợ lý theo dõi của bệnh viện, "
                    f"gọi để hỏi thăm sức khỏe của {ten} sau khi xuất viện ạ. "
                    "Em xin phép hỏi vài câu ngắn nhé.",
        "questions": questions,
        "closing": "Dạ em cảm ơn đã dành thời gian ạ. Nếu có dấu hiệu bất thường hoặc "
                   f"nặng hơn, {ten} hãy liên hệ ngay bác sĩ phụ trách hoặc gọi 115. "
                   f"Chúc {ten} mau khỏe ạ.",
    }


@app.post("/questions/generate")
def questions_generate(body: GenerateIn, db: Session = Depends(get_db)):
    rec = get_record_or_404(db, body.ma_ho_so)
    drafts = build_question_set({
        "phau_thuat": rec.phau_thuat,
        "thuoc_ke": rec.thuoc_ke,
        "ghi_chu_theo_doi": rec.ghi_chu_theo_doi,
    })
    qset = QuestionSet(ma_ho_so=body.ma_ho_so, status="pending", created_at=now_utc())
    qset.questions = [
        Question(
            text=d["text"], order_index=d["order_index"],
            expected_var=d["expected_var"], red_flag=d["red_flag"], approved=False,
        )
        for d in drafts
    ]
    db.add(qset)
    db.commit()
    db.refresh(qset)
    return {
        "set_id": qset.id,
        "status": _status_label(qset.status),
        "questions": [q_to_spec(q) for q in qset.questions],
    }


@app.put("/questions/{set_id}")
def questions_save(set_id: int, body: QuestionsSaveIn, db: Session = Depends(get_db)):
    qset = db.get(QuestionSet, set_id)
    if qset is None:
        raise HTTPException(404, f"question_set {set_id} not found")

    # Reject deletion of core (red_flag) items: every existing core id must remain.
    existing_core = {q.id for q in qset.questions if q.red_flag}
    incoming_ids = {q.id for q in body.questions if q.id is not None}
    missing = existing_core - incoming_ids
    if missing:
        raise HTTPException(400, f"cannot delete core questions: {sorted(missing)}")

    prior_core = existing_core  # ids that must stay red_flag
    for q in list(qset.questions):  # clear then rebuild in submitted order
        db.delete(q)
    qset.questions = [
        Question(
            text=item.text, order_index=i, expected_var=item.expected_var,
            red_flag=(item.source == "core") or bool(item.red_flag)
                     or (item.id in prior_core),
            approved=False,
        )
        for i, item in enumerate(body.questions)
    ]
    db.commit()
    db.refresh(qset)
    return {
        "set_id": qset.id,
        "status": _status_label(qset.status),
        "questions": [q_to_spec(q) for q in qset.questions],
    }


# --- Patient question set (case-page panel): disease-required + patient extras ---
@app.get("/his/patient/{ma_ho_so}/question-set")
def get_patient_question_set(ma_ho_so: str, db: Session = Depends(get_db)):
    rec = get_record_or_404(db, ma_ho_so)
    disease = match_disease(rec)
    qset = latest_question_set(db, ma_ho_so)
    extras = [
        {"id": q.id, "text": q.text, "expected_var": q.expected_var}
        for q in (qset.questions if qset else []) if not q.red_flag
    ]
    return {
        "disease": disease,
        "required": [{"text": q.get("text")} for q in _required_questions(db, disease)],
        "patient": extras,
        "set_id": qset.id if qset else None,
        "status": qset.status if qset else None,
    }


@app.post("/his/patient/{ma_ho_so}/question-set")
def save_patient_question_set(
    ma_ho_so: str, body: PatientQuestionSetIn, db: Session = Depends(get_db)
):
    """Persist ONLY the patient's set: disease-required questions (red_flag,
    locked) + the patient-specific extras the doctor kept/accepted. Saved as an
    approved set so the VoiceBot picks it up via call-preview / questions_fetch.
    The disease default template is never modified here."""
    rec = get_record_or_404(db, ma_ho_so)
    disease = match_disease(rec)

    qset = latest_question_set(db, ma_ho_so)
    if qset is None:
        qset = QuestionSet(ma_ho_so=ma_ho_so, status="approved", created_at=now_utc())
        db.add(qset)
    else:
        for q in list(qset.questions):
            db.delete(q)
        qset.questions = []
    db.flush()

    merged: list[Question] = []
    for i, rq in enumerate(_required_questions(db, disease)):
        merged.append(Question(text=rq.get("text"), order_index=i,
                               expected_var=rq.get("expected_var"), red_flag=True, approved=True))
    base = len(merged)
    for j, pq in enumerate(body.questions):
        merged.append(Question(text=pq.text, order_index=base + j,
                               expected_var=pq.expected_var, red_flag=False, approved=True))
    qset.questions = merged
    qset.status = "approved"
    qset.approved_at = now_utc()
    db.commit()
    db.refresh(qset)
    return {"set_id": qset.id, "status": qset.status, "count": len(merged)}


@app.post("/questions/ai-suggest")
def questions_ai_suggest(body: GenerateIn, db: Session = Depends(get_db)):
    """AI-suggested extra questions for preview — NOT saved. Deduped against the
    disease template (required + optional) and the patient's current set."""
    rec = get_record_or_404(db, body.ma_ho_so)
    disease = match_disease(rec)
    existing = {_norm_q(q.get("text")) for q in _active_template_questions(db, disease)}
    qset = latest_question_set(db, body.ma_ho_so)
    if qset:
        existing |= {_norm_q(q.text) for q in qset.questions}
    existing.discard("")
    candidates = ai_suggest_questions(
        {"disease": disease, "phau_thuat": rec.phau_thuat, "chan_doan": rec.chan_doan,
         "thuoc_ke": rec.thuoc_ke, "ghi_chu_theo_doi": rec.ghi_chu_theo_doi},
        existing,
    )
    return {"disease": disease, "candidates": candidates}


def _norm_q(text: str | None) -> str:
    return " ".join((text or "").lower().split())


@app.get("/his/patient/{ma_ho_so}/call-results")
def patient_call_results(ma_ho_so: str, db: Session = Depends(get_db)):
    rows = db.scalars(
        select(CallResult)
        .where(CallResult.ma_ho_so == ma_ho_so)
        .order_by(CallResult.id.desc())
    ).all()
    out = []
    for cr in rows:
        out.append({
            "session_id": cr.session_id,
            "ended_at": cr.ended_at,
            "tier": cr.tier,
            "call_status": cr.call_status,
            "summary": cr.summary,
            "escalated": bool(cr.escalated),
            "answers": _build_answers(db, cr),
            "transcript": cr.transcript if isinstance(cr.transcript, list) else [],
        })
    return out


def _build_answers(db: Session, cr: CallResult) -> list[dict]:
    # raw_answers / extracted are JSONB maps keyed by expected_var.
    # ponytail: assumes dict shape; non-dict raw collapses to None.
    raw = cr.raw_answers if isinstance(cr.raw_answers, dict) else {}
    extracted = cr.extracted if isinstance(cr.extracted, dict) else {}
    if not raw and not extracted:
        return []  # nothing collected (e.g. failed call) — no empty question list
    # Signals only, never the full question list: show what was actually
    # extracted (raw Q→A pairs only when nothing was), labeled by the matching
    # question when the key is a known expected_var, else the key itself.
    qset = db.get(QuestionSet, cr.question_set_id) if cr.question_set_id else None
    if qset:
        labels = {q.expected_var: q.text for q in qset.questions if q.expected_var}
    else:
        labels = {q["expected_var"]: q["text"] for q in [*CORE, *TEMPLATE]}
    keys = list(extracted) or list(raw)
    return [
        {"question": labels.get(k), "expected_var": k,
         "raw": raw.get(k), "value": extracted.get(k)}
        for k in keys
    ]


@app.post("/his/call-demo/save")
def call_demo_save(body: CallDemoIn, db: Session = Depends(get_db)):
    """Persist a finished demo call: store the transcript, then summarise +
    classify + extract per-question signals (GPT, heuristic fallback) and save
    as a call_results row so it shows up in the patient's case history."""
    get_record_or_404(db, body.ma_ho_so)
    from app import call_analysis
    qset = approved_question_set(db, body.ma_ho_so)
    if qset:
        # Questions without an expected_var still take part — GPT names the
        # signal itself (a short label), so extraction never silently skips.
        qspecs = [{"text": q.text, "expected_var": q.expected_var}
                  for q in qset.questions]
    else:
        # ponytail: no approved set → extract the deterministic core+generic vars.
        # AI-personalized extras still land in transcript/summary, just unkeyed.
        qspecs = [{"text": q["text"], "expected_var": q["expected_var"]}
                  for q in [*CORE, *TEMPLATE]]
    result = call_analysis.analyze(body.transcript, qspecs)

    raw: dict = {}
    for a in body.answers or []:
        key = a.get("expected_var") or a.get("question")
        if key:
            raw[key] = a.get("answer")
    # extracted holds ONLY per-variable signals (GPT). raw keeps the full Q→A
    # pairs — never dump it into extracted or the case page shows the whole call.
    extracted = result.get("extracted") or None
    # refused / no_answer: no assessment (tier stays NULL → "chưa đánh giá"),
    # no collected data — only the transcript and the failure reason survive.
    call_status = result.get("call_status") or "completed"
    failed = call_status != "completed"

    cr = CallResult(
        ma_ho_so=body.ma_ho_so,
        question_set_id=body.question_set_id or (qset.id if qset else None),
        session_id="demo-" + now_utc().strftime("%Y%m%d%H%M%S"),
        started_at=now_utc(),
        ended_at=now_utc(),
        raw_answers=None if failed else (raw or None),
        extracted=None if failed else extracted,
        transcript=body.transcript,
        tier=result["tier"],
        call_status=call_status,
        summary=result["summary"],
        escalated=result["escalated"],
        escalation_channel="Bác sĩ phụ trách" if result["escalated"] else None,
    )
    db.add(cr)
    db.commit()
    db.refresh(cr)
    return {
        "call_id": cr.id, "tier": result["tier"], "summary": result["summary"],
        "escalated": result["escalated"], "call_status": call_status,
        "source": result["source"],
    }


_MANUAL_OUTCOMES = {
    # outcome -> (tier, call_status, default summary)
    "green": ("green", "completed", "Ổn định — tiếp tục theo dõi."),
    "amber": ("amber", "completed", "Cần theo dõi thêm."),
    "red": ("red", "completed", "Nguy cơ cao — cần can thiệp."),
    "no_contact": (None, "no_answer", "Không liên lạc được với bệnh nhân."),
}


@app.post("/his/call-manual/save")
def call_manual_save(body: ManualCallIn, db: Session = Depends(get_db)):
    """A nurse/doctor dialed the patient themselves and picked the outcome —
    store it as a call_results row (no AI analysis; the human already decided),
    so the patient's status updates exactly like after an AI call."""
    get_record_or_404(db, body.ma_ho_so)
    if body.outcome not in _MANUAL_OUTCOMES:
        raise HTTPException(422, f"unknown outcome '{body.outcome}'")
    tier, call_status, default_summary = _MANUAL_OUTCOMES[body.outcome]
    cr = CallResult(
        ma_ho_so=body.ma_ho_so,
        session_id="manual-" + now_utc().strftime("%Y%m%d%H%M%S"),
        started_at=now_utc(),
        ended_at=now_utc(),
        tier=tier,
        call_status=call_status,
        summary=(body.note or "").strip() or default_summary,
        escalated=tier == "red",
        escalation_channel="Bác sĩ phụ trách" if tier == "red" else None,
    )
    db.add(cr)
    db.commit()
    db.refresh(cr)
    return {"call_id": cr.id, "tier": tier, "call_status": call_status}


def _patient_questions(db: Session, ma_ho_so: str, rec: BenhAn) -> list[str]:
    """Approved question set for the patient, else the generated template —
    same source questions_fetch uses, but without the 5-slot cap (GPT drives)."""
    qset = approved_question_set(db, ma_ho_so)
    if qset:
        return [q.text for q in qset.questions]
    return [d["text"] for d in build_question_set({
        "phau_thuat": rec.phau_thuat, "thuoc_ke": rec.thuoc_ke,
        "ghi_chu_theo_doi": rec.ghi_chu_theo_doi,
    })]


@app.post("/bff/conversation")
def bff_conversation(body: ConversationIn, db: Session = Depends(get_db)):
    rec = get_record_or_404(db, body.ma_ho_so)
    # Questions + patient info only matter when GPT builds the system prompt (first turn).
    questions = _patient_questions(db, body.ma_ho_so, rec) if body.first_turn else []
    return gptbot.converse(
        text=body.text, session_id=body.session_id, ma_ho_so=body.ma_ho_so,
        first_turn=body.first_turn, questions=questions,
        patient={
            "ho_ten": rec.ho_ten or "",
            "gioi_tinh": rec.gioi_tinh or "",
            "tuoi": rec.tuoi,
            "bac_si_phu_trach": rec.bac_si_phu_trach or "",
            "phau_thuat": rec.phau_thuat or "",
            "ngay_xuat_vien": str(rec.ngay_xuat_vien) if rec.ngay_xuat_vien else "",
            "lich_tai_kham": str(rec.lich_tai_kham) if rec.lich_tai_kham else "",
        },
    )


# --- SmartVoice STT/TTS BFF (creds server-side; browser falls back to Web Speech) ---
async def _warm_opening_tts():
    """Pre-generate (and cache) the fixed consent opening so the first bot
    line plays instantly instead of waiting on VNPT generation."""
    try:
        await smartvoice.tts(gptbot.OPENING)
    except Exception:  # noqa: BLE001 — warmup is best-effort
        pass


@app.get("/bff/voice-config")
async def voice_config():
    # The demo page fetches this on load — the user is still on the patient
    # picker, which is exactly when to warm the opening line.
    if settings.smartvoice_tts_configured:
        asyncio.create_task(_warm_opening_tts())
    return {"stt": settings.smartvoice_stt_configured, "tts": settings.smartvoice_tts_configured}


@app.post("/bff/stt")
async def bff_stt(audio: UploadFile = File(...), client_session: str = Form("")):
    try:
        text = await smartvoice.stt(await audio.read(), audio.filename or "audio.wav", client_session)
    except Exception as exc:  # noqa: BLE001 — surface upstream failure to caller
        raise HTTPException(502, f"SmartVoice STT error: {exc}")
    return {"text": text}


@app.post("/bff/tts")
async def bff_tts(body: TtsIn):
    try:
        link = await smartvoice.tts(body.text)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"SmartVoice TTS error: {exc}")
    return {"audio_link": link}


# SPA served last so explicit API routes above take precedence.
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
