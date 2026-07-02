/* =========================================================================
   AfterCare · appointments.js — calendar with date nav, CRUD, drag-drop
   ========================================================================= */

const TODAY = toISO(new Date());     // real today
function docList() { return Array.from(new Set(PATIENTS.map(p => p.doctor))).filter(Boolean); }
/* one re-exam per patient (keyed by ma_ho_so); date-only, persisted to lich_tai_kham */
function mapAppts(rows) {
  return (rows || []).map(a => ({
    id: a.ma_ho_so, mrn: a.ma_ho_so, date: String(a.date).slice(0, 10), time: "",
    specialty: a.specialty || "Tái khám", doctor: a.bac_si_phu_trach || "—",
    note: a.chan_doan || a.phau_thuat || "",
  }));
}
function saveReExamAppt(mrn, date) {
  return API.put("/records/" + encodeURIComponent(mrn) + "/lich-tai-kham", { lich_tai_kham: date });
}
function upsertAppt(mrn, date) {
  const ex = AS.list.find(x => x.mrn === mrn);
  if (ex) { ex.date = date; return; }
  const p = getPatient(mrn);
  AS.list.push({ id: mrn, mrn, date, time: "", specialty: "Tái khám",
    doctor: p ? p.doctor : "—", note: p ? (p.diagnosis || "") : "" });
}
const DOW = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const MONTHS = ["", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];

/* ---- date helpers ---------------------------------------------------- */
function parseISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function toISO(dt) { return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`; }
function addDays(s, n) { const d = parseISO(s); d.setDate(d.getDate() + n); return toISO(d); }
function addMonths(s, n) { const d = parseISO(s); d.setMonth(d.getMonth() + n); return toISO(d); }
function mondayOf(s) { const d = parseISO(s); const off = (d.getDay() + 6) % 7; d.setDate(d.getDate() - off); return toISO(d); }
function ddmm(s) { const [, m, d] = s.split("-"); return `${d}/${m}`; }
function ddmmyy(s) { const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; }

let AS = {
  view: "week", anchor: TODAY, filterDoctor: "", filterPatient: "", filterDisease: "", _drag: null,
  list: [],   // filled from /his/appointments
};

function specClass(s) {
  if (s.includes("Tim")) return "spec-tim";
  if (s.includes("Hô hấp")) return "spec-ho";
  if (s.includes("Nội")) return "spec-noi";
  if (s.includes("Ngoại")) return "spec-ngoai";
  return "";
}
function apName(mrn) { const p = getPatient(mrn); return p ? p.name : mrn; }
function apGroup(mrn) { const p = getPatient(mrn); return p ? p.group : ""; }

function visible() {
  return AS.list.filter(a => {
    if (AS.filterDoctor && a.doctor !== AS.filterDoctor) return false;
    if (AS.filterPatient && a.mrn !== AS.filterPatient) return false;
    if (AS.filterDisease && apGroup(a.mrn) !== AS.filterDisease) return false;
    return true;
  });
}

/* ---- toolbar: date nav (left) + filters (right) ---------------------- */
function periodLabel() {
  if (AS.view === "day") return ddmmyy(AS.anchor);
  if (AS.view === "month") { const [y, m] = AS.anchor.split("-"); return `Tháng ${MONTHS[+m]}/${y}`; }
  const mon = mondayOf(AS.anchor), sun = addDays(mon, 6);
  return `${ddmm(mon)} – ${ddmmyy(sun)}`;
}
function renderToolbar() {
  const groups = Array.from(new Set(PATIENTS.map(p => p.group)));
  $("#apToolbar").innerHTML = `
    <div class="ap-nav">
      <button class="icon-btn" id="apPrev" aria-label="Trước">‹</button>
      <button class="icon-btn" id="apNext" aria-label="Sau">›</button>
      <button class="btn btn-sm" id="apToday">Hôm nay</button>
      <strong class="ap-period">${esc(periodLabel())}</strong>
      <div class="segmented" id="apSeg" style="margin-left:6px">
        <button data-v="day" class="${AS.view === "day" ? "active" : ""}">Ngày</button>
        <button data-v="week" class="${AS.view === "week" ? "active" : ""}">Tuần</button>
        <button data-v="month" class="${AS.view === "month" ? "active" : ""}">Tháng</button>
      </div>
    </div>
    <div class="ap-filters">
      <label class="f"><span>Bác sĩ</span><select class="select" id="afDoc"><option value="">Tất cả</option>
        ${docList().map(d => `<option ${d === AS.filterDoctor ? "selected" : ""}>${esc(d)}</option>`).join("")}</select></label>
      <label class="f"><span>Bệnh nhân</span><select class="select" id="afPt"><option value="">Tất cả</option>
        ${PATIENTS.map(p => `<option value="${p.mrn}" ${p.mrn === AS.filterPatient ? "selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
      <label class="f"><span>Bệnh</span><select class="select" id="afDx"><option value="">Tất cả</option>
        ${groups.map(g => `<option ${g === AS.filterDisease ? "selected" : ""}>${esc(g)}</option>`).join("")}</select></label>
    </div>`;

  const step = d => { const u = AS.view === "month" ? addMonths : (s, n) => addDays(s, n * (AS.view === "week" ? 7 : 1)); AS.anchor = u(AS.anchor, d); renderToolbar(); renderBody(); };
  $("#apPrev").addEventListener("click", () => step(-1));
  $("#apNext").addEventListener("click", () => step(1));
  $("#apToday").addEventListener("click", () => { AS.anchor = TODAY; renderToolbar(); renderBody(); });
  $all("#apSeg button").forEach(b => b.addEventListener("click", () => { AS.view = b.dataset.v; renderToolbar(); renderBody(); }));
  $("#afDoc").addEventListener("change", e => { AS.filterDoctor = e.target.value; renderBody(); });
  $("#afPt").addEventListener("change", e => { AS.filterPatient = e.target.value; renderBody(); });
  $("#afDx").addEventListener("change", e => { AS.filterDisease = e.target.value; renderBody(); });
}

function apChip(a) {
  return `<div class="ap-chip ${specClass(a.specialty)}" draggable="true" data-id="${a.id}" data-mrn="${a.mrn}">
    <span class="t">${esc(a.time)}</span><span class="n">${esc(apName(a.mrn))}</span>
    <span class="s">${esc(a.specialty)}</span></div>`;
}

function renderBody() {
  const body = $("#apBody");
  if (AS.view === "week") renderWeek(body);
  else if (AS.view === "day") renderDay(body);
  else renderMonth(body);
}

function renderWeek(body) {
  const vis = visible(); const mon = mondayOf(AS.anchor);
  const dates = Array.from({ length: 7 }, (_, i) => addDays(mon, i));
  body.innerHTML = `<div class="ap-week">${dates.map((iso, i) => `
    <div class="ap-col ${iso === TODAY ? "today" : ""}" data-date="${iso}">
      <div class="ch"><div class="dow">${DOW[i]}</div><div class="dnum">${ddmm(iso)}</div></div>
      ${vis.filter(a => a.date === iso).sort((x, y) => x.time.localeCompare(y.time)).map(apChip).join("")}
    </div>`).join("")}</div>`;
  wireChips(); wireDrop();
}

function renderDay(body) {
  const vis = visible().filter(a => a.date === AS.anchor).sort((x, y) => x.time.localeCompare(y.time));
  body.innerHTML = `<div class="ap-day">${vis.length ? vis.map(a => `
      <div class="ap-item" data-id="${a.id}" data-mrn="${a.mrn}">
        <span class="time">${esc(a.time)}</span>
        <div class="grow"><strong>${esc(apName(a.mrn))}</strong> · ${esc(a.specialty)}
          <div class="muted-note">${esc(a.doctor)} — ${esc(a.note)}</div></div>
        <button class="btn btn-sm" data-edit="${a.id}">Sửa</button>
        <button class="btn btn-sm" onclick="openCase('${a.mrn}')">Mở ca</button>
      </div>`).join("") : `<div class="empty">Không có lịch hẹn trong ngày này.</div>`}</div>`;
  $all("[data-edit]").forEach(b => b.addEventListener("click", () => openAppt(b.dataset.edit)));
  $all(".ap-item[data-mrn]").forEach(el => attachPreview(el, el.dataset.mrn));
}

function renderMonth(body) {
  const vis = visible();
  const [y, m] = AS.anchor.split("-").map(Number);
  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7;                 // Mon-based blanks before day 1
  const days = new Date(y, m, 0).getDate();
  let cells = DOW.map(d => `<div class="dow">${d}</div>`).join("");
  for (let i = 0; i < lead; i++) cells += `<div class="cell muted"></div>`;
  for (let day = 1; day <= days; day++) {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const evs = vis.filter(a => a.date === iso).sort((x, y) => x.time.localeCompare(y.time));
    cells += `<div class="cell ${iso === TODAY ? "today" : ""}" data-date="${iso}">
      <span class="dn">${day}</span>
      ${evs.slice(0, 3).map(a => `<div class="ev">${esc(a.time)} ${esc(apName(a.mrn))}</div>`).join("")}
      ${evs.length > 3 ? `<div class="muted-note" style="margin-top:3px">+${evs.length - 3} nữa</div>` : ""}</div>`;
  }
  body.innerHTML = `<div class="ap-month">${cells}</div>`;
  $all(".ap-month .cell[data-date]").forEach(c => c.addEventListener("click", () => { AS.anchor = c.dataset.date; AS.view = "day"; renderToolbar(); renderBody(); }));
}

function wireChips() {
  $all(".ap-chip").forEach(ch => {
    attachPreview(ch, ch.dataset.mrn);
    ch.addEventListener("click", () => openAppt(ch.dataset.id));
    ch.addEventListener("dragstart", () => { AS._drag = ch.dataset.id; ch.classList.add("dragging"); });
    ch.addEventListener("dragend", () => ch.classList.remove("dragging"));
  });
}
function wireDrop() {
  $all(".ap-col").forEach(col => {
    col.addEventListener("dragover", e => { e.preventDefault(); col.classList.add("drop"); });
    col.addEventListener("dragleave", () => col.classList.remove("drop"));
    col.addEventListener("drop", async e => {
      e.preventDefault(); col.classList.remove("drop");
      const a = AS.list.find(x => x.id === AS._drag);
      const to = col.dataset.date;
      AS._drag = null;
      if (a && a.date !== to) {
        try {
          await saveReExamAppt(a.mrn, to);
          a.date = to;
          Metrics.track("appt_move", "Đổi ngày tái khám: " + apName(a.mrn));
          toast(`Đã chuyển lịch tái khám của ${apName(a.mrn)} sang ${ddmm(to)}.`);
          renderBody();
        } catch (err) { toast("Lưu thất bại: " + err.message); }
      }
    });
  });
}

function openAppt(mrn) {
  const editing = !!mrn;
  const a = editing ? AS.list.find(x => x.mrn === mrn) : null;
  const defMrn = a ? a.mrn : (PATIENTS[0] ? PATIENTS[0].mrn : "");
  const defDate = a ? a.date : (AS.view === "day" ? AS.anchor : TODAY);
  openDrawer(editing ? "Sửa lịch tái khám" : "Thêm lịch tái khám", `
    ${fieldSelect("Bệnh nhân", "mrn", PATIENTS.map(p => `${p.name} (${p.mrn})`), `${apName(defMrn)} (${defMrn})`)}
    ${fieldInput("Ngày tái khám", "date", "date", defDate)}
    <p class="muted-note">Mỗi bệnh nhân có một lịch tái khám.</p>
    <div class="drawer-actions">
      <button class="btn btn-leaf btn-block" id="apSave" type="button">${editing ? "Lưu" : "Thêm lịch tái khám"}</button>
      ${editing ? `<button class="btn btn-danger" id="apDel" type="button">Xóa</button>` : ""}
    </div>`, box => {
    $("#apSave", box).addEventListener("click", async () => {
      const mrnSel = $('[name=mrn]', box).value.match(/\(([^)]+)\)/);
      const m = mrnSel ? mrnSel[1] : defMrn;
      const date = $('[name=date]', box).value;
      if (!m || !date) { toast("Chọn bệnh nhân và ngày tái khám."); return; }
      try {
        await saveReExamAppt(m, date);
        upsertAppt(m, date);
        closeDrawer(); renderBody(); toast("Đã lưu lịch tái khám.");
      } catch (e) { toast("Lưu thất bại: " + e.message); }
    });
    if (editing) $("#apDel", box).addEventListener("click", async () => {
      try {
        await saveReExamAppt(mrn, null);
        AS.list = AS.list.filter(x => x.mrn !== mrn);
        closeDrawer(); renderBody(); toast("Đã xóa lịch tái khám.");
      } catch (e) { toast("Xóa thất bại: " + e.message); }
    });
  });
}

AfterCare.ready(async () => {
  try { AS.list = mapAppts(await AfterCare.appointments()); }
  catch (e) { console.warn("[appointments]", e); }
  renderToolbar();
  $("#apAdd").addEventListener("click", () => openAppt(null));
  renderBody();
});
