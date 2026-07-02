/* =========================================================================
   AfterCare · api.js — the ONLY data source. Talks to our FastAPI endpoints
   and adapts responses into the shapes the pages use. No mock fallback:
   data.js holds config only.
   ========================================================================= */

const API = {
  async get(path) {
    const r = await fetch(path, { headers: { "Accept": "application/json" } });
    if (!r.ok) throw new Error(`${path} → ${r.status}`);
    return r.json();
  },
  async send(method, path, body) {
    const r = await fetch(path, {
      method, headers: { "Content-Type": "application/json" },
      body: body == null ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`${path} → ${r.status}`);
    return r.json();
  },
  post(path, body) { return this.send("POST", path, body); },
  put(path, body) { return this.send("PUT", path, body); },
  del(path) { return this.send("DELETE", path); },
};

/* ---- mappers ---------------------------------------------------------- */
function tierToRisk(t) { return (t === "red" || t === "amber" || t === "green") ? t : "unknown"; }
function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return d ? `${d}/${m}/${y}` : String(iso);
}
function daysSince(iso) {
  if (!iso) return 0;
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return diff > 0 ? diff : 0;
}
/* whole days from `fromIso` to `toIso` (post-op day of a call, from discharge) */
function daysBetween(fromIso, toIso) {
  if (!fromIso || !toIso) return null;
  const d = Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86400000);
  return d >= 0 ? d : null;
}
/* monitoring next_call_at → the {date,time,status} shape the UI expects.
   A call is either scheduled or not — "overdue" is a separate flag (used by the
   work board), never a status the roster shows as "quá hạn gọi". */
function mapNextCall(iso) {
  if (!iso) return { date: "—", time: "", status: "none", iso: null, overdue: false };
  const d = new Date(iso);
  const date = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const overdue = d.getTime() < Date.now();
  return { date, time, status: "scheduled", iso, overdue };
}

/* /his/patients row → PATIENTS[] item */
function mapRosterRow(r) {
  const risk = tierToRisk(r.latest_tier);
  const nextCall = mapNextCall(r.next_call_at);
  return {
    mrn: r.ma_ho_so, name: r.ho_ten || "—",
    age: r.tuoi != null ? r.tuoi : "—", sex: r.gioi_tinh || "",
    diagnosis: r.chan_doan || r.phau_thuat || "—",
    surgery: r.phau_thuat || "—", group: "Hậu phẫu", risk,
    doctor: r.bac_si_phu_trach || "Chưa phân công",
    dischargeDate: fmtDate(r.ngay_xuat_vien), day: daysSince(r.ngay_xuat_vien),
    reExam: fmtDate(r.lich_tai_kham),
    phonePatient: r.sdt_benh_nhan || "—", phoneFamily: r.sdt_nguoi_nha || "—",
    lastContact: r.last_call_at ? "Đã gọi" : "Chưa gọi",
    reason: r.latest_summary || r.phau_thuat || "Theo dõi sau xuất viện",
    summary: r.latest_summary || r.phau_thuat || "",
    escalated: !!r.escalated,
    nextCall, overdue: !!nextCall.overdue,
    needsReview: risk === "red" || risk === "amber" || !!r.escalated,
  };
}

function callAnswers(c) {
  return (c.answers || []).map(a => ({
    label: a.question || a.expected_var || "—",
    value: a.value != null ? String(a.value) : (a.raw != null ? String(a.raw) : "—"),
  }));
}

/* /his/patient/{id} (+ call-results) → object case.js expects */
function buildCaseFromApi(d, calls) {
  // A closed case (resolved_at) drops calls up to that moment from the *current*
  // state → patient shows "chưa đánh giá", but the call history stays visible.
  const resolved = d.resolved_at ? new Date(d.resolved_at).getTime() : 0;
  const relevant = calls.filter(c => c.ended_at && new Date(c.ended_at).getTime() > resolved);
  const hasCalls = relevant.length > 0;
  const cur = hasCalls ? relevant[0] : null;
  const risk = hasCalls ? tierToRisk(cur.tier) : "unknown";
  const nextCall = mapNextCall(d.next_call_at);
  const p = {
    mrn: d.ma_ho_so, name: d.ho_ten || "—",
    age: d.tuoi != null ? d.tuoi : "—", sex: d.gioi_tinh || "",
    diagnosis: d.chan_doan || "—", surgery: d.phau_thuat || "—",
    reasonAdmission: d.ly_do_vao_vien || "—", vitals: d.sinh_hieu || "—",
    meds: d.thuoc_ke || "—", followNote: d.ghi_chu_theo_doi || "—",
    admitDate: fmtDate(d.ngay_nhap_vien), dischargeDate: fmtDate(d.ngay_xuat_vien),
    day: daysSince(d.ngay_xuat_vien), reExam: fmtDate(d.lich_tai_kham),
    reExamIso: d.lich_tai_kham ? String(d.lich_tai_kham).slice(0, 10) : "",
    group: "Hậu phẫu", risk, doctor: d.bac_si_phu_trach || "Chưa phân công",
    phonePatient: d.sdt_benh_nhan || "—", phoneFamily: d.sdt_nguoi_nha || "—",
    reason: d.ghi_chu_theo_doi || "Theo dõi sau xuất viện",
    summary: hasCalls ? (cur.summary || "") : "",
    nextCall,
  };
  // full data per call (newest first) — each is independently viewable
  const previousCalls = calls.map(c => {
    const tone = tierToRisk(c.tier);
    return {
      date: fmtDate(c.ended_at), day: daysBetween(d.ngay_xuat_vien, c.ended_at),
      tone, outcome: RISK[tone].label, escalated: !!c.escalated,
      note: c.summary || "—",
      answers: callAnswers(c),
      transcript: Array.isArray(c.transcript) ? c.transcript : [],
    };
  });
  return {
    p, hasCalls,
    matchedProtocol: {
      code: hasCalls ? `Hậu phẫu · ${RISK[risk].label}` : "Hậu phẫu · chưa đánh giá",
      criteria: d.ghi_chu_theo_doi || "Theo dõi sau xuất viện",
      action: risk === "red" ? "Bác sĩ liên hệ trong vòng 1 giờ" : "Theo dõi và rà soát trong 24 giờ",
    },
    escalationReason: (hasCalls && cur.escalated)
      ? (cur.summary || "Trợ lý phát hiện dấu hiệu vượt ngưỡng an toàn và đã nâng mức ưu tiên.") : "",
    // only real collected answers from the current call (empty if none / case closed)
    slots: hasCalls ? callAnswers(cur).map(a => ({ label: a.label, value: a.value, tone: "grey" })) : [],
    trends: [],
    previousCalls,
    family: d.sdt_nguoi_nha || "—",
    protocolCycle: "Hậu phẫu · gọi ngày 1, 3, 5 sau xuất viện",
  };
}

/* ---- roster hydration + ready() gate ---------------------------------- */
const AfterCare = {
  _ready: null,
  async hydrate() {
    const rows = await API.get("/his/patients");
    PATIENTS.length = 0;
    (rows || []).forEach(r => PATIENTS.push(mapRosterRow(r)));
  },
  ready(fn) {
    document.addEventListener("DOMContentLoaded", () => {
      (this._ready || (this._ready = this.hydrate()))
        .then(fn)
        .catch(err => {
          console.error("[AfterCare] không tải được dữ liệu:", err);
          if (typeof toast === "function") toast("Không tải được dữ liệu từ máy chủ.");
          fn();  // let the page render its empty state
        });
    });
  },
  // convenience fetchers for the non-roster pages
  appointments() { return API.get("/his/appointments"); },
  performance() { return API.get("/his/performance"); },
  notifications() { return API.get("/his/notifications"); },
  templates() { return API.get("/his/templates"); },
  rules() { return API.get("/his/escalation-rules"); },
};
