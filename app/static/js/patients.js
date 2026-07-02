/* =========================================================================
   AfterCare · patients.js — search, filter, sort, list/card, preview
   ========================================================================= */

const PSTATE = {
  q: "", diagnosis: "", doctor: "", risk: { red: false, amber: false, green: false },
  callStatus: "", overdue: false, sort: "risk", view: "list", compact: false,
};

function renderFilters() {
  const groups = Array.from(new Set(PATIENTS.map(p => p.group)));
  const docs = Array.from(new Set(PATIENTS.map(p => p.doctor))).filter(Boolean);
  $("#filters").innerHTML = `
    <label class="f grow"><span>Tìm theo tên hoặc mã HS</span>
      <input class="input" id="fq" type="search" placeholder="VD: Hùng hoặc 10472…"></label>
    <label class="f"><span>Chẩn đoán</span>
      <select class="select" id="fdx"><option value="">Tất cả</option>
        ${groups.map(g => `<option>${esc(g)}</option>`).join("")}</select></label>
    <label class="f"><span>Bác sĩ phụ trách</span>
      <select class="select" id="fdoc"><option value="">Tất cả</option>
        ${docs.map(d => `<option>${esc(d)}</option>`).join("")}</select></label>
    <label class="f"><span>Trạng thái gọi AI</span>
      <select class="select" id="fcall"><option value="">Tất cả</option>
        <option value="scheduled">Đã lên lịch</option>
        <option value="none">Chưa lên lịch</option></select></label>
    <label class="f"><span>Sắp xếp</span>
      <select class="select" id="fsort">
        <option value="risk">Ưu tiên: nguy cơ cao trước</option>
        <option value="day">Ngày theo dõi</option>
        <option value="name">Tên A–Z</option>
        <option value="next">Lịch gọi kế tiếp</option></select></label>
    <div class="f"><span>Mức độ ưu tiên</span>
      <div class="tag-row" id="frisk">
        <button class="chip" data-risk="red"><span class="dot red"></span>Nguy cơ cao</button>
        <button class="chip" data-risk="amber"><span class="dot amber"></span>Theo dõi</button>
        <button class="chip" data-risk="green"><span class="dot green"></span>Ổn định</button>
      </div></div>
    <label class="check"><input type="checkbox" id="foverdue"> Quá hạn theo dõi</label>`;

  $("#fq").addEventListener("input", e => { PSTATE.q = e.target.value.trim().toLowerCase(); render(); });
  $("#fdx").addEventListener("change", e => { PSTATE.diagnosis = e.target.value; render(); });
  $("#fdoc").addEventListener("change", e => { PSTATE.doctor = e.target.value; render(); });
  $("#fcall").addEventListener("change", e => { PSTATE.callStatus = e.target.value; render(); });
  $("#fsort").addEventListener("change", e => { PSTATE.sort = e.target.value; render(); });
  $("#foverdue").addEventListener("change", e => { PSTATE.overdue = e.target.checked; render(); });
  $all("#frisk .chip").forEach(c => c.addEventListener("click", () => {
    const r = c.dataset.risk; PSTATE.risk[r] = !PSTATE.risk[r];
    c.classList.toggle("active", PSTATE.risk[r]); render();
  }));
}

function applyFilters() {
  const anyRisk = PSTATE.risk.red || PSTATE.risk.amber || PSTATE.risk.green;
  let rows = PATIENTS.filter(p => {
    if (PSTATE.q && !(p.name.toLowerCase().includes(PSTATE.q) || p.mrn.includes(PSTATE.q))) return false;
    if (PSTATE.diagnosis && p.group !== PSTATE.diagnosis) return false;
    if (PSTATE.doctor && p.doctor !== PSTATE.doctor) return false;
    if (PSTATE.callStatus && p.nextCall.status !== PSTATE.callStatus) return false;
    if (PSTATE.overdue && !p.overdue) return false;
    if (anyRisk && !PSTATE.risk[p.risk]) return false;
    return true;
  });
  const riskRank = { red: 0, amber: 1, green: 2, unknown: 3 };
  rows.sort((a, b) => {
    if (PSTATE.sort === "name") return a.name.localeCompare(b.name, "vi");
    if (PSTATE.sort === "day") return b.day - a.day;
    if (PSTATE.sort === "next") return (a.nextCall.date || "~").localeCompare(b.nextCall.date || "~");
    return riskRank[a.risk] - riskRank[b.risk];
  });
  return rows;
}

function renderList(rows) {
  return `<table class="ctable ${PSTATE.compact ? "compact" : ""}">
    <thead><tr>
      <th>Bệnh nhân</th><th>Chẩn đoán</th><th>Ưu tiên</th><th>Bác sĩ</th>
      <th>Gọi AI kế tiếp</th><th>Gọi gần nhất</th><th></th>
    </tr></thead><tbody>
    ${rows.map(p => `
      <tr data-mrn="${p.mrn}">
        <td class="pt"><div class="twolines"><strong>${esc(p.name)}</strong>
          <span class="mono">${p.mrn} · ${p.age}t · ${esc(p.sex)}</span></div></td>
        <td>${esc(p.diagnosis)}</td>
        <td>${riskBadge(p.risk)}</td>
        <td>${esc(p.doctor)}</td>
        <td>${p.nextCall.status === "none" ? `<span class="pill muted">Chưa lên lịch</span>`
              : `${esc(p.nextCall.date)} ${esc(p.nextCall.time)} ${callPill(p.nextCall.status)}`}</td>
        <td>${esc(p.lastContact)}</td>
        <td class="row-acts"><button class="btn btn-sm" data-preview="${p.mrn}">Demo gọi</button>
          <button class="btn btn-sm" data-open="${p.mrn}">Mở</button></td>
      </tr>`).join("")}
    </tbody></table>`;
}

function renderCards(rows) {
  return `<div class="patient-grid">
    ${rows.map(p => `
      <article class="patient-card" data-mrn="${p.mrn}">
        <div class="pc-top">${riskBadge(p.risk)}<span class="pc-mrn">${p.mrn}</span></div>
        <h3>${esc(p.name)}</h3>
        <p class="dx">${p.age} tuổi · ${esc(p.sex)} · ${esc(p.diagnosis)}</p>
        <p class="summary">${esc(p.summary)}</p>
        <div class="pc-foot">
          <span>Gọi kế tiếp: ${p.nextCall.status === "none" ? "chưa lên lịch" : esc(p.nextCall.date + " " + p.nextCall.time)}</span>
          <span class="actions">
            <button class="btn btn-sm" data-open="${p.mrn}">Mở hồ sơ</button>
            <button class="btn btn-sm btn-leaf" data-preview="${p.mrn}">Demo gọi</button>
          </span>
        </div>
      </article>`).join("")}
  </div>`;
}

function render() {
  const rows = applyFilters();
  $("#resultMeta").innerHTML = `
    <span><b>${rows.length}</b> bệnh nhân</span>
    <span class="grow"></span>
    <label class="compact check"><input type="checkbox" id="fcompact" ${PSTATE.compact ? "checked" : ""}> Chế độ gọn</label>`;
  $("#fcompact").addEventListener("change", e => { PSTATE.compact = e.target.checked; render(); });

  const view = $("#patientView");
  if (!rows.length) { view.innerHTML = `<div class="card empty">Không tìm thấy bệnh nhân khớp bộ lọc.</div>`; return; }
  view.innerHTML = PSTATE.view === "card" ? renderCards(rows) : renderList(rows);

  $all("[data-mrn]", view).forEach(el => {
    attachPreview(el, el.dataset.mrn);
    el.addEventListener("click", e => { if (!e.target.closest("button")) openCase(el.dataset.mrn); });
  });
  $all("[data-open]", view).forEach(b => b.addEventListener("click", e => { e.stopPropagation(); openCase(b.dataset.open); }));
  $all("[data-call]", view).forEach(b => b.addEventListener("click", e => { e.stopPropagation(); location.href = "call.html?id=" + b.dataset.call; }));
  $all("[data-preview]", view).forEach(b => b.addEventListener("click", e => { e.stopPropagation(); location.href = "chatbot.html?id=" + b.dataset.preview; }));
}

AfterCare.ready(() => {
  renderFilters();
  $all("#viewToggle button").forEach(b => b.addEventListener("click", () => {
    $all("#viewToggle button").forEach(x => x.classList.remove("active"));
    b.classList.add("active"); PSTATE.view = b.dataset.view; render();
  }));
  render();
});
