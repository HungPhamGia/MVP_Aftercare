/* =========================================================================
   AfterCare · settings.js — profile, appearance, accessibility, help
   ========================================================================= */

let S = Settings.read();
function save(patch) {
  S = Object.assign(S, patch);
  Settings.write(S);
  Settings.apply();
  renderSidebar();            // reflect new name/role in sidebar
  Metrics.track("settings", "Cập nhật cài đặt");
}

function segPick(name, options, value) {
  return `<div class="seg-pick" data-seg="${name}">
    ${options.map(o => `<button data-val="${o.v}" class="${o.v === value ? "active" : ""}">${esc(o.l)}</button>`).join("")}</div>`;
}

function render() {
  const v = $("#settingsView");
  v.innerHTML = `
    <section class="set-card">
      <h3>Hồ sơ bác sĩ</h3>
      <div class="login-banner" id="loginBanner"></div>
      <div class="prof-head">
        <div class="avatar">${esc(CURRENT_USER.initials)}</div>
        <div><div class="nm">${esc(S.name)}</div><div class="rl">${esc(S.role)} · ${esc(S.dept)}</div></div>
      </div>
      <label class="f"><span>Họ và tên</span><input class="input" id="sName" value="${esc(S.name)}"></label>
      <label class="f"><span>Chức danh</span><input class="input" id="sRole" value="${esc(S.role)}"></label>
      <label class="f"><span>Khoa / Phòng</span><input class="input" id="sDept" value="${esc(S.dept)}"></label>
      <button class="btn btn-leaf" id="sProfSave">Lưu hồ sơ</button>
    </section>

    <section class="set-card">
      <h3>Giao diện</h3>
      <div class="set-row"><div class="grow"><div class="rl">Chế độ màu</div><div class="rd">Nền sáng cho ban ngày, nền tối khi trực đêm</div></div>
        ${segPick("theme", [{ v: "light", l: "Sáng" }, { v: "dark", l: "Tối" }], S.theme)}</div>
      <div class="set-row"><div class="grow"><div class="rl">Cỡ chữ</div><div class="rd">Phóng to chữ cho dễ đọc</div></div>
        ${segPick("fontScale", [{ v: "sm", l: "Nhỏ" }, { v: "md", l: "Vừa" }, { v: "lg", l: "Lớn" }], S.fontScale)}</div>
      <div class="set-row"><div class="grow"><div class="rl">Tỷ lệ giao diện</div><div class="rd">Phóng to/thu nhỏ toàn bộ màn hình</div></div>
        ${segPick("uiScale", [{ v: "sm", l: "Gọn" }, { v: "md", l: "Chuẩn" }, { v: "lg", l: "Rộng" }], S.uiScale)}</div>
    </section>

    <section class="set-card">
      <h3>Trợ giúp &amp; phản hồi</h3>
      <button class="help-link" data-help="faq"><span class="grow">Câu hỏi thường gặp (FAQ)</span><span>›</span></button>
      <div class="help-body" id="help-faq" hidden>
        <p><b>Trợ lý AI gọi khi nào?</b> Theo giao thức của bệnh (ví dụ suy tim: ngày 1, 3, 7, 14, 30), trong khung giờ làm việc đã cấu hình.</p>
        <p><b>Khi nào ca được nâng cảnh báo?</b> Khi câu trả lời của bệnh nhân khớp quy tắc trong mục “Giao thức &amp; cảnh báo”.</p>
        <p><b>Gọi thất bại thì sao?</b> Hệ thống tự gọi lại theo số lần đã đặt; nếu vẫn không được sẽ báo điều dưỡng.</p>
      </div>
      <button class="help-link" data-help="guide"><span class="grow">Hướng dẫn sử dụng</span><span>›</span></button>
      <div class="help-body" id="help-guide" hidden>
        <p>Bắt đầu ở <b>Bảng điều phối</b> để xem việc cần làm hôm nay. Mở một ca để xem chi tiết và ra chỉ thị. Dùng <b>Quản lý gọi AI</b> để chỉnh lịch gọi, bộ câu hỏi và quy tắc cảnh báo.</p>
      </div>
      <button class="help-link" data-help="contact"><span class="grow">Liên hệ AfterCare</span><span>›</span></button>
      <div class="help-body" id="help-contact" hidden>
        <p>Hỗ trợ kỹ thuật: <b>1900 9999</b> · Email: <b>hotro@aftercare.vn</b> (8:00–20:00 hằng ngày).</p>
      </div>
      <button class="help-link" id="reportBtn"><span class="grow">Báo lỗi / Góp ý</span><span>›</span></button>
    </section>

    <section class="set-card">
      <h3>Hỗ trợ tiếp cận</h3>
      <div class="set-row"><div class="grow"><div class="rl">Tương phản cao</div><div class="rd">Tăng độ rõ của đường viền và chữ</div></div>
        <label class="toggle"><input type="checkbox" id="sContrast" ${S.highContrast ? "checked" : ""}><span class="track"></span></label></div>
      <div class="set-row"><div class="grow"><div class="rl">Giảm chuyển động</div><div class="rd">Tắt hiệu ứng động cho người nhạy cảm</div></div>
        <label class="toggle"><input type="checkbox" id="sMotion" ${S.reduceMotion ? "checked" : ""}><span class="track"></span></label></div>
    </section>`;

  renderLoginBanner();

  $("#sProfSave").addEventListener("click", () => {
    save({ name: $("#sName").value.trim() || "BS.", role: $("#sRole").value.trim(), dept: $("#sDept").value.trim() });
    render(); toast("Đã lưu hồ sơ bác sĩ.");
  });
  $all("[data-seg]").forEach(seg => seg.addEventListener("click", e => {
    const btn = e.target.closest("button"); if (!btn) return;
    const key = seg.dataset.seg;
    save({ [key]: btn.dataset.val });
    $all("button", seg).forEach(b => b.classList.toggle("active", b === btn));
  }));
  $("#sContrast").addEventListener("change", e => save({ highContrast: e.target.checked }));
  $("#sMotion").addEventListener("change", e => save({ reduceMotion: e.target.checked }));
  $all("[data-help]").forEach(b => b.addEventListener("click", () => {
    const body = $("#help-" + b.dataset.help); if (body) body.hidden = !body.hidden;
  }));
  $("#reportBtn").addEventListener("click", () => openReport());
}

function renderLoginBanner() {
  const logged = localStorage.getItem("aftercare_logged") === "1";
  const b = $("#loginBanner");
  if (logged) {
    b.innerHTML = `<span class="grow">Đang đăng nhập: <b>${esc(S.name)}</b></span>
      <button class="btn btn-sm" id="logoutBtn">Đăng xuất</button>`;
    $("#logoutBtn").addEventListener("click", () => { localStorage.removeItem("aftercare_logged"); renderLoginBanner(); toast("Đã đăng xuất (mô phỏng)."); });
  } else {
    b.innerHTML = `<span class="grow">Chưa đăng nhập (mô phỏng)</span>
      <button class="btn btn-sm btn-leaf" id="loginBtn">Đăng nhập</button>`;
    $("#loginBtn").addEventListener("click", () => {
      openDrawer("Đăng nhập (mô phỏng)", `
        ${fieldInput("Tên đăng nhập", "u", "text", "bs.coi")}
        ${fieldInput("Mật khẩu", "p", "password", "••••••")}
        <div class="drawer-actions"><button class="btn btn-leaf btn-block" id="doLogin">Đăng nhập</button></div>`,
        box => $("#doLogin", box).addEventListener("click", () => {
          localStorage.setItem("aftercare_logged", "1"); closeDrawer(); renderLoginBanner(); toast("Đăng nhập thành công (mô phỏng).");
        }));
    });
  }
}

function openReport() {
  openDrawer("Báo lỗi / Góp ý (mô phỏng)", `
    ${fieldSelect("Loại", "kind", ["Báo lỗi", "Góp ý cải thiện", "Câu hỏi"], "Báo lỗi")}
    <label class="f"><span>Nội dung</span><textarea class="input" name="msg" rows="5" placeholder="Mô tả vấn đề hoặc góp ý của bạn…"></textarea></label>
    <p class="muted-note">Bản demo: phản hồi chỉ được ghi nhận cục bộ, chưa gửi đi đâu.</p>
    <div class="drawer-actions"><button class="btn btn-leaf btn-block" id="sendReport">Gửi</button></div>`,
    box => $("#sendReport", box).addEventListener("click", () => {
      const msg = $('[name=msg]', box).value.trim();
      if (!msg) { toast("Nhập nội dung trước khi gửi."); return; }
      closeDrawer(); Metrics.track("report", "Gửi phản hồi"); toast("Đã ghi nhận phản hồi (mô phỏng).");
    }));
}

document.addEventListener("DOMContentLoaded", render);
