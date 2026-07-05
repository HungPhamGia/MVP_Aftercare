/* =========================================================================
   AfterCare · case.js — rich case view + expanded doctor actions
   ========================================================================= */

function caseId() { return new URLSearchParams(location.search).get("id") || ""; }

/* date/time inputs default helpers (local — appointments.js isn't loaded here) */
function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
function isoTime(d) { return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }

/* fallback case from the roster only (used only if the detail API call fails) */
function buildCaseFromRoster(mrn) {
  const p0 = getPatient(mrn) || PATIENTS[0] || {};
  const p = Object.assign({
    reasonAdmission: "—", vitals: "—", meds: "—", followNote: p0.reason || "—",
    admitDate: "—", reExam: p0.reExam || "—",
  }, p0);
  return {
    p, hasCalls: false,
    matchedProtocol: {
      code: `Hậu phẫu · ${RISK[p.risk] ? RISK[p.risk].label : "—"}`, criteria: p.reason || "—",
      action: p.risk === "red" ? "Bác sĩ liên hệ trong vòng 1 giờ" : "Theo dõi và rà soát trong 24 giờ",
    },
    escalationReason: p.escalated ? (p.summary || "") : "",
    slots: [], trends: [], previousCalls: [],
    family: p.phoneFamily || "—",
    protocolCycle: "Hậu phẫu · gọi ngày 1, 3, 5 sau xuất viện",
  };
}

function toggleCall(i) {
  const body = document.getElementById("cb-" + i), caret = document.getElementById("cc-" + i);
  if (!body) return;
  body.hidden = !body.hidden;
  if (caret) caret.textContent = body.hidden ? "▸" : "▾";
}

let C;

function renderTop() {
  const p = C.p;
  $("#caseTop").innerHTML = `
    <a class="case-back" href="patients.html" aria-label="Quay lại">&#8592;</a>
    <div>
      <div class="crumb">Bệnh nhân &nbsp;&rsaquo;&nbsp; Ca #${esc(p.mrn)}</div>
      <h1>Chi tiết ca · ${esc(p.name)}</h1>
    </div>
    <span class="grow"></span>`;
}

function spark(series, flagUp) {
  const max = Math.max.apply(null, series), min = Math.min.apply(null, series);
  const range = (max - min) || 1;
  const bars = series.map(v => `<i style="height:${8 + Math.round((v - min) / range * 26)}px"></i>`).join("");
  const dir = flagUp ? "up" : "down";
  return `<span class="spark ${flagUp ? "up" : "down"}">${bars}</span>`;
}

function renderMain() {
  const p = C.p;

  const escalationHtml = C.escalationReason ? `
    <section class="callout red">
      <div><div class="ttl">Vì sao được nâng cảnh báo</div>
        <p>${esc(C.escalationReason)}</p></div>
    </section>` : "";

  const trendsHtml = C.trends.length ? `
    <section class="card sec">
      <span class="panel-title">Diễn biến gần đây</span>
      ${C.trends.map(t => {
        const now = t.series[t.series.length - 1], prev = t.series[t.series.length - 2];
        const arrow = now > prev ? "▲" : now < prev ? "▼" : "▬";
        const dirColor = t.flagUp ? "var(--red-ink)" : "var(--green-ink)";
        return `<div class="trend"><span class="t-label">${esc(t.label)}</span>
          ${spark(t.series, t.flagUp)}
          <span><span class="t-now">${now}</span> <span class="t-dir" style="color:${dirColor}">${arrow}</span></span></div>`;
      }).join("")}
    </section>` : "";

  const collectedHtml = (C.slots.length || p.summary) ? `
    <section class="card sec">
      <span class="panel-title">Thông tin thu thập ở cuộc gọi gần nhất</span>
      ${p.summary ? `<div class="summary-block"><h4>Tóm tắt cuộc gọi</h4><p>${esc(p.summary)}</p></div>` : ""}
      ${C.slots.map(s => `<div class="slot-row"><span class="label">${esc(s.label)}</span>
        <span class="value ${s.tone}">${esc(s.value)}</span></div>`).join("")}
    </section>` : "";

  const callTurn = t => {
    const ai = /trợ lý/i.test(t.who);
    return `<div class="turn ${ai ? "ai" : "patient"}"><div class="speaker">${esc(t.who)}</div><p>${esc(t.text)}</p></div>`;
  };
  const prevCallsHtml = C.previousCalls.length ? C.previousCalls.map((c, i) => `
    <div class="pcall-item">
      <button class="pcall-head" type="button" onclick="toggleCall(${i})">
        <span class="caret" id="cc-${i}">▸</span>
        <span class="when"><b>${esc(c.date)}</b>${c.day != null ? `<span class="mono">hậu phẫu ngày ${c.day}</span>` : ""}</span>
        <span class="badge ${c.tone}">${esc(c.outcome)}</span>
        <span class="pcall-sum">${esc(c.note)}</span>
      </button>
      <div class="pcall-body" id="cb-${i}" hidden>
        <div class="summary-block"><h4>Tóm tắt cuộc gọi</h4><p>${esc(c.note)}</p></div>
        ${c.answers.length ? `<div class="pcall-collected"><h4>Thông tin thu thập</h4>
          ${c.answers.map(a => `<div class="slot-row"><span class="label">${esc(a.label)}</span>
            <span class="value grey">${esc(a.value)}</span></div>`).join("")}</div>` : ""}
        <h4 style="margin:12px 0 8px">Bản ghi cuộc gọi</h4>
        ${c.transcript.length
          ? `<div class="transcript">${c.transcript.map(callTurn).join("")}</div>`
          : `<p class="muted-note">Không có bản ghi chi tiết cho cuộc gọi này.</p>`}
      </div>
    </div>`).join("") : `<p class="muted-note">Chưa có cuộc gọi nào cho ca này.</p>`;

  $("#caseMain").innerHTML = `
    <section class="card cid">
      <div class="cid-head">
        <div class="avatar">${esc(avatarInitials(p.name))}</div>
        <div><h2>${esc(p.name)}</h2><div class="who">${esc(p.sex)} ${p.age} tuổi · Mã HS ${esc(p.mrn)}</div></div>
        <span class="grow"></span>${riskBadge(p.risk)}
      </div>
      <div class="cid-tags">
        <span class="pill muted">Giao thức: ${esc(C.matchedProtocol.code)}</span>
        <span class="pill muted">Gọi kế tiếp: ${p.nextCall.status === "none" ? "chưa lên lịch" : esc(p.nextCall.date + " " + p.nextCall.time)}</span>
      </div>
      <dl class="facts">
        <dt>Chẩn đoán</dt><dd>${esc(p.diagnosis)}</dd>
        <dt>Phẫu thuật</dt><dd>${esc(p.surgery)}</dd>
        <dt>Lý do nhập viện</dt><dd>${esc(p.reasonAdmission)}</dd>
        <dt>Nhập / xuất viện</dt><dd>${esc(p.admitDate)} → ${esc(p.dischargeDate)}${p.day != null ? ` (hậu phẫu ngày ${p.day})` : ""}</dd>
        <dt>Sinh hiệu lúc ra viện</dt><dd>${esc(p.vitals)}</dd>
        <dt>Đơn thuốc</dt><dd>${esc(p.meds)}</dd>
        <dt>Ghi chú theo dõi</dt><dd>${esc(p.followNote)}</dd>
        <dt>Bác sĩ phụ trách</dt><dd>${esc(p.doctor)}</dd>
        <dt>Lịch tái khám</dt><dd>${esc(p.reExam)}</dd>
        <dt>Liên hệ</dt><dd>BN: ${esc(p.phonePatient)} · Người nhà: ${esc(p.phoneFamily)}</dd>
      </dl>
    </section>

    ${escalationHtml}

    <section class="card sec">
      <span class="panel-title">Giao thức khớp & hướng xử lý</span>
      <div class="protocol-box">
        <div class="row"><b>Giao thức</b><span>${esc(C.matchedProtocol.code)}</span></div>
        <div class="row"><b>Tiêu chí khớp</b><span>${esc(C.matchedProtocol.criteria)}</span></div>
        <div class="row"><b>Cần làm</b><span>${esc(C.matchedProtocol.action)}</span></div>
      </div>
    </section>

    ${collectedHtml}
    ${trendsHtml}

    <section class="card sec">
      <span class="panel-title">Các cuộc gọi trước</span>
      <p class="muted-note" style="margin:4px 0 12px">Bấm vào một cuộc gọi để xem tóm tắt và bản ghi chi tiết.</p>
      ${prevCallsHtml}
    </section>`;
}

function renderSide() {
  const actions = [
    { ic: "☎", label: "Gọi bệnh nhân", fn: "actManualCall()", primary: true },
    { ic: "🎧", label: "Demo cuộc gọi", fn: "actDemoCall()" },
    { ic: "❓", label: "Bộ câu hỏi", fn: "actQuestions()" },
    { ic: "🤖", label: "Lên lịch gọi AI", fn: "actScheduleAI()" },
    { ic: "📅", label: "Đặt lịch khám lại", fn: "actAppointment()" },
    { ic: "⏻", label: "Đóng ca & phân loại lại", fn: "actClose()" },
  ];
  const tl = C.previousCalls.length ? C.previousCalls.map(c => `
    <div class="tl-row"><div class="d"><span class="badge ${c.tone}" style="padding:1px 8px">${esc(c.outcome)}</span> ${esc(c.date)}${c.day != null ? ` · ngày ${c.day}` : ""}</div>
      <div class="x">${esc(c.note)}</div></div>`).join("")
    : `<p class="muted-note">Chưa có cuộc gọi nào.</p>`;

  $("#caseSide").innerHTML = `
    <section class="card actions-card">
      <span class="panel-title">Thao tác nhanh</span>
      ${actions.map(a => `<button class="action-btn ${a.primary ? "primary" : ""}" type="button" onclick="${a.fn}">
        <span class="ic">${a.ic}</span>${esc(a.label)}</button>`).join("")}
    </section>
    <section class="card timeline-card">
      <span class="panel-title">Dòng thời gian theo dõi</span>
      ${tl}
    </section>`;
}

/* ---- quick actions (drawer-driven) ------------------------------------ */
function actManualCall() { location.href = "call.html?id=" + C.p.mrn; }
function actDemoCall() { location.href = "chatbot.html?id=" + C.p.mrn; }

/* ---- Bộ câu hỏi: disease-required (locked) + patient extras + AI ------- */
const QP = { disease: "", required: [], extras: [], candidates: [], loading: false };

async function actQuestions() {
  openDrawer("Bộ câu hỏi", `<div id="qsPanel"><p class="muted-note">Đang tải…</p></div>`);
  try {
    const d = await API.get("/his/patient/" + encodeURIComponent(C.p.mrn) + "/question-set");
    QP.disease = d.disease || "—";
    QP.required = d.required || [];
    QP.extras = (d.patient || []).map(q => ({ text: q.text, expected_var: q.expected_var || null }));
    QP.candidates = []; QP.loading = false;
    renderQsPanel();
  } catch (e) {
    const box = $("#qsPanel");
    if (box) box.innerHTML = `<div class="callout red">Không tải được bộ câu hỏi: ${esc(e.message)}</div>`;
  }
}

function qsSyncExtras() {
  $all("#qsExtras [data-t]").forEach(el => { if (QP.extras[+el.dataset.t]) QP.extras[+el.dataset.t].text = el.value; });
}

function renderQsPanel() {
  const box = $("#qsPanel");
  if (!box) return;
  const row = (inner) => `<div style="display:flex;gap:8px;align-items:center;margin:6px 0">${inner}</div>`;
  box.innerHTML = `
    <p class="muted-note">Bệnh: <b>${esc(QP.disease)}</b>. Câu bắt buộc theo bệnh luôn được hỏi; câu riêng của bệnh nhân có thể thêm/bớt.</p>

    <h4 style="margin:12px 0 6px">Câu hỏi bắt buộc của bệnh</h4>
    ${QP.required.length ? QP.required.map(q => `
      <div class="slot-row"><span class="label">${esc(q.text)}</span><span class="pill red" style="padding:1px 8px">Bắt buộc</span></div>`).join("")
      : `<p class="muted-note">Bệnh này chưa có câu bắt buộc.</p>`}

    <h4 style="margin:16px 0 6px">Câu hỏi riêng của bệnh nhân</h4>
    <div id="qsExtras">${QP.extras.length ? QP.extras.map((q, i) =>
      row(`<input class="input" data-t="${i}" value="${esc(q.text)}" style="flex:1">
           <button class="btn btn-sm btn-danger" data-del="${i}" type="button">Xóa</button>`)).join("")
      : `<p class="muted-note">Chưa có câu riêng nào.</p>`}</div>
    ${row(`<input class="input" id="qsNew" placeholder="Thêm câu hỏi riêng…" style="flex:1">
          <button class="btn btn-sm" id="qsAdd" type="button">Thêm</button>`)}

    <div style="margin-top:14px">
      <button class="btn btn-leaf btn-sm" id="qsGen" type="button" ${QP.loading ? "disabled" : ""}>${QP.loading ? "Đang sinh…" : "✨ Generate câu hỏi bằng AI"}</button>
    </div>
    <div id="qsCand">${renderQsCandidates()}</div>

    <div class="drawer-actions"><button class="btn btn-leaf btn-block" id="qsSave" type="button">Lưu bộ câu hỏi của bệnh nhân</button></div>`;

  $all("#qsExtras [data-t]").forEach(el => el.addEventListener("change", () => { if (QP.extras[+el.dataset.t]) QP.extras[+el.dataset.t].text = el.value; }));
  $all("#qsExtras [data-del]").forEach(el => el.addEventListener("click", () => { qsSyncExtras(); QP.extras.splice(+el.dataset.del, 1); renderQsPanel(); }));
  $("#qsAdd").addEventListener("click", () => {
    const inp = $("#qsNew"), v = (inp.value || "").trim();
    if (!v) { toast("Nhập nội dung câu hỏi."); return; }
    qsSyncExtras(); QP.extras.push({ text: v, expected_var: null }); renderQsPanel();
  });
  $("#qsNew").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("#qsAdd").click(); } });
  $("#qsGen").addEventListener("click", genAiQuestions);
  wireQsCandidates();
  $("#qsSave").addEventListener("click", saveQs);
}

function renderQsCandidates() {
  if (!QP.candidates.length) return "";
  return `<div class="card sec" style="margin-top:12px;padding:12px">
    <b>AI đề xuất (chưa lưu — chọn câu muốn thêm):</b>
    ${QP.candidates.map((c, i) => `
      <div style="display:flex;gap:8px;align-items:center;margin:8px 0">
        <span style="flex:1">${esc(c.text)}</span>
        <button class="btn btn-sm btn-leaf" data-acc="${i}" type="button">Chấp nhận</button>
        <button class="btn btn-sm btn-danger" data-rej="${i}" type="button">Từ chối</button>
      </div>`).join("")}</div>`;
}

function wireQsCandidates() {
  $all("#qsCand [data-acc]").forEach(el => el.addEventListener("click", () => {
    const c = QP.candidates[+el.dataset.acc];
    qsSyncExtras();
    QP.extras.push({ text: c.text, expected_var: c.expected_var || null });
    QP.candidates.splice(+el.dataset.acc, 1);
    renderQsPanel();
    toast("Đã thêm câu hỏi vào bộ của bệnh nhân.");
  }));
  $all("#qsCand [data-rej]").forEach(el => el.addEventListener("click", () => {
    QP.candidates.splice(+el.dataset.rej, 1); renderQsPanel();
  }));
}

async function genAiQuestions() {
  qsSyncExtras();
  QP.loading = true; renderQsPanel();
  try {
    const res = await API.post("/questions/ai-suggest", { ma_ho_so: C.p.mrn });
    QP.candidates = res.candidates || [];
    if (!QP.candidates.length) toast("AI không tìm thấy câu hỏi mới nào để bổ sung.");
  } catch (e) { toast("Sinh câu hỏi thất bại: " + e.message); }
  QP.loading = false; renderQsPanel();
}

async function saveQs() {
  qsSyncExtras();
  const questions = QP.extras
    .filter(q => (q.text || "").trim())
    .map(q => ({ text: q.text.trim(), expected_var: q.expected_var || null }));
  try {
    const res = await API.post("/his/patient/" + encodeURIComponent(C.p.mrn) + "/question-set", { questions });
    closeDrawer();
    toast(`Đã lưu bộ câu hỏi (${res.count} câu) — VoiceBot sẽ dùng ở cuộc gọi sau.`);
  } catch (e) { toast("Lưu thất bại: " + e.message); }
}

/* Lên lịch gọi AI → persists monitoring.next_call_at (shows in roster + AI calendar) */
function actScheduleAI() {
  const base = C.p.nextCall && C.p.nextCall.iso ? new Date(C.p.nextCall.iso) : new Date();
  openDrawer("Lên lịch gọi AI", `
    ${fieldInput("Ngày gọi", "date", "date", isoDate(base))}
    ${fieldInput("Giờ gọi", "time", "time", C.p.nextCall && C.p.nextCall.iso ? isoTime(base) : "09:00")}
    <p class="muted-note">Lịch gọi kế tiếp sẽ hiển thị ở danh sách bệnh nhân và lịch gọi AI.</p>
    <div class="drawer-actions"><button class="btn btn-leaf btn-block" id="aiSchedSave" type="button">Lưu lịch gọi</button></div>`,
    box => $("#aiSchedSave", box).addEventListener("click", () =>
      saveScheduleAI($('[name=date]', box).value, $('[name=time]', box).value)));
}
async function saveScheduleAI(date, time) {
  if (!date) { toast("Chọn ngày gọi."); return; }
  const iso = `${date}T${time || "09:00"}:00`;
  try {
    await API.put("/records/" + encodeURIComponent(C.p.mrn) + "/monitoring", { next_call_at: iso });
    C.p.nextCall = mapNextCall(iso);
    Metrics.track("ai_schedule", "Lên lịch gọi AI · " + C.p.name);
    closeDrawer(); renderMain(); renderSide(); toast("Đã lưu lịch gọi AI.");
  } catch (e) { toast("Lưu thất bại: " + e.message); }
}

/* Đặt lịch khám lại → persists lich_tai_kham (one re-exam per patient) */
function actAppointment() {
  const cur = C.p.reExamIso || isoDate(new Date());
  openDrawer("Đặt lịch khám lại", `
    ${fieldInput("Ngày khám", "date", "date", cur)}
    <p class="muted-note">Mỗi bệnh nhân có một lịch tái khám; lưu sẽ cập nhật lịch tái khám hiện tại.</p>
    <div class="drawer-actions"><button class="btn btn-leaf btn-block" id="reexamSave" type="button">Lưu lịch tái khám</button></div>`,
    box => $("#reexamSave", box).addEventListener("click", () =>
      saveReExam($('[name=date]', box).value)));
}
async function saveReExam(date) {
  if (!date) { toast("Chọn ngày khám."); return; }
  try {
    await API.put("/records/" + encodeURIComponent(C.p.mrn) + "/lich-tai-kham", { lich_tai_kham: date });
    C.p.reExamIso = date; C.p.reExam = fmtDate(date);
    Metrics.track("case_action", "Đặt lịch tái khám · " + C.p.name);
    closeDrawer(); renderMain(); toast("Đã lưu lịch tái khám.");
  } catch (e) { toast("Lưu thất bại: " + e.message); }
}

/* Đóng ca → ca đã xử lý xong: về "chưa đánh giá" + "chưa có lịch gọi" (lịch sử giữ nguyên) */
function actClose() {
  openDrawer("Đóng ca", `
    <p class="muted-note">Đóng ca nghĩa là ca này đã được xử lý xong. Bệnh nhân sẽ trở về trạng thái
      <b>chưa đánh giá</b> và <b>chưa có lịch gọi kế tiếp</b>; lịch sử cuộc gọi vẫn được giữ lại.</p>
    <div class="drawer-actions"><button class="btn btn-dark btn-block" id="closeCaseBtn" type="button">Đóng ca</button></div>`,
    box => $("#closeCaseBtn", box).addEventListener("click", closeCaseNow));
}
async function closeCaseNow() {
  try {
    await API.post("/records/" + encodeURIComponent(C.p.mrn) + "/close");
    Metrics.track("case_close", "Đóng ca · " + C.p.name);
    closeDrawer(); toast("Đã đóng ca — bệnh nhân về trạng thái chưa đánh giá.");
    setTimeout(() => location.href = "patients.html", 900);
  } catch (e) { toast("Đóng ca thất bại: " + e.message); }
}

async function buildCaseAsync(mrn) {
  try {
    const [d, calls] = await Promise.all([
      API.get("/his/patient/" + encodeURIComponent(mrn)),
      API.get("/his/patient/" + encodeURIComponent(mrn) + "/call-results"),
    ]);
    return buildCaseFromApi(d, calls);
  } catch (e) {
    console.warn("[case] detail API failed — using roster data", e);
    return buildCaseFromRoster(mrn);
  }
}

AfterCare.ready(async () => {
  C = await buildCaseAsync(caseId());
  renderTop(); renderMain(); renderSide();
});
