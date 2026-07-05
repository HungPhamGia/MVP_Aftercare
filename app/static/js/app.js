/* =========================================================================
   AfterCare · app.js  (shared across every page)
   Sidebar, responsive nav, action drawer, reusable component helpers,
   toast, and the background metrics collector (kept, surfaced only on the
   AI Performance dashboard — never as a developer tool).
   ========================================================================= */

function $(sel, root) { return (root || document).querySelector(sel); }
function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/* ---- toast ------------------------------------------------------------ */
function toast(message) {
  let el = $(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("show"), 2400);
}

/* ---- metrics (kept; read by AI Performance) --------------------------- */
const Metrics = {
  KEY: "aftercare_metrics",
  _bc: (typeof BroadcastChannel !== "undefined") ? new BroadcastChannel("aftercare_metrics") : null,
  read() {
    try { const r = JSON.parse(localStorage.getItem(this.KEY)); if (r && r.counts && Array.isArray(r.log)) return r; } catch (e) {}
    return { counts: {}, log: [], updated: null };
  },
  write(d) { try { localStorage.setItem(this.KEY, JSON.stringify(d)); } catch (e) {} },
  track(name, label) {
    const d = this.read();
    d.counts[name] = (d.counts[name] || 0) + 1;
    d.log.unshift({ t: new Date().toISOString(), name, label: label || name });
    if (d.log.length > 250) d.log.length = 250;
    d.updated = new Date().toISOString();
    this.write(d);
    if (this._bc) { try { this._bc.postMessage({ type: "track" }); } catch (e) {} }
  },
};

function trackGo(name, label, href) { Metrics.track(name, label); location.href = href; }
function openCase(mrn, label) { trackGo("case_open", label || ("Mở ca: " + mrn), "case.html?id=" + mrn); }

/* ---- user settings (clinician preference, stored locally) ------------- */
const Settings = {
  KEY: "aftercare_settings",
  read() {
    try { return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem(this.KEY)) || {}); }
    catch (e) { return Object.assign({}, DEFAULT_SETTINGS); }
  },
  write(s) { try { localStorage.setItem(this.KEY, JSON.stringify(s)); } catch (e) {} },
  apply() {
    const s = this.read();
    const root = document.documentElement;
    root.dataset.theme = s.theme;
    root.dataset.font = s.fontScale;
    root.dataset.scale = s.uiScale;
    root.dataset.contrast = s.highContrast ? "high" : "normal";
    root.dataset.motion = s.reduceMotion ? "reduce" : "auto";
    /* reflect editable identity into the running session */
    CURRENT_USER.name = s.name;
    CURRENT_USER.role = s.dept || s.role;
    CURRENT_USER.initials = (s.name || "BS").replace(/^BS\.?\s*/i, "").trim().split(/\s+/)
      .map(w => w[0]).slice(-2).join("").toUpperCase() || "BS";
  },
};

/* ---- reusable hover preview ------------------------------------------- */
function patientPreviewHtml(p) {
  if (!p) return "";
  const next = p.nextCall && p.nextCall.status !== "none"
    ? `${esc(p.nextCall.date)} ${esc(p.nextCall.time)} ${callPill(p.nextCall.status)}`
    : `<span class="pill muted">Chưa lên lịch</span>`;
  // reason/summary share one source (the latest call's AI summary) — one row,
  // labeled by context, instead of the same text printed twice.
  const called = !!p.lastContact && p.lastContact !== "Chưa gọi";
  const noteLbl = (p.escalated || p.risk === "red") ? "Lý do cảnh báo"
    : called ? "Tóm tắt AI" : "Lý do theo dõi";
  return `
    <div class="pv-head">${riskBadge(p.risk)}<strong>${esc(p.name)}</strong>
      <span class="pv-meta">${p.age} tuổi · ${esc(p.diagnosis)}</span></div>
    <dl class="pv-grid">
      <dt>${noteLbl}</dt><dd>${esc(p.summary || p.reason)}</dd>
      <dt>Gọi gần nhất</dt><dd>${esc(p.lastContact)}</dd>
      <dt>Gọi kế tiếp</dt><dd>${next}</dd>
    </dl>`;
}
let _pvEl;
function attachPreview(el, mrn) {
  el.addEventListener("mouseenter", () => showPreview(el, mrn));
  el.addEventListener("mouseleave", hidePreview);
  el.addEventListener("focus", () => showPreview(el, mrn));
  el.addEventListener("blur", hidePreview);
}
function showPreview(anchor, mrn) {
  const p = getPatient(mrn); if (!p) return;
  if (!_pvEl) { _pvEl = document.createElement("div"); _pvEl.className = "preview-card"; document.body.appendChild(_pvEl); }
  _pvEl.innerHTML = patientPreviewHtml(p);
  const r = anchor.getBoundingClientRect();
  _pvEl.style.display = "block";
  const w = 320; let left = r.right + 12;
  if (left + w > window.innerWidth - 12) left = Math.max(12, r.left - w - 12);
  let top = r.top; const h = _pvEl.offsetHeight;
  if (top + h > window.innerHeight - 12) top = Math.max(12, window.innerHeight - h - 12);
  _pvEl.style.left = left + "px"; _pvEl.style.top = (top + window.scrollY) + "px";
}
function hidePreview() { if (_pvEl) _pvEl.style.display = "none"; }

/* ---- reusable component helpers --------------------------------------- */
function riskBadge(risk) {
  return `<span class="badge ${risk}">${esc(RISK[risk] ? RISK[risk].label : risk)}</span>`;
}
function callPill(status) {
  const s = CALL_STATUS[status] || CALL_STATUS.none;
  return `<span class="pill ${s.tone}">${esc(s.label)}</span>`;
}
function avatarInitials(name) {
  const w = String(name).trim().split(/\s+/);
  return ((w[0][0] || "") + (w.length > 1 ? w[w.length - 1][0] : "")).toUpperCase();
}

/* ---- sidebar ---------------------------------------------------------- */
function renderSidebar() {
  const aside = $(".sidebar");
  if (!aside) return;
  const current = document.body.dataset.page;
  aside.innerHTML = `
    <div class="brand">
      <a href="index.html" aria-label="AfterCare"><img src="images/aftercare-logo.jpg" alt="AfterCare"></a>
      <button class="menu-button" type="button" data-nav-close aria-label="Menu">&#9776;</button>
    </div>
    <nav class="nav" aria-label="Điều hướng">
      ${NAV_GROUPS.map(g => `
        <div class="nav-group">
          <div class="nav-group-label">${esc(g.label)}</div>
          ${g.items.map(it => `
            <a class="nav-item${it.page === current ? " active" : ""}" href="${it.href}"
               ${it.page === current ? 'aria-current="page"' : ""}>${esc(it.label)}</a>`).join("")}
        </div>`).join("")}
    </nav>
    <div class="sidebar-spacer"></div>
    <a class="sidebar-profile" href="settings.html" title="Chỉnh sửa hồ sơ">
      <div class="avatar">${esc(CURRENT_USER.initials)}</div>
      <div><strong>${esc(CURRENT_USER.name)}</strong><span>${esc(CURRENT_USER.role)}</span></div>
    </a>`;
}

/* ---- responsive slide-over -------------------------------------------- */
function wireResponsiveNav() {
  if (!$(".sidebar")) return;
  if (!$(".scrim")) {
    const s = document.createElement("div"); s.className = "scrim"; s.dataset.navClose = "";
    document.body.appendChild(s);
  }
  if (!$(".nav-fab")) {
    const f = document.createElement("button");
    f.className = "nav-fab"; f.type = "button"; f.setAttribute("aria-label", "Mở menu"); f.innerHTML = "&#9776;";
    f.addEventListener("click", () => document.body.classList.add("nav-open"));
    document.body.appendChild(f);
  }
  document.addEventListener("click", e => { if (e.target.closest("[data-nav-close]")) document.body.classList.remove("nav-open"); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { document.body.classList.remove("nav-open"); closeDrawer(); } });
}

/* ---- action drawer (right side panel for doctor actions) -------------- */
function ensureDrawer() {
  if ($("#drawer")) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div id="drawerScrim" class="drawer-scrim"></div>
    <aside id="drawer" class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawerTitle">
      <header class="drawer-head">
        <h2 id="drawerTitle"></h2>
        <button class="icon-btn" type="button" id="drawerClose" aria-label="Đóng">&times;</button>
      </header>
      <div id="drawerBody" class="drawer-body"></div>
    </aside>`;
  document.body.appendChild(wrap);
  $("#drawerScrim").addEventListener("click", closeDrawer);
  $("#drawerClose").addEventListener("click", closeDrawer);
}
function openDrawer(title, bodyHtml, onMount) {
  ensureDrawer();
  $("#drawerTitle").textContent = title;
  $("#drawerBody").innerHTML = bodyHtml;
  document.body.classList.add("drawer-open");
  if (typeof onMount === "function") onMount($("#drawerBody"));
}
function closeDrawer() { document.body.classList.remove("drawer-open"); }

/* form field helpers for drawers */
function fieldSelect(label, name, options, selected) {
  return `<label class="f"><span>${esc(label)}</span>
    <select name="${name}" class="select">
      ${options.map(o => `<option ${o === selected ? "selected" : ""}>${esc(o)}</option>`).join("")}
    </select></label>`;
}
function fieldInput(label, name, type, value) {
  return `<label class="f"><span>${esc(label)}</span>
    <input class="input" name="${name}" type="${type || "text"}" value="${esc(value || "")}"></label>`;
}

/* friendly page names for the activity log */
function pageLabel(page) {
  for (const g of NAV_GROUPS) { const f = g.items.find(i => i.page === page); if (f) return f.label; }
  return ({ case: "Chi tiết ca", call: "Màn hình cuộc gọi" })[page] || page;
}

/* ---- boot ------------------------------------------------------------- */
document.addEventListener("DOMContentLoaded", () => {
  Settings.apply();
  renderSidebar();
  wireResponsiveNav();
  const p = document.body.dataset.track || document.body.dataset.page || "unknown";
  Metrics.track("pageview:" + p, "Mở trang · " + pageLabel(p));
});
