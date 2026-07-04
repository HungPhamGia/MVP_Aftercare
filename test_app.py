"""All-in-one automated test suite: hits the real Supabase DB through the app.

Run: python test_app.py   (or pytest, if installed)
Needs DATABASE_URL in .env and at least one record in the DB.

Three groups:
- offline: call_analysis heuristic, no DB/network
- read-only smoke: live DB reachable, bot contract, no PHI leak
- write endpoints: every db.commit() is a savepoint inside one outer
  transaction rolled back per test (join_transaction_mode="create_savepoint")
  — nothing sticks in the live DB.
"""
import warnings
from contextlib import contextmanager

warnings.filterwarnings("ignore")  # silence httpx/testclient deprecation noise

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import settings

settings.OPENAI_API_KEY = ""  # deterministic + offline: template questions, heuristic analysis

from app import call_analysis
from app.db import engine, get_db
from app.main import app
from app.questions_gen import CORE, TEMPLATE

client = TestClient(app)

PHI_FORBIDDEN = {"so_the_bhyt", "chan_doan", "xet_nghiem"}
EXPECTED_FETCH_KEYS = {"ho_ten", "phau_thuat", "ngay_hau_phau", "bac_si_phu_trach"}


@contextmanager
def rollback_db():
    """Session whose commits are savepoints inside one rolled-back transaction."""
    conn = engine.connect()
    trans = conn.begin()
    session = Session(bind=conn, join_transaction_mode="create_savepoint",
                      autoflush=False, expire_on_commit=False)
    app.dependency_overrides[get_db] = lambda: session
    try:
        yield session
    finally:
        app.dependency_overrides.pop(get_db, None)
        session.close()
        trans.rollback()
        conn.close()


def first_mhs() -> str:
    recs = client.get("/records").json()
    assert recs, "live DB has no records to test against"
    return recs[0]["ma_ho_so"]


def patient_row(mhs: str) -> dict:
    return next(r for r in client.get("/his/patients").json() if r["ma_ho_so"] == mhs)


# --- offline: classification heuristic (no DB) ---
def test_call_analysis_heuristic():
    """Offline: heuristic phân loại đúng 4 ca — nguy cơ cao (red), ổn định (green), không trả lời, từ chối."""
    red = call_analysis.analyze([
        {"who": "Trợ lý", "text": "Anh có sốt không?"},
        {"who": "Bệnh nhân", "text": "Có, tôi sốt 38.7 và vết mổ chảy dịch."},
    ])
    assert red["tier"] == "red" and red["escalated"], red
    green = call_analysis.analyze([
        {"who": "Trợ lý", "text": "?"},
        {"who": "Bệnh nhân", "text": "Tôi khỏe, ăn uống tốt."},
    ])
    assert green["tier"] == "green" and green["call_status"] == "completed", green
    na = call_analysis.analyze([{"who": "Trợ lý", "text": "Xin chào..."}])
    assert na["call_status"] == "no_answer" and na["tier"] is None, na
    rf = call_analysis.analyze([
        {"who": "Trợ lý", "text": "...đồng ý chứ ạ?"},
        {"who": "Bệnh nhân", "text": "Tôi từ chối."},
    ])
    assert rf["call_status"] == "refused" and rf["tier"] is None, rf


# --- read-only live smoke ---
def test_connection_lists_records():
    """Kết nối DB thật: GET /records trả về danh sách hồ sơ với đủ các cột chính."""
    r = client.get("/records")
    assert r.status_code == 200, r.text
    recs = r.json()
    assert isinstance(recs, list) and recs, "no records returned from live DB"
    assert {"ma_ho_so", "ho_ten", "phau_thuat", "ngay_xuat_vien", "tier"} <= recs[0].keys()


def test_patient_fetch_real_record():
    """Contract cho voicebot: /his/patient/fetch trả đúng 4 biến, không lộ PHI (BHYT, chẩn đoán ICD, xét nghiệm)."""
    r = client.post("/his/patient/fetch", json={"set_variables": {"ma_ho_so": first_mhs()}})
    assert r.status_code == 200, r.text
    sv = r.json()["set_variables"]
    assert set(sv) == EXPECTED_FETCH_KEYS, set(sv)
    assert PHI_FORBIDDEN.isdisjoint(sv), f"PHI leaked: {PHI_FORBIDDEN & set(sv)}"
    assert sv["ho_ten"], "real record should have a name"


def test_full_record_and_history():
    """GET /records/{id} trả hồ sơ đầy đủ + kết quả cuộc gọi mới nhất; lịch sử cuộc gọi là một danh sách."""
    mhs = first_mhs()
    r = client.get(f"/records/{mhs}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["record"]["ma_ho_so"] == mhs
    assert "latest_call_result" in body
    h = client.get(f"/records/{mhs}/call-results")
    assert h.status_code == 200 and isinstance(h.json(), list)


def test_unknown_record_404():
    """Mã hồ sơ không tồn tại → trả 404 (không crash, không lộ thông tin)."""
    r = client.post("/his/patient/fetch", json={"set_variables": {"ma_ho_so": "DOES-NOT-EXIST"}})
    assert r.status_code == 404, r.text


# --- write endpoints (rollback, nothing sticks) ---
def test_validation_and_404():
    """Validate đầu vào: body thiếu ma_ho_so → 400; duyệt/sửa bộ câu hỏi, template không tồn tại → 404."""
    with rollback_db():
        assert client.post("/his/call-result", json={"set_variables": {}}).status_code == 400
        assert client.put("/questions/99999999/approve").status_code == 404
        assert client.put("/his/templates/99999999", json={
            "disease": "X", "name": "X", "questions": []}).status_code == 404


def test_call_result_writeback():
    """Bot ghi kết quả cuộc gọi: raw_answers lưu đúng đáp án (loại bỏ ma_ho_so/session_id), lịch sử tăng thêm 1."""
    with rollback_db():
        mhs = first_mhs()
        before = len(client.get(f"/records/{mhs}/call-results").json())
        r = client.post("/his/call-result", json={"set_variables": {
            "ma_ho_so": mhs, "session_id": "test-s1", "sot": "không", "dau": "có"}})
        assert r.status_code == 200, r.text
        cr = client.get(f"/records/{mhs}").json()["latest_call_result"]
        assert cr["session_id"] == "test-s1"
        assert cr["raw_answers"] == {"sot": "không", "dau": "có"}  # ids stripped
        assert len(client.get(f"/records/{mhs}/call-results").json()) == before + 1


def test_record_updates_and_phi():
    """Cập nhật ghi chú / thuốc / lịch tái khám rồi đọc lại đúng; chi tiết bệnh nhân không lộ số thẻ BHYT."""
    with rollback_db():
        mhs = first_mhs()
        assert client.put(f"/records/{mhs}/ghi-chu",
                          json={"ghi_chu_theo_doi": "test note"}).status_code == 200
        assert client.put(f"/records/{mhs}/thuoc",
                          json={"thuoc_ke": "test thuốc"}).status_code == 200
        assert client.put(f"/records/{mhs}/lich-tai-kham",
                          json={"lich_tai_kham": "2099-01-15"}).status_code == 200
        p = client.get(f"/his/patient/{mhs}").json()
        assert p["ghi_chu_theo_doi"] == "test note"
        assert p["thuoc_ke"] == "test thuốc"
        assert p["lich_tai_kham"] == "2099-01-15"
        assert "so_the_bhyt" not in p, "PHI leaked"


def test_call_demo_close_and_reschedule():
    """Vòng đời ca: cuộc gọi có dấu hiệu nguy hiểm → red; đóng ca → về 'chưa đánh giá'; đặt lịch gọi mới → active."""
    with rollback_db():
        mhs = first_mhs()
        # red-flag call → heuristic classifies red + escalates
        r = client.post("/his/call-demo/save", json={"ma_ho_so": mhs, "transcript": [
            {"who": "Trợ lý", "text": "Anh có sốt không?"},
            {"who": "Bệnh nhân", "text": "Tôi sốt 38.7 và vết mổ chảy dịch."},
        ]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["tier"] == "red" and body["escalated"] and body["source"] == "heuristic"
        assert patient_row(mhs)["latest_tier"] == "red"

        # closing the case discards the call → back to "chưa đánh giá"
        r = client.post(f"/records/{mhs}/close")
        assert r.status_code == 200 and r.json()["monitoring_status"] == "resolved"
        assert patient_row(mhs)["latest_tier"] is None

        # scheduling a new call re-activates monitoring, tier stays None
        r = client.put(f"/records/{mhs}/monitoring",
                       json={"next_call_at": "2099-01-01T09:00:00Z"})
        assert r.status_code == 200 and r.json()["monitoring_status"] == "active"
        row = patient_row(mhs)
        assert str(row["next_call_at"]).startswith("2099-01-01") and row["latest_tier"] is None


def test_call_demo_no_answer():
    """Cuộc gọi bệnh nhân không nói gì → no_answer: không phân tầng, không lưu dữ liệu thu thập."""
    with rollback_db():
        mhs = first_mhs()
        r = client.post("/his/call-demo/save", json={"ma_ho_so": mhs, "transcript": [
            {"who": "Trợ lý", "text": "Alo, anh nghe rõ không ạ?"},
        ]})
        assert r.status_code == 200, r.text
        assert r.json()["call_status"] == "no_answer" and r.json()["tier"] is None
        cr = client.get(f"/records/{mhs}").json()["latest_call_result"]
        assert cr["raw_answers"] is None and cr["extracted"] is None


def test_question_lifecycle():
    """Bộ câu hỏi: sinh (5 core + 3 template) → chặn xóa câu core → thêm câu → duyệt → bot nhận tối đa 5 câu."""
    with rollback_db():
        mhs = first_mhs()
        r = client.post("/questions/generate", json={"ma_ho_so": mhs})
        assert r.status_code == 200, r.text
        gen = r.json()
        assert gen["status"] == "pending_review"
        assert len(gen["questions"]) == len(CORE) + len(TEMPLATE)  # offline template
        set_id = gen["set_id"]

        # deleting a core (red-flag) question is rejected
        r = client.put(f"/questions/{set_id}", json={"questions": gen["questions"][1:]})
        assert r.status_code == 400 and "core" in r.text

        # keep all + add one custom → ok
        edited = gen["questions"] + [{"text": "Anh/chị ngủ có ngon giấc không?",
                                      "expected_var": "giac_ngu", "source": "ai"}]
        r = client.put(f"/questions/{set_id}", json={"questions": edited})
        assert r.status_code == 200 and len(r.json()["questions"]) == len(edited)

        assert client.put(f"/questions/{set_id}/approve").json()["status"] == "approved"

        # bot now gets the approved set, flattened and capped at 5
        sv = client.post("/his/questions/fetch",
                         json={"set_variables": {"ma_ho_so": mhs}}).json()["set_variables"]
        assert sv["cau_hoi_1"] == CORE[0]["text"] and sv["so_cau_hoi"] == "5"
        assert client.get(f"/his/patient/{mhs}/call-preview").json()["source"] == "approved"


def test_patient_question_set():
    """Bộ câu hỏi riêng của bệnh nhân: câu bắt buộc theo bệnh + câu bác sĩ thêm, lưu xong tự ở trạng thái approved."""
    with rollback_db():
        mhs = first_mhs()
        before = client.get(f"/his/patient/{mhs}/question-set").json()
        r = client.post(f"/his/patient/{mhs}/question-set", json={"questions": [
            {"text": "Anh/chị có tập vận động theo hướng dẫn không?", "expected_var": "van_dong"},
        ]})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "approved"
        assert r.json()["count"] == len(before["required"]) + 1
        after = client.get(f"/his/patient/{mhs}/question-set").json()
        assert any("vận động" in q["text"] for q in after["patient"])


def test_templates_crud():
    """Template câu hỏi theo bệnh: tạo → sửa → đọc lại đúng → xóa sạch."""
    with rollback_db():
        r = client.post("/his/templates", json={
            "disease": "Test bệnh", "name": "Bộ test", "active": False,
            "questions": [{"text": "Câu test?", "required": True}]})
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        assert client.put(f"/his/templates/{tid}", json={
            "disease": "Test bệnh", "name": "Bộ test v2", "active": False,
            "questions": []}).status_code == 200
        tpl = next(t for t in client.get("/his/templates").json() if t["id"] == tid)
        assert tpl["name"] == "Bộ test v2"
        assert client.delete(f"/his/templates/{tid}").json() == {"deleted": tid}
        assert not any(t["id"] == tid for t in client.get("/his/templates").json())


TESTS = [
    test_call_analysis_heuristic,
    test_connection_lists_records,
    test_patient_fetch_real_record,
    test_full_record_and_history,
    test_unknown_record_404,
    test_validation_and_404,
    test_call_result_writeback,
    test_record_updates_and_phi,
    test_call_demo_close_and_reschedule,
    test_call_demo_no_answer,
    test_question_lifecycle,
    test_patient_question_set,
    test_templates_crud,
]

if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")  # console Windows (cp1252) in được tiếng Việt
    for i, t in enumerate(TESTS, 1):
        print(f"[{i}/{len(TESTS)}] {t.__doc__}")
        t()
        print(f"      ok - {t.__name__}")
    print(f"\nok - {len(TESTS)}/{len(TESTS)} test pass, DB không bị thay đổi")
