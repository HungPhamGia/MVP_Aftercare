/* =========================================================================
   AfterCare · call.js — manual call workspace
   ========================================================================= */

function callId() { return new URLSearchParams(location.search).get("id") || ""; }

function copyNum(num, btn) {
  const clean = String(num).replace(/[^\d+]/g, "");
  const done = () => { const t = btn.textContent; btn.textContent = "Đã chép"; setTimeout(() => btn.textContent = t, 1200); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(clean).then(done, done);
  else { const ta = document.createElement("textarea"); ta.value = clean; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e) {} ta.remove(); done(); }
}

function contactRow(label, value) {
  const callable = /\d/.test(value);
  const tel = String(value).replace(/[^\d+]/g, "");
  return `<div class="contact">
    <span class="lbl">${esc(label)}</span>
    <span class="num">${esc(value)}</span>
    <span class="acts">
      ${callable ? `<button class="btn btn-sm" data-copy="${esc(value)}">Sao chép</button>
      <a class="btn btn-sm btn-leaf" href="tel:${esc(tel)}">Gọi</a>` : ""}
    </span></div>`;
}

function renderCall() {
  const mrn = callId();
  const p = getPatient(mrn) || PATIENTS[0];
  if (!p) { $("#callView").innerHTML = `<div class="card empty">Không tìm thấy bệnh nhân.</div>`; return; }
  const ph = { patient: p.phonePatient || "—", family: p.phoneFamily || "—" };

  $("#callTop").innerHTML = `
    <a class="case-back" href="case.html?id=${esc(p.mrn)}" aria-label="Quay lại">&#8592;</a>
    <div><div class="crumb">Chi tiết ca &nbsp;&rsaquo;&nbsp; Gọi bệnh nhân</div>
      <h1>Gọi · ${esc(p.name)}</h1></div>`;

  $("#callView").innerHTML = `
    <section class="card call-card">
      <div class="call-id">
        <div class="avatar">${esc(avatarInitials(p.name))}</div>
        <div><h2>${esc(p.name)}</h2><div class="who">${esc(p.sex)} ${p.age} tuổi · Mã HS ${esc(p.mrn)} · ${esc(p.diagnosis)}</div></div>
        <span class="grow"></span>${riskBadge(p.risk)}
      </div>

      ${contactRow("Bệnh nhân", ph.patient)}
      ${contactRow("Người nhà", ph.family)}

      <div class="call-field"><span>Ghi chú cuộc gọi</span>
        <textarea id="callNote" placeholder="Ghi nhận triệu chứng, dặn dò, cam kết của bệnh nhân…"></textarea></div>

      <div class="call-field"><span>Kết quả cuộc gọi</span>
        <select id="callOutcome">
          <option value="green">Ổn định — tiếp tục theo dõi</option>
          <option value="amber">Cần theo dõi thêm</option>
          <option value="red">Nguy cơ cao — cần can thiệp</option>
          <option value="no_contact">Không liên lạc được</option>
        </select></div>

      <div class="call-foot">
        <button class="btn btn-leaf" id="btnComplete">Hoàn tất cuộc gọi</button>
        <a class="btn" href="case.html?id=${esc(p.mrn)}">Quay lại hồ sơ</a>
      </div>
      <p class="call-hint">Nút “Gọi” mở trình gọi của thiết bị. Ghi chú và kết quả được lưu vào hồ sơ ca.</p>
    </section>`;

  $all("[data-copy]").forEach(b => b.addEventListener("click", () => copyNum(b.dataset.copy, b)));
  $("#btnComplete").addEventListener("click", async () => {
    const btn = $("#btnComplete");
    btn.disabled = true; btn.textContent = "Đang lưu…";
    try {
      await API.post("/his/call-manual/save", {
        ma_ho_so: p.mrn,
        outcome: $("#callOutcome").value,
        note: $("#callNote").value.trim(),
      });
    } catch (e) {
      btn.disabled = false; btn.textContent = "Hoàn tất cuộc gọi";
      toast("Không lưu được cuộc gọi: " + e.message);
      return;
    }
    Metrics.track("call:complete", "Hoàn tất gọi: " + p.name);
    toast("Đã lưu cuộc gọi vào hồ sơ ca.");
    setTimeout(() => location.href = "case.html?id=" + p.mrn, 900);
  });
}

AfterCare.ready(renderCall);
