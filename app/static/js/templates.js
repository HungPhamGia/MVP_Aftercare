/* =========================================================================
   AfterCare · templates.js — "Bộ câu hỏi theo bệnh" (per-disease default set).
   Full CRUD, persisted to DB via /his/templates. Every add / edit / delete /
   required-toggle saves the whole template back with PUT. Reuses manager.css.
   ========================================================================= */

const DISEASES = ["Hậu phẫu", "Sản khoa", "Chấn thương chỉnh hình", "Tiêu hóa", "Nội tổng quát"];
const T = { list: [], sel: null };

function selTemplate() { return T.list.find(t => t.id === T.sel); }

async function loadTemplates(keepSel) {
  T.list = (await API.get("/his/templates")) || [];
  if (!keepSel || !selTemplate()) T.sel = T.list[0] ? T.list[0].id : null;
}

/* persist the selected template (questions + meta) — called after each edit */
async function saveTemplate() {
  const t = selTemplate();
  if (!t) return;
  try {
    await API.put("/his/templates/" + t.id, {
      disease: t.disease, name: t.name, active: !!t.active,
      assign: t.assign || null, questions: t.questions || [],
    });
  } catch (e) { toast("Lưu thất bại: " + e.message); }
}

/* ---- render ----------------------------------------------------------- */
function render() {
  $("#tplRoot").innerHTML = `
    <div class="mgrid wide">
      <div class="mcard">
        <div class="h-row"><h3>Bộ câu hỏi theo bệnh</h3><span class="grow"></span>
          <button class="btn btn-leaf btn-sm" id="tplNew">＋ Thêm bộ câu hỏi</button></div>
        <div class="tpl-list" id="tplList"></div>
      </div>
      <div class="mcard" id="tplEditor"></div>
    </div>`;
  $("#tplNew").addEventListener("click", createTemplate);
  renderList();
  renderEditor();
}

function renderList() {
  $("#tplList").innerHTML = T.list.length ? T.list.map(t => `
    <div class="tpl-item ${t.id === T.sel ? "active" : ""}" data-tpl="${t.id}">
      <div class="d">${esc(t.disease)}</div><div class="n">${esc(t.name)}</div>
      <div class="meta"><span class="mono">${esc(t.version || "v1")}</span> · ${(t.questions || []).length} câu ·
        ${t.active ? `<span class="pill green" style="padding:1px 8px">Đang dùng</span>` : `<span class="pill muted" style="padding:1px 8px">Tắt</span>`}</div>
    </div>`).join("") : `<div class="empty">Chưa có bộ câu hỏi nào.</div>`;
  $all("#tplList .tpl-item").forEach(el =>
    el.addEventListener("click", () => { T.sel = +el.dataset.tpl; render(); }));
}

function renderEditor() {
  const t = selTemplate();
  if (!t) { $("#tplEditor").innerHTML = `<div class="empty">Chọn hoặc tạo một bộ câu hỏi.</div>`; return; }
  $("#tplEditor").innerHTML = `
    <div class="h-row">
      <h3>${esc(t.name)}</h3>
      <span class="pill ${t.active ? "green" : "muted"}">${t.active ? "Đang dùng" : "Đã tắt"}</span>
      <span class="grow"></span>
      <label class="check" style="padding:0">Bật bộ câu hỏi
        <span class="toggle"><input type="checkbox" id="tplActive" ${t.active ? "checked" : ""}><span class="track"></span></span></label>
      <button class="btn btn-sm btn-danger" id="tplDel">Xóa bộ</button>
    </div>
    <div class="cfg-row"><span class="lbl">Bệnh</span>
      <select class="select" id="tplDisease">${DISEASES.map(d => `<option ${d === t.disease ? "selected" : ""}>${esc(d)}</option>`).join("")}</select></div>
    <div class="cfg-row"><span class="lbl">Tên bộ</span>
      <input class="input" id="tplName" value="${esc(t.name)}" style="flex:1;min-width:200px"></div>

    <p class="muted-note" style="margin:6px 0 12px">Bấm nhãn <b>Bắt buộc/Tùy chọn</b> để đổi trạng thái. Câu bắt buộc luôn được thêm vào bộ câu hỏi của bệnh nhân.</p>
    <div id="qList"></div>
    <div class="cfg-row" style="margin-top:6px"><input class="input" id="qNew" placeholder="Thêm câu hỏi mới…" style="flex:1;min-width:200px">
      <button class="btn btn-leaf btn-sm" id="qAdd">Thêm câu hỏi</button></div>`;

  $("#tplActive").addEventListener("change", async e => {
    t.active = e.target.checked; await saveTemplate(); renderList(); renderEditor();
    toast(t.active ? "Đã bật bộ câu hỏi." : "Đã tắt bộ câu hỏi.");
  });
  $("#tplDel").addEventListener("click", deleteTemplate);
  $("#tplDisease").addEventListener("change", async e => { t.disease = e.target.value; await saveTemplate(); renderList(); });
  $("#tplName").addEventListener("change", async e => { t.name = e.target.value.trim() || t.name; await saveTemplate(); renderList(); renderEditor(); });
  $("#qAdd").addEventListener("click", addQuestion);
  $("#qNew").addEventListener("keydown", e => { if (e.key === "Enter") addQuestion(); });
  renderQList();
}

function renderQList() {
  const t = selTemplate();
  $("#qList").innerHTML = (t.questions || []).map((q, i) => `
    <div class="q-row" data-i="${i}">
      <div class="q-main">
        <textarea class="input q-text" data-qtext="${i}" rows="2">${esc(q.text)}</textarea>
        <div class="q-flags">
          <span class="req-pill ${q.required ? "req" : "opt"}" data-req="${i}">${q.required ? "Bắt buộc" : "Tùy chọn"}</span>
        </div>
      </div>
      <div class="q-actions">
        <button class="btn tiny btn-danger" data-del="${i}">Xóa</button>
      </div>
    </div>`).join("") || `<p class="muted-note">Chưa có câu hỏi nào.</p>`;

  $all("#qList [data-qtext]").forEach(el => el.addEventListener("change", async () => {
    const q = t.questions[+el.dataset.qtext];
    const v = el.value.trim();
    if (!v) { renderQList(); return; }
    q.text = v; await saveTemplate();
  }));
  $all("#qList [data-req]").forEach(el => el.addEventListener("click", async () => {
    const q = t.questions[+el.dataset.req]; q.required = !q.required;
    await saveTemplate(); renderQList();
  }));
  $all("#qList [data-del]").forEach(el => el.addEventListener("click", async () => {
    t.questions.splice(+el.dataset.del, 1); await saveTemplate(); renderQList(); renderList();
    toast("Đã xóa câu hỏi.");
  }));
}

/* ---- mutations -------------------------------------------------------- */
async function addQuestion() {
  const inp = $("#qNew"), txt = inp.value.trim();
  if (!txt) { toast("Nhập nội dung câu hỏi."); return; }
  const t = selTemplate();
  (t.questions = t.questions || []).push({ text: txt, required: false });
  inp.value = "";
  await saveTemplate(); renderQList(); renderList();
  toast("Đã thêm câu hỏi.");
}

function createTemplate() {
  openDrawer("Thêm bộ câu hỏi", `
    ${fieldSelect("Bệnh", "disease", DISEASES, DISEASES[0])}
    ${fieldInput("Tên bộ câu hỏi", "name", "text", "")}
    <div class="drawer-actions"><button class="btn btn-leaf btn-block" id="tcSave">Tạo bộ</button></div>`,
    box => $("#tcSave", box).addEventListener("click", async () => {
      const disease = $('[name=disease]', box).value;
      const name = $('[name=name]', box).value.trim() || ("Bộ câu hỏi " + disease);
      try {
        const res = await API.post("/his/templates", { disease, name, active: true, questions: [] });
        closeDrawer();
        await loadTemplates(false); T.sel = res.id; render();
        toast("Đã tạo bộ câu hỏi.");
      } catch (e) { toast("Tạo thất bại: " + e.message); }
    }));
}

async function deleteTemplate() {
  const t = selTemplate();
  if (!t) return;
  if (!confirm(`Xóa bộ câu hỏi “${t.name}”?`)) return;
  try {
    await API.del("/his/templates/" + t.id);
    await loadTemplates(false); render();
    toast("Đã xóa bộ câu hỏi.");
  } catch (e) { toast("Xóa thất bại: " + e.message); }
}

/* ---- boot --------------------------------------------------------------
   Only self-boot on the standalone page (templates.html). When this file
   is loaded inside manager.html, manager.js's "Bộ câu hỏi" tab calls
   loadTemplates()/render() itself once that tab becomes active. */
if (document.body.dataset.page === "templates") {
  document.addEventListener("DOMContentLoaded", async () => {
    try { await loadTemplates(false); }
    catch (e) { toast("Không tải được bộ câu hỏi: " + e.message); }
    render();
  });
}
