/* =========================================================================
   AfterCare · manager.js — AI Follow-up Manager (5 tools, hash-routed)
   ========================================================================= */

const clone = o => JSON.parse(JSON.stringify(o));
const CONDITIONS = ["Hậu phẫu", "Sản khoa", "Chấn thương chỉnh hình"];
const DAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

/* ---- calendar date helpers (anchor-based navigation) ------------------- */
function calISO(dt) { return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`; }
const CAL_TODAY = calISO(new Date());
function calParse(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function calAddDays(s, n) { const d = calParse(s); d.setDate(d.getDate() + n); return calISO(d); }
function calAddMonths(s, n) { const d = calParse(s); d.setMonth(d.getMonth() + n); return calISO(d); }
function calMonday(s) { const d = calParse(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return calISO(d); }
function calDDMM(s) { const [, m, d] = s.split("-"); return `${d}/${m}`; }
function calDDMMYY(s) { const [y, m, d] = s.split("-"); return `${d}/${m}/${y}`; }

const MS = {
  byDate: {},   // 'YYYY-MM-DD' -> [{time, name, group, status, mrn}] from monitoring
  workingHours: { start: "08:00", end: "17:00", days: ["T2", "T3", "T4", "T5", "T6"] },
  retry: { afterMin: 30, maxAttempts: 3 },
  blackout: [],
  upcoming: [],
  templates: [], rules: [], notifications: [], performance: null,
  calView: "week",
  calAnchor: CAL_TODAY,
  selTpl: null,
  sched: { scope: "Theo bệnh", target: CONDITIONS[0], interval: 7, start: CAL_TODAY, count: 5 },
  _drag: null,
};

/* Build MS from live data (templates/rules/performance/notifications + the
   week grid from monitoring next-call times). Edits stay client-side. */
async function hydrateManager() {
  const [tpls, rules, perf, notifs] = await Promise.all([
    AfterCare.templates(), AfterCare.rules(), AfterCare.performance(), AfterCare.notifications(),
  ]);
  MS.templates = tpls || [];
  MS.selTpl = MS.templates[0] ? MS.templates[0].id : null;
  MS.rules = (rules || []).map(r => ({
    id: r.id, name: r.name, active: r.active, when: r.when_text, risk: r.risk,
    recipients: r.recipients || [], approval: r.approval,
    autoAppt: r.auto_appt || { on: false, specialty: "", within: "" },
  }));
  MS.performance = perf;
  MS.notifications = (notifs || []).map(g => ({
    group: g.group, tone: g.tone,
    items: (g.items || []).map(it => ({ mrn: it.ma_ho_so, text: it.text, action: "Mở ca" })),
  }));
  MS.byDate = {};
  MS.upcoming = [];
  PATIENTS.filter(p => p.nextCall.iso)
    .sort((a, b) => String(a.nextCall.iso).localeCompare(String(b.nextCall.iso)))
    .forEach(p => {
      const key = calISO(new Date(p.nextCall.iso));
      (MS.byDate[key] = MS.byDate[key] || []).push({
        time: p.nextCall.time, name: p.name, group: p.group, mrn: p.mrn,
        status: "scheduled",
      });
      MS.upcoming.push({ when: `${p.nextCall.date} · ${p.nextCall.time}`, name: p.name, group: p.group });
    });
}

const TABS = [
  { id: "calendar",      label: "Lịch gọi AI",      render: renderCalendar },
  { id: "protocols",     label: "Giao thức & cảnh báo", render: renderRules },
  { id: "performance",   label: "Hiệu suất AI",     render: renderPerformance },
  { id: "notifications", label: "Thông báo",        render: renderNotifications },
];

function activeTab() {
  const h = (location.hash || "#calendar").slice(1);
  return TABS.find(t => t.id === h) ? h : "calendar";
}
function renderTabs() {
  const cur = activeTab();
  const failed = MS.notifications.find(g => g.group.includes("thất bại"));
  const fc = failed ? failed.items.length : 0;
  $("#mtabs").innerHTML = TABS.map(t => `
    <button class="mtab ${t.id === cur ? "active" : ""}" data-tab="${t.id}">${esc(t.label)}
      ${t.id === "notifications" && fc ? `<span class="badge red" style="padding:1px 7px">${fc}</span>` : ""}</button>`).join("");
  $all("#mtabs .mtab").forEach(b => b.addEventListener("click", () => { location.hash = b.dataset.tab; }));
}
function route() { renderTabs(); TABS.find(t => t.id === activeTab()).render(); }

/* =========================================================================
   1) AI Call Calendar
   ========================================================================= */
function calPeriodLabel() {
  if (MS.calView === "day") return calDDMMYY(MS.calAnchor);
  if (MS.calView === "month") { const [y, m] = MS.calAnchor.split("-"); return `Tháng ${+m}/${y}`; }
  const mon = calMonday(MS.calAnchor);
  return `Tuần ${calDDMM(mon)} – ${calDDMMYY(calAddDays(mon, 6))}`;
}
function calStep(dir) {
  MS.calAnchor = MS.calView === "month" ? calAddMonths(MS.calAnchor, dir)
    : MS.calView === "week" ? calAddDays(MS.calAnchor, dir * 7) : calAddDays(MS.calAnchor, dir);
  renderCalendar();
}
/* blackout entries are 'DD/MM/YYYY (note)' strings — match against an ISO date */
function isBlackout(iso) {
  const ddmmyy = calDDMMYY(iso);
  return MS.blackout.some(b => b.startsWith(ddmmyy));
}

function renderCalendar() {
  const v = $("#managerView");
  const up = MS.upcoming.slice(0, 4);
  v.innerHTML = `
    <div class="cal-top">
      <div class="mcard">
        <div class="cal-toolbar">
          <div class="cal-nav">
            <button class="icon-btn" id="calPrev" aria-label="Trước">‹</button>
            <button class="icon-btn" id="calNext" aria-label="Sau">›</button>
            <button class="btn btn-sm" id="calToday">Hôm nay</button>
            <strong class="cal-period">${esc(calPeriodLabel())}</strong>
          </div>
          <div class="segmented" id="calSeg">
            <button data-v="day" class="${MS.calView === "day" ? "active" : ""}">Ngày</button>
            <button data-v="week" class="${MS.calView === "week" ? "active" : ""}">Tuần</button>
            <button data-v="month" class="${MS.calView === "month" ? "active" : ""}">Tháng</button>
          </div>
          <span class="grow"></span>
          <button class="btn btn-leaf btn-sm" id="btnNewSched">＋ Lên lịch gọi</button>
          <button class="btn btn-sm" id="btnCallSettings">⚙ Cài đặt lịch gọi</button>
        </div>
        <div id="calBody"></div>
      </div>
      <div class="mcard up-card">
        <h3>Cuộc gọi sắp tới</h3>
        ${up.map(u => `<div class="upcoming-item">
          <span class="up-when">${esc(u.when)}</span>
          <div class="up-body"><strong>${esc(u.name)}</strong><span class="g">${esc(u.group)}</span></div>
        </div>`).join("")}
        ${MS.upcoming.length > up.length ? `<a class="up-more" href="#calendar" onclick="MS.calView='day';renderCalendar();return false;">+ ${MS.upcoming.length - up.length} cuộc gọi nữa</a>` : ""}
      </div>
    </div>`;
  $("#calPrev").addEventListener("click", () => calStep(-1));
  $("#calNext").addEventListener("click", () => calStep(1));
  $("#calToday").addEventListener("click", () => { MS.calAnchor = CAL_TODAY; renderCalendar(); });
  $all("#calSeg button").forEach(b => b.addEventListener("click", () => { MS.calView = b.dataset.v; renderCalendar(); }));
  $("#btnNewSched").addEventListener("click", openScheduleDrawer);
  $("#btnCallSettings").addEventListener("click", openCallSettings);
  renderCalBody();
}

function callChip(c, dateIso, idx) {
  return `<div class="cal-chip ${c.status === "failed" ? "failed" : ""}" draggable="true"
       data-date="${dateIso}" data-idx="${idx}">
    <span class="t">${esc(c.time)}</span><span class="n">${esc(c.name)}</span><span class="g">${esc(c.group)}</span></div>`;
}

function renderCalBody() {
  const body = $("#calBody");
  if (MS.calView === "week") {
    const mon = calMonday(MS.calAnchor);
    const dates = Array.from({ length: 7 }, (_, i) => calAddDays(mon, i));
    body.innerHTML = `<div class="cal-week">${DAYS.map((d, i) => `
      <div class="cal-col ${dates[i] === CAL_TODAY ? "today" : ""}" data-date="${dates[i]}">
        <h4>${d} <span class="muted-note">${calDDMM(dates[i])}</span></h4>
        ${(MS.byDate[dates[i]] || []).map((c, k) => callChip(c, dates[i], k)).join("")}</div>`).join("")}
    </div>
    <p class="muted-note" style="margin-top:10px">Kéo–thả để đổi ngày gọi.</p>`;
    wireDnD();
  } else if (MS.calView === "day") {
    const list = MS.byDate[MS.calAnchor] || [];
    body.innerHTML = list.length ? `<div class="day-list">${list.map(c => `
      <div class="day-item"><span class="time">${esc(c.time)}</span>
        <div style="flex:1"><strong>${esc(c.name)}</strong> <span class="muted-note">· ${esc(c.group)}</span></div>
        ${callPill(c.status)}
        <button class="btn btn-sm" onclick="openCase('${c.mrn}')">Mở ca</button></div>`).join("")}</div>`
      : `<div class="empty">Không có cuộc gọi nào trong ngày ${calDDMMYY(MS.calAnchor)}.</div>`;
  } else {
    body.innerHTML = renderMonth();
  }
}

function renderMonth() {
  const [y, m] = MS.calAnchor.split("-").map(Number);
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7;  // Monday-first offset
  const days = new Date(y, m, 0).getDate();
  let cells = "";
  DAYS.forEach(d => cells += `<div class="dow">${d}</div>`);
  for (let i = 0; i < lead; i++) cells += `<div class="cal-cell empty-cell"></div>`;
  for (let day = 1; day <= days; day++) {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const calls = MS.byDate[iso] || [];
    const fails = calls.filter(c => c.status === "failed").length;
    const black = isBlackout(iso);
    cells += `<div class="cal-cell ${iso === CAL_TODAY ? "today" : ""} ${black ? "black" : ""}">
      <span class="dn">${day}</span>
      ${calls.length ? `<div><span class="cnt">${calls.length}</span></div>` : ""}
      ${fails ? `<div style="margin-top:4px"><span class="cnt fail">${fails} lỗi</span></div>` : ""}
      ${black && !calls.length ? `<div class="muted-note" style="margin-top:6px">Nghỉ</div>` : ""}</div>`;
  }
  return `<div class="cal-month">${cells}</div>
    <p class="muted-note" style="margin-top:10px">Tháng ${m}/${y} · ngày gạch chéo là ngày nghỉ/không gọi.</p>`;
}

function wireDnD() {
  $all(".cal-chip").forEach(chip => {
    chip.addEventListener("dragstart", () => { MS._drag = { date: chip.dataset.date, idx: +chip.dataset.idx }; chip.classList.add("dragging"); });
    chip.addEventListener("dragend", () => chip.classList.remove("dragging"));
  });
  $all(".cal-col").forEach(col => {
    col.addEventListener("dragover", e => { e.preventDefault(); col.classList.add("drop"); });
    col.addEventListener("dragleave", () => col.classList.remove("drop"));
    col.addEventListener("drop", e => {
      e.preventDefault(); col.classList.remove("drop");
      if (!MS._drag) return;
      const to = col.dataset.date, from = MS._drag.date;
      if (to === from) return;
      const item = MS.byDate[from].splice(MS._drag.idx, 1)[0];
      (MS.byDate[to] = MS.byDate[to] || []).push(item);
      MS.byDate[to].sort((a, b) => a.time.localeCompare(b.time));
      MS._drag = null;
      Metrics.track("ai_reschedule", "Đổi ngày gọi: " + item.name);
      toast(`Đã chuyển cuộc gọi của ${item.name} sang ${calDDMMYY(to)}.`);
      renderCalBody();
    });
  });
}

/* "＋ Lên lịch gọi" — schedule builder in a drawer (same compute as before;
   ponytail: client-side only, no scheduling backend yet — same as the old card) */
function openScheduleDrawer() {
  const s = MS.sched;
  openDrawer("Lên lịch gọi", `
    <div class="cfg-row"><span class="lbl">Phạm vi</span>
      <select class="select" id="sbScope">${["Bệnh nhân cụ thể", "Theo bệnh", "Theo giao thức"].map(o => `<option ${o === s.scope ? "selected" : ""}>${o}</option>`).join("")}</select></div>
    <div class="cfg-row"><span class="lbl" id="sbTargetLbl">Đối tượng</span>
      <select class="select" id="sbTarget"></select></div>
    <div class="cfg-row"><span class="lbl">Khoảng lặp</span>
      <select class="select" id="sbInterval">
        <option value="3">Mỗi 3 ngày</option><option value="7" selected>Mỗi 7 ngày</option>
        <option value="14">Mỗi 14 ngày</option><option value="custom">Tùy chỉnh…</option></select>
      <input class="input" id="sbCustom" type="number" min="1" value="${s.interval}" style="width:70px;display:none"></div>
    <div class="cfg-row"><span class="lbl">Bắt đầu</span><input class="input" id="sbStart" type="date" value="${s.start}"></div>
    <div class="cfg-row"><span class="lbl">Số lần gọi</span><input class="input" id="sbCount" type="number" min="1" max="12" value="${s.count}" style="width:70px"></div>
    <div id="sbDates" class="computed-dates"></div>
    <div class="drawer-actions"><button class="btn btn-leaf btn-block" id="sbApply">Tính & lưu lịch</button></div>`,
    box => {
      const fillTarget = () => {
        const scope = $("#sbScope", box).value;
        $("#sbTargetLbl", box).textContent = scope === "Bệnh nhân cụ thể" ? "Bệnh nhân" : scope === "Theo bệnh" ? "Nhóm bệnh" : "Giao thức";
        const opts = scope === "Bệnh nhân cụ thể" ? PATIENTS.map(p => `${p.name} (${p.mrn})`)
          : scope === "Theo bệnh" ? CONDITIONS : MS.templates.map(t => t.name);
        $("#sbTarget", box).innerHTML = opts.map(o => `<option>${esc(o)}</option>`).join("");
      };
      const compute = () => {
        const iv = $("#sbInterval", box).value === "custom" ? Math.max(1, +$("#sbCustom", box).value || 1) : +$("#sbInterval", box).value;
        const start = $("#sbStart", box).value, count = Math.max(1, Math.min(12, +$("#sbCount", box).value || 1));
        if (!start) { $("#sbDates", box).innerHTML = ""; return; }
        let html = "";
        for (let k = 0; k < count; k++) html += `<span class="cd">${calDDMM(calAddDays(start, k * iv))}</span>`;
        $("#sbDates", box).innerHTML = html;
      };
      fillTarget(); compute();
      $("#sbScope", box).addEventListener("change", () => { fillTarget(); compute(); });
      $("#sbInterval", box).addEventListener("change", e => {
        $("#sbCustom", box).style.display = e.target.value === "custom" ? "inline-block" : "none"; compute();
      });
      ["sbTarget", "sbCustom", "sbStart", "sbCount"].forEach(id => $("#" + id, box).addEventListener("change", compute));
      $("#sbApply", box).addEventListener("click", () => saveSchedule(box));
    });
}

/* Persist the schedule's next-call date to monitoring.next_call_at for the
   targeted patients (shows in the roster + this calendar).
   ponytail: only the *next* call is stored; the interval/count series is a
   preview — later calls get scheduled after each one completes. */
async function saveSchedule(box) {
  const scope = $("#sbScope", box).value, target = $("#sbTarget", box).value;
  const start = $("#sbStart", box).value;
  if (!start) { toast("Chọn ngày bắt đầu."); return; }
  const iso = `${start}T09:00:00`;
  let targets;
  if (scope === "Bệnh nhân cụ thể") {
    const m = (target.match(/\(([^)]+)\)/) || [])[1];
    targets = PATIENTS.filter(p => p.mrn === m);
  } else if (scope === "Theo bệnh") {
    targets = PATIENTS.filter(p => p.group === target);
  } else {
    targets = PATIENTS.slice();  // theo giao thức: áp dụng cho toàn bộ danh sách demo
  }
  if (!targets.length) { toast("Không có bệnh nhân khớp — chưa lưu lịch nào."); return; }
  try {
    for (const p of targets) {
      await API.put("/records/" + encodeURIComponent(p.mrn) + "/monitoring", { next_call_at: iso });
    }
    MS.sched = { scope, target, interval: $("#sbInterval", box).value === "custom" ? +$("#sbCustom", box).value || 7 : +$("#sbInterval", box).value,
                 start, count: +$("#sbCount", box).value || 5 };
    Metrics.track("ai_schedule", "Lên lịch gọi AI · " + targets.length + " bệnh nhân");
    closeDrawer();
    await AfterCare.hydrate(); await hydrateManager(); renderCalendar();
    toast(`Đã lưu lịch gọi cho ${targets.length} bệnh nhân.`);
  } catch (e) { toast("Lưu thất bại: " + e.message); }
}

/* "⚙ Cài đặt lịch gọi" — merged popup: working hours + retry + blackout */
function openCallSettings() {
  const w = MS.workingHours;
  openDrawer("Cài đặt lịch gọi", `
    <h4 class="cd-h">Giờ làm việc</h4>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
      <input class="input" name="whStart" type="time" value="${w.start}"> –
      <input class="input" name="whEnd" type="time" value="${w.end}"></div>
    <div class="f"><span>Ngày gọi</span>
      <div class="daychips" id="whDays">${DAYS.map(d => `<span class="daychip ${w.days.includes(d) ? "on" : ""}" data-d="${d}">${d}</span>`).join("")}</div></div>
    <h4 class="cd-h">Lịch gọi lại</h4>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <span class="muted-note" style="width:120px">Gọi lại sau</span>
      <input class="input" name="rtMin" type="number" value="${MS.retry.afterMin}" style="width:80px"> phút</div>
    <div style="display:flex;gap:8px;align-items:center">
      <span class="muted-note" style="width:120px">Số lần tối đa</span>
      <input class="input" name="rtMax" type="number" value="${MS.retry.maxAttempts}" style="width:80px"></div>
    <h4 class="cd-h">Ngày nghỉ / không gọi</h4>
    <div id="boList"></div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <input class="input" name="boDate" type="date" style="flex:1"><input class="input" name="boNote" placeholder="Lý do…" style="flex:1"></div>
    <button class="btn btn-sm" id="boAdd" style="margin-top:8px">＋ Thêm ngày nghỉ</button>
    <div class="drawer-actions"><button class="btn btn-leaf btn-block" id="csSave">Lưu cài đặt</button></div>`,
    box => {
      const renderBO = () => {
        $("#boList", box).innerHTML = MS.blackout.map((b, i) => `
          <div class="blackout-item"><span>${esc(b)}</span><button class="btn btn-sm btn-danger" data-bo="${i}">Xóa</button></div>`).join("")
          || `<div class="muted-note">Chưa có ngày nghỉ.</div>`;
        $all("[data-bo]", box).forEach(bn => bn.addEventListener("click", () => { MS.blackout.splice(+bn.dataset.bo, 1); renderBO(); }));
      };
      renderBO();
      $all("#whDays .daychip", box).forEach(c => c.addEventListener("click", () => {
        const d = c.dataset.d, i = w.days.indexOf(d);
        if (i >= 0) w.days.splice(i, 1); else w.days.push(d);
        c.classList.toggle("on");
      }));
      $("#boAdd", box).addEventListener("click", () => {
        const d = $('[name=boDate]', box).value, n = $('[name=boNote]', box).value.trim();
        if (!d) { toast("Chọn ngày trước đã."); return; }
        const [y, m, day] = d.split("-");
        MS.blackout.push(`${day}/${m}/${y}${n ? " (" + n + ")" : ""}`);
        $('[name=boDate]', box).value = ""; $('[name=boNote]', box).value = "";
        renderBO();
      });
      $("#csSave", box).addEventListener("click", () => {
        w.start = $('[name=whStart]', box).value; w.end = $('[name=whEnd]', box).value;
        MS.retry.afterMin = +$('[name=rtMin]', box).value; MS.retry.maxAttempts = +$('[name=rtMax]', box).value;
        Metrics.track("ai_config", "Lưu cài đặt lịch gọi"); closeDrawer(); toast("Đã lưu cài đặt lịch gọi.");
      });
    });
}

/* =========================================================================
   Question templates: moved to a dedicated page (templates.html / templates.js).
   MS.templates is still loaded in hydrateManager — the scheduler's "Theo bệnh"
   target list reads template names.
   ========================================================================= */

/* =========================================================================
   3) Protocol & Escalation rules
   ========================================================================= */
function renderRules() {
  $("#managerView").innerHTML = `
    <div class="mcard">
      <div class="h-row"><h3>Giao thức & quy tắc cảnh báo</h3><span class="grow"></span>
        <button class="btn btn-leaf btn-sm" id="ruleAdd">＋ Thêm giao thức</button></div>
      <p class="muted-note" style="margin-bottom:14px">Mỗi quy tắc: khi điều kiện đúng → gắn mức ưu tiên, báo cho ai, có tự đặt lịch khám và có cần bác sĩ duyệt không.</p>
      <div id="ruleList"></div>
    </div>`;
  $("#ruleAdd").addEventListener("click", () => openRule(null));
  renderRuleList();
}
function renderRuleList() {
  $("#ruleList").innerHTML = MS.rules.map((r, i) => `
    <div class="rule-card">
      <div class="r-head">${riskBadge(r.risk)}<span class="nm">${esc(r.name)}</span><span class="grow"></span>
        <label class="check" style="padding:0">Bật
          <span class="toggle"><input type="checkbox" ${r.active ? "checked" : ""} data-ron="${i}"><span class="track"></span></span></label></div>
      <div class="rule-flow">
        <span class="node cond">Khi: ${esc(r.when)}</span><span class="arrow">→</span>
        <span class="node out">Mức: ${esc(RISK[r.risk].label)}</span>
        ${r.autoAppt.on ? `<span class="arrow">→</span><span class="node out">Tự đặt khám ${esc(r.autoAppt.specialty)} trong ${esc(r.autoAppt.within)}</span>` : ""}
      </div>
      <div class="rule-meta">
        <span>Báo cho: <b>${esc(r.recipients.join(", "))}</b></span>
        <span>Cần bác sĩ duyệt: <b>${r.approval ? "Có" : "Không"}</b></span>
      </div>
      <div class="rule-actions">
        <button class="btn btn-sm" data-redit="${i}">Sửa</button>
        <button class="btn btn-sm" data-rdup="${i}">Nhân bản</button>
        <button class="btn btn-sm btn-danger" data-rdel="${i}">Xóa</button>
      </div>
    </div>`).join("");
  $all("[data-ron]").forEach(el => el.addEventListener("change", () => { MS.rules[+el.dataset.ron].active = el.checked; toast(el.checked ? "Đã bật quy tắc." : "Đã tắt quy tắc."); }));
  $all("[data-redit]").forEach(el => el.addEventListener("click", () => openRule(+el.dataset.redit)));
  $all("[data-rdup]").forEach(el => el.addEventListener("click", () => {
    const c = clone(MS.rules[+el.dataset.rdup]); c.name += " (bản sao)"; c.id = "r" + Date.now();
    MS.rules.push(c); renderRuleList(); toast("Đã nhân bản quy tắc.");
  }));
  $all("[data-rdel]").forEach(el => el.addEventListener("click", () => { MS.rules.splice(+el.dataset.rdel, 1); renderRuleList(); toast("Đã xóa quy tắc."); }));
}
function openRule(idx) {
  const editing = idx !== null;
  const r = editing ? MS.rules[idx] : { name: "", when: "", risk: "amber", recipients: ["Bác sĩ phụ trách"], autoAppt: { on: false, specialty: "Tim mạch", within: "24 giờ" }, approval: false, active: true };
  const recAll = ["Bác sĩ phụ trách", "Điều dưỡng phụ trách", "Điều dưỡng trực", "Người nhà"];
  openDrawer(editing ? "Sửa giao thức" : "Thêm giao thức", `
    ${fieldInput("Tên giao thức", "name", "text", r.name)}
    <label class="f"><span>Điều kiện kích hoạt (khi…)</span>
      <textarea class="input" name="when" rows="2" placeholder="VD: Khó thở khi nằm = Có VÀ Phù chi = Tăng">${esc(r.when)}</textarea></label>
    ${fieldSelect("Mức ưu tiên gắn cờ", "risk", ["Nguy cơ cao", "Cần theo dõi", "Ổn định"], RISK[r.risk].label)}
    <div class="f"><span>Báo cho ai</span>
      ${recAll.map(x => `<label class="check"><input type="checkbox" name="rec" value="${esc(x)}" ${r.recipients.includes(x) ? "checked" : ""}> ${esc(x)}</label>`).join("")}</div>
    <label class="check"><input type="checkbox" name="autoOn" ${r.autoAppt.on ? "checked" : ""}> Tự động đặt lịch khám</label>
    ${fieldSelect("Chuyên khoa khám", "spec", SPECIALTIES, r.autoAppt.specialty)}
    ${fieldSelect("Trong vòng", "within", ["24 giờ", "48 giờ", "72 giờ", "1 tuần"], r.autoAppt.within || "24 giờ")}
    <label class="check"><input type="checkbox" name="approval" ${r.approval ? "checked" : ""}> Cần bác sĩ duyệt trước khi thực hiện</label>
    <div class="drawer-actions"><button class="btn btn-leaf btn-block" id="ruleSave">${editing ? "Lưu thay đổi" : "Thêm giao thức"}</button></div>`,
    box => $("#ruleSave", box).addEventListener("click", () => {
      const riskMap = { "Nguy cơ cao": "red", "Cần theo dõi": "amber", "Ổn định": "green" };
      const data = {
        id: r.id || ("r" + Date.now()), active: r.active !== false,
        name: $('[name=name]', box).value.trim() || "Giao thức mới",
        when: $('[name=when]', box).value.trim() || "—",
        risk: riskMap[$('[name=risk]', box).value],
        recipients: $all('[name=rec]:checked', box).map(c => c.value),
        autoAppt: { on: $('[name=autoOn]', box).checked, specialty: $('[name=spec]', box).value, within: $('[name=within]', box).value },
        approval: $('[name=approval]', box).checked,
      };
      if (editing) MS.rules[idx] = data; else MS.rules.push(data);
      closeDrawer(); renderRuleList(); toast(editing ? "Đã lưu giao thức." : "Đã thêm giao thức.");
    }));
}

/* =========================================================================
   4) AI Performance Dashboard
   ========================================================================= */
function renderPerformance() {
  const P = MS.performance || { total_calls: 0, by_tier: { red: 0, amber: 0, green: 0 },
    escalated: 0, patients: 0, overdue: 0, escalation_rate: 0 };
  const total = P.total_calls || 0;
  const pct = n => total ? Math.round(n / total * 100) : 0;
  const cards = [
    { value: P.patients, label: "Bệnh nhân theo dõi", tone: "ink" },
    { value: P.total_calls, label: "Cuộc gọi đã ghi nhận", tone: "green" },
    { value: P.escalated, label: "Ca nâng cảnh báo", tone: "red" },
    { value: P.escalation_rate + "%", label: "Tỷ lệ chuyển cảnh báo", tone: "amber" },
    { value: P.overdue, label: "Cuộc gọi quá hạn", tone: "ink" },
  ];
  const bands = [
    { band: "Nguy cơ cao", n: P.by_tier.red, tone: "red" },
    { band: "Cần theo dõi", n: P.by_tier.amber, tone: "amber" },
    { band: "Ổn định", n: P.by_tier.green, tone: "green" },
  ];
  const m = Metrics.read();
  const interactions = Object.values(m.counts).reduce((n, v) => n + v, 0);
  $("#managerView").innerHTML = `
    <div class="perf-stats">
      ${cards.map(c => `<div class="perf-stat ${c.tone}"><div class="v">${esc(String(c.value))}</div><div class="l">${esc(c.label)}</div></div>`).join("")}
    </div>
    <div class="mgrid">
      <div class="mcard">
        <h3>Phân bố kết quả cuộc gọi</h3>
        ${bands.map(b => `<div class="bar-item"><div class="row"><span>${esc(b.band)}</span><b>${b.n} (${pct(b.n)}%)</b></div>
          <div class="track"><div class="fill" style="width:${pct(b.n)}%;background:var(--${b.tone})"></div></div></div>`).join("")}
        <p class="muted-note" style="margin-top:10px">Tính trực tiếp từ ${total} cuộc gọi đã ghi nhận.</p>
      </div>
      <div class="mcard">
        <h3>Tương tác trong hệ thống</h3>
        <p class="muted-note">Ghi nhận cục bộ để theo dõi cách sử dụng — <b>${interactions}</b> thao tác.</p>
      </div>
    </div>`;
}

/* =========================================================================
   5) Notification Center
   ========================================================================= */
function renderNotifications() {
  $("#managerView").innerHTML = `<div class="mcard"><div class="h-row"><h3>Trung tâm thông báo</h3></div><div id="notifList"></div></div>`;
  renderNotifList();
}
function renderNotifList() {
  const el = $("#notifList");
  const total = MS.notifications.reduce((n, g) => n + g.items.length, 0);
  if (!total) { el.innerHTML = `<div class="empty">Không có thông báo nào.</div>`; return; }
  el.innerHTML = MS.notifications.filter(g => g.items.length).map((g, gi) => `
    <div class="notif-group">
      <div class="g-head"><span class="dot ${g.tone}"></span><h4>${esc(g.group)}</h4>
        <span class="badge ${g.tone === "red" ? "red" : g.tone === "amber" ? "amber" : "green"}" style="padding:1px 8px">${g.items.length}</span></div>
      ${g.items.map((it, ii) => `<div class="notif-item">
        <span class="grow">${esc(it.text)}</span>
        ${it.action ? `<button class="btn btn-sm" data-na="${gi}:${ii}">${esc(it.action)}</button>` : ""}
        <button class="btn btn-sm btn-danger" data-nd="${gi}:${ii}">Bỏ qua</button></div>`).join("")}
    </div>`).join("");

  $all("[data-na]").forEach(b => b.addEventListener("click", () => {
    const [gi, ii] = b.dataset.na.split(":").map(Number);
    const it = MS.notifications[gi].items[ii];
    if (it.action === "Xem lịch") location.href = "appointments.html";
    else if (it.mrn) openCase(it.mrn);
  }));
  $all("[data-nd]").forEach(b => b.addEventListener("click", () => {
    const [gi, ii] = b.dataset.nd.split(":").map(Number);
    MS.notifications[gi].items.splice(ii, 1); renderNotifList(); renderTabs(); toast("Đã bỏ qua thông báo.");
  }));
}

/* ---- boot ------------------------------------------------------------- */
window.addEventListener("hashchange", route);
AfterCare.ready(async () => {
  try { await hydrateManager(); }
  catch (e) { console.error("[manager] hydrate failed", e); }
  route();
});
