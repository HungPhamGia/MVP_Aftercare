/* =========================================================================
   AfterCare · data.js — UI CONFIG ONLY.
   All patient / clinical / operational data now comes from the API (see
   api.js). This file holds labels, navigation and user-preference config —
   no fabricated records. PATIENTS is filled from /his/patients at runtime.
   ========================================================================= */

const HOSPITAL = { name: "Bệnh viện X", updated: "01/07/2026" };
const CURRENT_USER = { name: "BS. Vũ Văn Côi", role: "Khoa Ngoại", initials: "VC" };

/* people the doctor can assign work to (org config) */
const STAFF = [
  "ĐD. Trần Thu Hà", "ĐD. Lê Minh Khoa", "ĐD. Phạm Bích Ngọc", "BS. Vũ Văn Côi",
];
const SPECIALTIES = ["Ngoại tổng quát", "Sản khoa", "Chấn thương chỉnh hình", "Tiêu hóa", "Nội tổng quát"];

/* grouped sidebar navigation */
const NAV_GROUPS = [
  {
    label: "Lâm sàng",
    items: [
      { page: "dashboard",    label: "Bảng điều phối", href: "index.html" },
      { page: "patients",     label: "Bệnh nhân",       href: "patients.html" },
      { page: "appointments", label: "Lịch hẹn",        href: "appointments.html" },
    ],
  },
  {
    label: "Trợ lý gọi tự động",
    items: [
      { page: "manager",   label: "Quản lý gọi AI",   href: "manager.html" },
      { page: "templates", label: "Bộ câu hỏi",       href: "templates.html" },
      { page: "call-demo", label: "Demo cuộc gọi AI", href: "chatbot.html" },
    ],
  },
  {
    label: "Hệ thống",
    items: [
      { page: "settings", label: "Cài đặt", href: "settings.html" },
    ],
  },
];

/* label maps shared everywhere */
const RISK = {
  red:     { label: "Nguy cơ cao", short: "Cao" },
  amber:   { label: "Cần theo dõi", short: "Theo dõi" },
  green:   { label: "Ổn định",      short: "Ổn định" },
  unknown: { label: "Chưa đánh giá", short: "Chưa gọi" },
};
/* next-call pill states — mapNextCall only ever produces these two */
const CALL_STATUS = {
  scheduled: { label: "Đã lên lịch", tone: "info" },
  none:      { label: "Chưa lên lịch", tone: "muted" },
};

/* Filled at runtime from /his/patients by api.js (single source of truth). */
let PATIENTS = [];
function getPatient(mrn) { return PATIENTS.find(p => p.mrn === mrn); }

/* default user-editable settings (stored locally, clinician preference) */
const DEFAULT_SETTINGS = {
  name: "BS. Vũ Văn Côi", role: "Bác sĩ điều trị", dept: "Khoa Ngoại",
  theme: "light", fontScale: "md", uiScale: "md", highContrast: false, reduceMotion: false,
};
