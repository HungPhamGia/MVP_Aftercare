/* =========================================================================
   AfterCare · dashboard.js — actionable work board, driven entirely by the
   live roster (/his/patients) + re-exam appointments (/his/appointments).
   ========================================================================= */

function isToday(iso) {
  if (!iso) return false;
  return new Date(iso).toDateString() === new Date().toDateString();
}
function needsReview() { return PATIENTS.filter(p => p.needsReview); }
function overdueList() { return PATIENTS.filter(p => p.overdue); }
function upcomingCalls() {
  // scheduled but not yet past — overdue ones live in their own section below
  return PATIENTS.filter(p => p.nextCall.status === "scheduled" && !p.overdue)
    .sort((a, b) => String(a.nextCall.iso).localeCompare(String(b.nextCall.iso)));
}

function dashActions() {
  const od = overdueList().length;
  $("#dashActions").innerHTML = `
    <a class="btn" href="manager.html#notifications">Thông báo${od ? ` · ${od}` : ""}</a>
    <a class="btn btn-leaf" href="manager.html#calendar">Quản lý gọi AI</a>`;
}

function quickCounts(appts) {
  $("#quickCounts").innerHTML = `
    <span class="quick"><span class="dot" style="background:var(--red)"></span>Cần xem <b>${needsReview().length}</b></span>
    <span class="quick">Cuộc gọi sắp tới <b>${upcomingCalls().length}</b></span>
    <span class="quick">Quá hạn gọi <b>${overdueList().length}</b></span>
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
  $("#boardPrimary").innerHTML = section({
    title: "Cần bác sĩ xem", tone: "red", icon: "!", primary: true, items: review,
    link: "patients.html", linkText: "Tất cả bệnh nhân", empty: "Không có ca nào cần xem.",
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
  dashActions(); quickCounts(appts); renderBoard(appts);
});
