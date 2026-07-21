/* =========================================================================
   AfterCare · dashboard.js — actionable work board, driven entirely by the
   live roster (/his/patients) + re-exam appointments (/his/appointments).
   ========================================================================= */

function isToday(iso) {
  if (!iso) return false;
  return new Date(iso).toDateString() === new Date().toDateString();
}
function needsReview() {
  const rank = { red: 0, amber: 1, green: 2, unknown: 3 };
  return PATIENTS.filter(p => p.needsReview)
    .sort((a, b) => (rank[a.risk] - rank[b.risk]) || (b.escalated - a.escalated));
}
function overdueList() { return PATIENTS.filter(p => p.overdue); }
/* patients whose latest call failed (refused / no answer) — need a re-call */
function failedCalls() { return PATIENTS.filter(p => p.lastCallFailed); }
function upcomingCalls() {
  // scheduled but not yet past — overdue ones live in their own section below
  return PATIENTS.filter(p => p.nextCall.status === "scheduled" && !p.overdue)
    .sort((a, b) => String(a.nextCall.iso).localeCompare(String(b.nextCall.iso)));
}

const ICON_SEARCH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7.2"/><path d="M21 21l-4.4-4.4"/></svg>`;
const ICON_BELL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8.2a6 6 0 0112 0c0 4.1 1.5 5.6 2 6.6H4c.5-1 2-2.5 2-6.6z"/><path d="M9.5 17.3a2.5 2.5 0 005 0"/></svg>`;

let DASH_NOTIFS = [];  // grouped notifications from /his/notifications, loaded once in boot

function notifCount() { return DASH_NOTIFS.reduce((n, g) => n + (g.items || []).length, 0); }

function renderTopbar() {
  $("#topBar").innerHTML = `
    <label class="ph-search">
      <span class="ts-ico">${ICON_SEARCH}</span>
      <input type="search" id="topSearch" placeholder="Tìm bệnh nhân theo tên hoặc mã hồ sơ…">
    </label>
    <div class="notif-wrap">
      <button class="notif-btn" id="notifBtn" type="button" aria-haspopup="true" aria-expanded="false">
        <span class="nb-ico">${ICON_BELL}</span><span class="nb-word">Thông báo</span>
        <span class="nb-count" id="nbCount" hidden>0</span>
      </button>
      <div class="notif-panel" id="notifPanel" hidden></div>
    </div>
    <a class="btn btn-leaf" href="manager.html#calendar">Quản lý gọi AI</a>`;

  const search = $("#topSearch");
  const goSearch = () => {
    const q = search.value.trim();
    location.href = "patients.html" + (q ? "?q=" + encodeURIComponent(q) : "");
  };
  search.addEventListener("keydown", e => { if (e.key === "Enter") goSearch(); });

  wireNotifBell();
  renderNotifBadge();
}

function notifIcon(tone) { return tone === "red" ? "!" : tone === "amber" ? "●" : "✓"; }

function renderNotifBadge() {
  const n = notifCount();
  const c = $("#nbCount");
  c.hidden = !n; c.textContent = n;
}

function renderNotifPanel() {
  const panel = $("#notifPanel");
  const groups = DASH_NOTIFS.filter(g => (g.items || []).length);
  panel.innerHTML = `
    <div class="np-head"><strong>Thông báo</strong>${notifCount() ? `<span class="pill red" style="padding:1px 8px">${notifCount()}</span>` : ""}</div>
    <div class="np-list">
      ${groups.length ? groups.map(g => `
        <div class="np-group">
          <div class="np-gtitle">${esc(g.group)}</div>
          ${g.items.map((it, ii) => `
            <button class="np-item" data-tone="${g.tone}" data-mrn="${esc(it.ma_ho_so || "")}">
              <span class="np-dot ${g.tone}">${notifIcon(g.tone)}</span>
              <span class="np-body"><span class="np-text">${esc(it.text)}</span></span>
            </button>`).join("")}
        </div>`).join("") : `<div class="np-empty">Không có thông báo nào.</div>`}
    </div>`;
  $all(".np-item[data-mrn]", panel).forEach(b => {
    if (!b.dataset.mrn) return;
    b.addEventListener("click", () => openCase(b.dataset.mrn));
  });
}

function wireNotifBell() {
  const btn = $("#notifBtn"), panel = $("#notifPanel");
  const close = () => { panel.hidden = true; btn.setAttribute("aria-expanded", "false"); };
  const open = () => { renderNotifPanel(); panel.hidden = false; btn.setAttribute("aria-expanded", "true"); };
  btn.addEventListener("click", e => { e.stopPropagation(); panel.hidden ? open() : close(); });
  document.addEventListener("click", e => { if (!panel.hidden && !e.target.closest(".notif-wrap")) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
}

function quickCounts(appts) {
  $("#quickCounts").innerHTML = `
    <span class="quick"><span class="dot" style="background:var(--red)"></span>Cần xem <b>${needsReview().length}</b></span>
    <span class="quick">Cuộc gọi sắp tới <b>${upcomingCalls().length}</b></span>
    <span class="quick"><span class="dot" style="background:var(--amber)"></span>Gọi không thành công <b>${failedCalls().length}</b></span>
    <span class="quick">Lịch tái khám <b>${appts.length}</b></span>
    <span class="quick">Tái khám hôm nay <b>${appts.filter(a => isToday(a.date)).length}</b></span>`;
}

function workItem(opts) {
  const actions = (opts.actions || []).map(a =>
    `<button class="btn btn-sm ${a.cls || ""}" type="button" data-act="${esc(a.act)}" data-mrn="${esc(opts.mrn || "")}">${esc(a.label)}</button>`
  ).join("");
  return `
    <div class="work-item ${opts.tone || ""}" ${opts.mrn ? `data-mrn="${esc(opts.mrn)}"` : ""}>
      <div>
        <div class="who">${opts.badge || ""}<strong>${esc(opts.title)}</strong>
          ${opts.meta ? `<span class="meta">${esc(opts.meta)}</span>` : ""}</div>
        ${opts.reason ? `<div class="reason">${esc(opts.reason)}</div>` : ""}
      </div>
      <div class="actions">${opts.time ? `<span class="time">${esc(opts.time)}</span>` : ""}${actions}</div>
    </div>`;
}

function section(opts) {
  const total = opts.total != null ? opts.total : opts.items.length;
  const body = opts.items.length ? opts.items.join("")
    : `<div class="work-empty">${esc(opts.empty || "Không có mục nào.")}</div>`;
  const more = total > opts.items.length;
  return `
    <section class="work-section ${opts.primary ? "primary" : ""}">
      <div class="work-head">
        <span class="ico ${opts.tone}">${opts.icon || ""}</span>
        <span class="ttl">${esc(opts.title)}</span>
        <span class="count">${total}</span>
        <span class="grow"></span>
        ${opts.link ? `<a class="link" href="${opts.link}">${esc(more ? "Xem tất cả" : (opts.linkText || "Xem tất cả"))}</a>` : ""}
      </div>
      ${body}
    </section>`;
}

function renderBoard(appts) {
  /* PRIMARY — patients flagged by their latest call (red/amber/escalated) */
  const review = needsReview().map(p => workItem({
    mrn: p.mrn, tone: p.risk, badge: riskBadge(p.risk),
    title: p.name, meta: `${p.age}t · ${p.surgery} · ngày ${p.day}`, reason: p.reason,
    actions: [{ act: "open", label: "Xem & xử lý", cls: "btn-leaf" }, { act: "call", label: "Gọi" }],
  }));
  /* failed calls (refused / no answer) — patient is still "chưa đánh giá" */
  const failed = failedCalls().map(p => workItem({
    mrn: p.mrn, tone: "amber", title: p.name,
    meta: `${p.age}t · ${p.surgery} · ngày ${p.day}`, reason: p.lastContact,
    actions: [{ act: "call", label: "Gọi lại", cls: "btn-leaf" }, { act: "open", label: "Mở ca" }],
  }));

  $("#boardPrimary").innerHTML = section({
    title: "Cần bác sĩ xem", tone: "red", icon: "!", primary: true, items: review,
    link: "patients.html", linkText: "Tất cả bệnh nhân", empty: "Không có ca nào cần xem.",
  }) + section({
    title: "Gọi không thành công", tone: "amber", icon: "✕", items: failed,
    link: "patients.html", linkText: "Tất cả bệnh nhân",
    empty: "Không có cuộc gọi thất bại.",
  });

  /* SECONDARY */
  const callsAll = upcomingCalls();
  const calls = callsAll.slice(0, 3).map(p => workItem({
    mrn: p.mrn, tone: "info", title: p.name, meta: p.group, reason: p.reason,
    time: `${p.nextCall.date} ${p.nextCall.time}`,
    actions: [{ act: "open", label: "Mở ca" }],
  }));

  const apUp = appts.slice(0, 3).map(a => workItem({
    mrn: a.ma_ho_so, tone: "green", title: a.ho_ten, meta: a.specialty, reason: a.chan_doan,
    time: fmtDate(a.date), actions: [{ act: "appts", label: "Xem lịch" }],
  }));

  $("#boardSec").innerHTML =
    section({ title: "Cuộc gọi sắp tới", tone: "info", icon: "☎", items: calls, total: callsAll.length,
              link: "manager.html#calendar", empty: "Không có cuộc gọi sắp tới." }) +
    section({ title: "Lịch tái khám", tone: "green", icon: "◷", items: apUp, total: appts.length,
              link: "appointments.html", empty: "Chưa có lịch tái khám." });

  wireBoard();
}

function wireBoard() {
  $all(".work-item[data-mrn]").forEach(row => {
    attachPreview(row, row.dataset.mrn);
    row.addEventListener("click", e => { if (!e.target.closest("[data-act]")) openCase(row.dataset.mrn); });
  });
  $all("[data-act]").forEach(btn => btn.addEventListener("click", e => {
    e.stopPropagation();
    const mrn = btn.dataset.mrn, act = btn.dataset.act;
    if (act === "open") openCase(mrn);
    else if (act === "call") trackGo("call:start", "Gọi: " + mrn, "call.html?id=" + mrn);
    else if (act === "appts") location.href = "appointments.html";
  }));
}

AfterCare.ready(async () => {
  let appts = [];
  try { appts = await AfterCare.appointments(); } catch (e) { console.warn("[dashboard] appointments", e); }
  try { DASH_NOTIFS = await AfterCare.notifications(); } catch (e) { console.warn("[dashboard] notifications", e); }
  renderTopbar(); quickCounts(appts); renderBoard(appts);
});
