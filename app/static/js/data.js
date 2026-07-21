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

/* icon per nav "page" id — small stroke icons for the collapsed rail.
   Kept as plain SVG markup (currentColor) so it inherits nav-item color
   in both light/dark themes without extra assets. */
const NAV_ICONS = {
  dashboard: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect x="13.5" y="3" width="7" height="7.5" rx="1.6"/><rect x="3" y="13.5" width="7" height="7.5" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7.5" rx="1.6"/></svg>`,
  patients: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.2"/><path d="M2.8 20c.5-3.4 3.1-6 6.2-6s5.7 2.6 6.2 6"/><circle cx="17.5" cy="8.3" r="2.4"/><path d="M16 12.3c2.6.2 4.7 2.5 5.2 5.7"/></svg>`,
  appointments: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="15.5" rx="2"/><path d="M3 9.5h18"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M7 13.2h3M7 16.8h6"/></svg>`,
  manager: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 13.5v-1.7a7.5 7.5 0 0115 0v1.7"/><rect x="2.7" y="13.2" width="4" height="6" rx="1.6"/><rect x="17.3" y="13.2" width="4" height="6" rx="1.6"/><path d="M19.5 19.2c0 1.7-1.6 3-4 3h-1.8"/></svg>`,
  "call-demo": `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.7A8.7 8.7 0 1110.6 20L3 21.3l1.9-5.2a8.6 8.6 0 01-.4-2.6A8.7 8.7 0 0112.3 3a8.7 8.7 0 018.7 8.7z"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.1"/><path d="M19.4 15a1.7 1.7 0 00.34 1.9l.06.06a2.1 2.1 0 11-3 2.97l-.06-.06a1.7 1.7 0 00-1.9-.34 1.7 1.7 0 00-1 1.57V21.5a2.1 2.1 0 01-4.2 0v-.1a1.7 1.7 0 00-1.1-1.6 1.7 1.7 0 00-1.9.34l-.06.06a2.1 2.1 0 11-3-2.97l.06-.06a1.7 1.7 0 00.34-1.9 1.7 1.7 0 00-1.57-1H2.5a2.1 2.1 0 010-4.2h.1a1.7 1.7 0 001.6-1.1 1.7 1.7 0 00-.34-1.9l-.06-.06a2.1 2.1 0 113-2.97l.06.06a1.7 1.7 0 001.9.34H9a1.7 1.7 0 001-1.57V2.5a2.1 2.1 0 014.2 0v.1a1.7 1.7 0 001 1.57 1.7 1.7 0 001.9-.34l.06-.06a2.1 2.1 0 113 2.97l-.06.06a1.7 1.7 0 00-.34 1.9V9a1.7 1.7 0 001.57 1h.1a2.1 2.1 0 010 4.2h-.1a1.7 1.7 0 00-1.6 1z"/></svg>`,
};

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
