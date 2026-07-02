"""One-shot idempotent seed for the AfterCare demo DB.

- Adds contact-phone columns + a `transcript` column on call_results.
- Brings the roster to 10 post-op patients whose conditions are all suitable
  for at-home follow-up (elective / uncomplicated surgery). The 5 seeded
  patients carry full clinical fields (admission, reason, vitals, meds,
  follow-up notes — the notes drive question generation).
- Seeds monitoring (next call) + a real call history with transcripts; a few
  patients have several dated calls showing progression.
- Seeds two config tables (question templates + escalation rules).

Re-runnable: our 5 patients upsert (DO UPDATE), seeded calls keyed by
session_id 'seed-%' are replaced. Run:  python -m app.seed_demo
"""
import json
import re
from datetime import date, datetime

from sqlalchemy import text

from app.db import engine

P = '"Hồ sơ bệnh nhân"'

# Demo dates were authored around 01/07/2026. Slide the whole timeline onto
# "today" at seed time so the schedules never look stale — re-running the seed
# always re-anchors to the current date. Relative day-gaps are preserved.
SHIFT = date.today() - date(year=2026, month=7, day=1)
def D(y, m, d):                 # shifted date
    return date(y, m, d) + SHIFT
def DT(y, m, d, h=0, mi=0):     # shifted datetime
    return datetime(y, m, d, h, mi) + SHIFT
def vn(d):                      # DD/MM/YYYY for display copy
    return d.strftime("%d/%m/%Y")

# --- 5 seeded patients: light, home-followable post-op cases, full fields ---
NEW_PATIENTS = [
    dict(ma_ho_so="BA-2026-001085", ho_ten="Phạm Văn Cường", gioi_tinh="Nam", tuoi=62,
         ngay_nhap_vien=D(2026,6, 18), ngay_xuat_vien=D(2026,6, 21),
         bac_si_phu_trach="BS. Trần Quốc Việt",
         ly_do_vao_vien="Khối vùng cổ, nuốt vướng",
         chan_doan="Bướu giáp nhân lành tính (D34); hậu phẫu cắt thùy giáp",
         sinh_hieu="M:78 l/p; T:36.8°C; HA:130/82 mmHg; NT:18 l/p; CN:66kg; CC:168cm",
         phau_thuat="Cắt thùy giáp phải nội soi (18/06/2026)",
         thuoc_ke="Paracetamol 500mg khi đau; Levothyrox 50mcg/ngày (sáng, đói); Canxi + Vitamin D3 x2/ngày",
         ghi_chu_theo_doi="Theo dõi vết mổ vùng cổ, giọng nói (khàn tiếng), dấu hiệu tê tay chân hoặc co cứng (hạ canxi); uống Levothyrox buổi sáng lúc đói; gọi callbot ngày 1-3-7",
         lich_tai_kham=D(2026,6, 29)),
    dict(ma_ho_so="BA-2026-001092", ho_ten="Nguyễn Thị Bích", gioi_tinh="Nữ", tuoi=54,
         ngay_nhap_vien=D(2026,6, 20), ngay_xuat_vien=D(2026,6, 23),
         bac_si_phu_trach="BS. Nguyễn Thanh Hương",
         ly_do_vao_vien="Rong kinh kéo dài, thiếu máu",
         chan_doan="U xơ tử cung (D25.9); hậu phẫu cắt tử cung nội soi",
         sinh_hieu="M:84 l/p; T:37.0°C; HA:120/78 mmHg; NT:18 l/p; CN:58kg; CC:158cm",
         phau_thuat="Cắt tử cung toàn phần nội soi (20/06/2026)",
         thuoc_ke="Cefuroxim 500mg x2/ngày x5 ngày; Paracetamol 500mg khi đau; Sắt (II) sulfat 1 viên/ngày",
         ghi_chu_theo_doi="Theo dõi ra huyết âm đạo bất thường, đau bụng, sốt; kiêng vận động mạnh và quan hệ 6 tuần; ăn uống đủ chất, bổ sung sắt; gọi callbot ngày 1-3-7",
         lich_tai_kham=D(2026,7, 6)),
    dict(ma_ho_so="BA-2026-001104", ho_ten="Đặng Quốc Bảo", gioi_tinh="Nam", tuoi=41,
         ngay_nhap_vien=D(2026,6, 19), ngay_xuat_vien=D(2026,6, 22),
         bac_si_phu_trach="BS. Phạm Minh Hải",
         ly_do_vao_vien="Đau bụng quanh rốn lan xuống hố chậu phải",
         chan_doan="Viêm ruột thừa cấp (K35.8); hậu phẫu cắt ruột thừa nội soi",
         sinh_hieu="M:88 l/p; T:37.8°C; HA:126/80 mmHg; NT:20 l/p; CN:70kg; CC:172cm",
         phau_thuat="Cắt ruột thừa nội soi (19/06/2026)",
         thuoc_ke="Cefuroxim 500mg x2/ngày x5 ngày; Metronidazol 500mg x2/ngày x5 ngày; Paracetamol 500mg khi đau",
         ghi_chu_theo_doi="Theo dõi vết mổ (sưng đỏ, chảy dịch), sốt, đau tăng; nhắc uống đủ kháng sinh đúng giờ; ăn nhẹ dễ tiêu; gọi callbot ngày 1-3-5",
         lich_tai_kham=D(2026,6, 30)),
    dict(ma_ho_so="BA-2026-001110", ho_ten="Bùi Thị Hạnh", gioi_tinh="Nữ", tuoi=72,
         ngay_nhap_vien=D(2026,6, 17), ngay_xuat_vien=D(2026,6, 20),
         bac_si_phu_trach="BS. Lý Hoàng Nam",
         ly_do_vao_vien="Ngã, đau và sưng cổ chân trái",
         chan_doan="Gãy kín mắt cá ngoài chân trái (S82.6); hậu phẫu kết hợp xương nẹp vít",
         sinh_hieu="M:80 l/p; T:36.9°C; HA:138/84 mmHg; NT:18 l/p; CN:56kg; CC:154cm",
         phau_thuat="Kết hợp xương nẹp vít mắt cá ngoài (16/06/2026)",
         thuoc_ke="Paracetamol 500mg khi đau; Meloxicam 7.5mg/ngày; Canxi + Vitamin D3 x1/ngày; Aspirin 81mg/ngày",
         ghi_chu_theo_doi="Theo dõi sưng nề, tê bì hoặc tím đầu ngón chân (dấu hiệu chèn ép), vết mổ; kê cao chân khi nghỉ; cảnh giác dấu hiệu huyết khối (đau bắp chân, sưng nóng một bên); tập vận động theo hướng dẫn; gọi callbot ngày 1-3-7",
         lich_tai_kham=D(2026,7, 1)),
    dict(ma_ho_so="BA-2026-001126", ho_ten="Vũ Minh Tân", gioi_tinh="Nam", tuoi=38,
         ngay_nhap_vien=D(2026,6, 23), ngay_xuat_vien=D(2026,6, 24),
         bac_si_phu_trach="BS. Vũ Đình Khoa",
         ly_do_vao_vien="Búi trĩ sa, chảy máu khi đại tiện",
         chan_doan="Trĩ nội độ III (K64.2); hậu phẫu cắt trĩ",
         sinh_hieu="M:76 l/p; T:36.7°C; HA:122/78 mmHg; NT:16 l/p; CN:72kg; CC:174cm",
         phau_thuat="Cắt trĩ Longo (22/06/2026)",
         thuoc_ke="Paracetamol 500mg khi đau; Daflon 500mg x2/ngày; Thuốc mỡ bôi hậu môn; Lactulose (nhuận tràng)",
         ghi_chu_theo_doi="Theo dõi chảy máu hậu môn, đau khi đại tiện, bí tiểu; ăn nhiều chất xơ, uống đủ nước; ngâm hậu môn nước ấm 2-3 lần/ngày; gọi callbot ngày 1-3-7",
         lich_tai_kham=D(2026,7, 7)),
]

PHONES = {
    "BA-2026-001027": ("0912 345 678", "0987 111 222 (con: Minh)"),
    "BA-2026-001041": ("0934 567 890", "0901 222 333 (vợ: Hoa)"),
    "BA-2026-001058": ("0976 543 210", "0933 444 555 (chồng: Nam)"),
    "BA-2026-001063": ("0908 121 314", "0967 888 999 (con: Bình)"),
    "BA-2026-001079": ("0945 678 123", "0922 333 111 (con gái: Tú)"),
    "BA-2026-001085": ("0913 222 444", "0977 555 888 (con: Dũng)"),
    "BA-2026-001092": ("0938 777 121", "0902 646 313 (chồng: Sơn)"),
    "BA-2026-001104": ("0967 010 233", "0919 404 505 (anh: Bình)"),
    "BA-2026-001110": ("0978 000 111", "0966 555 777 (con: Đạt)"),
    "BA-2026-001126": ("0902 333 666", "0911 777 888 (em: Hà)"),
}

MONITORING = {
    "BA-2026-001027": DT(2026,7, 2, 9, 0),
    "BA-2026-001041": DT(2026,6, 30, 9, 30),   # overdue
    "BA-2026-001058": DT(2026,7, 3, 10, 0),
    "BA-2026-001063": DT(2026,6, 29, 8, 30),   # overdue
    "BA-2026-001079": DT(2026,7, 2, 14, 0),
    "BA-2026-001085": DT(2026,7, 2, 9, 0),
    "BA-2026-001092": DT(2026,7, 4, 10, 15),
    "BA-2026-001104": DT(2026,6, 29, 11, 0),   # overdue (red)
    "BA-2026-001110": DT(2026,6, 30, 9, 0),    # overdue (red)
    "BA-2026-001126": DT(2026,7, 5, 15, 0),
}


def turn(who, txt):
    return {"who": who, "text": txt}


# Full call history. Each entry: one call with a transcript + summary + tier.
# A few patients have several dated calls (progression).
CALLS = [
    # 001027 — recovering well, 2 calls
    dict(mrn="BA-2026-001027", when=DT(2026,6, 24, 9, 10), tier="green", esc=False,
         summary="Ngày 1 sau xuất viện: vết mổ khô, đau nhẹ, không sốt, uống thuốc đủ. Ổn định.",
         answers={"Sốt": "Không", "Vết mổ": "Khô, không chảy dịch", "Đau": "Nhẹ, chịu được", "Uống thuốc": "Đủ"},
         transcript=[
             turn("Trợ lý", "Dạ em chào chị Hồng, em gọi từ Bệnh viện X hỏi thăm sau mổ ruột thừa ạ. Hôm nay chị thấy trong người thế nào?"),
             turn("Chị Hồng", "Chào cháu, cô thấy đỡ nhiều rồi, chỉ hơi đau chỗ vết mổ thôi."),
             turn("Trợ lý", "Dạ chị có bị sốt hay ớn lạnh không ạ?"),
             turn("Chị Hồng", "Không, cô đo nhiệt độ bình thường."),
             turn("Trợ lý", "Vết mổ có sưng đỏ hay chảy dịch gì không ạ?"),
             turn("Chị Hồng", "Khô ráo, không chảy gì cả."),
             turn("Trợ lý", "Dạ tốt quá. Chị nhớ uống đủ kháng sinh và tránh vận động mạnh nhé. Em sẽ gọi lại vào ngày kia ạ."),
         ]),
    dict(mrn="BA-2026-001027", when=DT(2026,6, 26, 9, 5), tier="green", esc=False,
         summary="Ngày 3: hết đau nhiều, ăn uống tốt, vết mổ liền tốt. Tiếp tục theo dõi.",
         answers={"Sốt": "Không", "Vết mổ": "Liền tốt", "Đau": "Gần như hết", "Ăn uống": "Bình thường"},
         transcript=[
             turn("Trợ lý", "Dạ em chào chị Hồng, em gọi lại xem chị hồi phục thế nào ạ."),
             turn("Chị Hồng", "Cô khỏe hơn nhiều rồi, ăn uống được, đi lại nhẹ nhàng bình thường."),
             turn("Trợ lý", "Vết mổ và cơn đau thì sao ạ?"),
             turn("Chị Hồng", "Vết mổ khô, gần như không đau nữa."),
             turn("Trợ lý", "Dạ chị hồi phục rất tốt. Chị nhớ lịch tái khám ngày 30/06 nhé ạ."),
         ]),
    # 001041 — amber, 1 call
    dict(mrn="BA-2026-001041", when=DT(2026,6, 25, 10, 0), tier="amber", esc=False,
         summary="Đau hạ sườn phải tăng nhẹ khi vận động, chưa sốt, vết mổ hơi đỏ. Cần theo dõi thêm 2 ngày.",
         answers={"Sốt": "Không", "Vết mổ": "Hơi đỏ nhẹ", "Đau": "Tăng khi cử động", "Uống thuốc": "Đủ"},
         transcript=[
             turn("Trợ lý", "Dạ em chào anh Tuấn, em hỏi thăm sau mổ túi mật ạ. Anh thấy sao rồi?"),
             turn("Anh Tuấn", "Cũng ổn, nhưng chỗ vết mổ hơi đau khi cử động mạnh."),
             turn("Trợ lý", "Anh có sốt không, vết mổ có chảy dịch không ạ?"),
             turn("Anh Tuấn", "Không sốt, nhưng nhìn hơi đỏ đỏ một chút."),
             turn("Trợ lý", "Dạ em ghi nhận. Anh theo dõi thêm, nếu đỏ lan rộng, chảy dịch hay sốt thì báo ngay nhé. Em sẽ báo điều dưỡng theo dõi anh sát hơn ạ."),
         ]),
    # 001058 — green
    dict(mrn="BA-2026-001058", when=DT(2026,6, 26, 10, 20), tier="green", esc=False,
         summary="Sản phụ ổn, sản dịch bình thường, cho con bú tốt, vết mổ khô. Ổn định.",
         answers={"Sốt": "Không", "Vết mổ": "Khô", "Sản dịch": "Bình thường", "Đau": "Nhẹ"},
         transcript=[
             turn("Trợ lý", "Dạ em chào chị Mai Anh, em hỏi thăm sau sinh mổ ạ. Sức khỏe hai mẹ con thế nào?"),
             turn("Chị Mai Anh", "Cảm ơn cháu, mẹ con mình đều ổn, bé bú tốt."),
             turn("Trợ lý", "Chị có bị sốt hay sản dịch ra nhiều bất thường không ạ?"),
             turn("Chị Mai Anh", "Không, sản dịch bình thường, vết mổ cũng khô."),
             turn("Trợ lý", "Dạ tốt quá ạ. Chị nhớ nghỉ ngơi và kiêng vận động mạnh nhé."),
         ]),
    # 001063 — green
    dict(mrn="BA-2026-001063", when=DT(2026,6, 24, 8, 40), tier="green", esc=False,
         summary="Vết mổ thoát vị ổn, không sưng đau bất thường, đi lại nhẹ nhàng. Ổn định.",
         answers={"Sốt": "Không", "Vết mổ": "Khô", "Đau": "Ít", "Đi lại": "Nhẹ nhàng được"},
         transcript=[
             turn("Trợ lý", "Dạ em chào anh Long, em hỏi thăm sau mổ thoát vị bẹn ạ."),
             turn("Anh Long", "Ừ, anh thấy ổn, đi lại nhẹ nhàng được rồi."),
             turn("Trợ lý", "Vùng bẹn có sưng, đau nhiều hay tức không ạ?"),
             turn("Anh Long", "Không, chỉ hơi tức nhẹ thôi, không sao."),
             turn("Trợ lý", "Dạ anh nhớ tránh mang vác nặng trong vài tuần nhé ạ."),
         ]),
    # 001079 — amber (elderly, wrist)
    dict(mrn="BA-2026-001079", when=DT(2026,6, 27, 14, 10), tier="amber", esc=False,
         summary="Bệnh nhân lớn tuổi, đau vùng cổ tay nhiều về đêm, tê nhẹ ngón tay. Cần rà soát nẹp và thuốc giảm đau.",
         answers={"Sốt": "Không", "Vết mổ": "Khô", "Đau": "Nhiều về đêm", "Tê tay": "Có tê nhẹ"},
         transcript=[
             turn("Trợ lý", "Dạ em chào bà Lan, em hỏi thăm sau mổ kết hợp xương cổ tay ạ."),
             turn("Bà Lan", "Ừ cháu, tay bà đỡ hơn nhưng đêm ngủ vẫn đau, mấy ngón hơi tê."),
             turn("Trợ lý", "Dạ bà có thấy đầu ngón tay tím hay lạnh không ạ?"),
             turn("Bà Lan", "Không tím, chỉ tê tê thôi."),
             turn("Trợ lý", "Dạ em ghi nhận. Bà kê cao tay khi nghỉ, em sẽ báo bác sĩ xem lại nẹp và thuốc giảm đau cho bà ạ."),
         ]),
    # 001085 — amber (thyroid: mild hoarseness + tingling)
    dict(mrn="BA-2026-001085", when=DT(2026,6, 24, 9, 0), tier="amber", esc=False,
         summary="Sau cắt thùy giáp: khàn tiếng nhẹ, thỉnh thoảng tê quanh miệng và đầu ngón tay (nghi hạ canxi nhẹ). Cần nhắc bổ sung canxi, theo dõi.",
         answers={"Sốt": "Không", "Vết mổ": "Khô", "Giọng nói": "Hơi khàn", "Tê tay/quanh miệng": "Thỉnh thoảng"},
         transcript=[
             turn("Trợ lý", "Dạ em chào chú Cường, em hỏi thăm sau mổ tuyến giáp ạ."),
             turn("Chú Cường", "Ừ, chú thấy ổn nhưng giọng hơi khàn, thỉnh thoảng tê tê quanh miệng."),
             turn("Trợ lý", "Dạ chú có bị co cứng cơ tay chân hay chuột rút không ạ?"),
             turn("Chú Cường", "Không đến mức đó, chỉ tê nhẹ thôi."),
             turn("Trợ lý", "Dạ đó có thể là thiếu canxi nhẹ. Chú nhớ uống canxi theo đơn nhé, nếu tê tăng hay co cứng cơ thì báo ngay. Em sẽ theo dõi thêm ạ."),
         ]),
    # 001092 — green (hysterectomy)
    dict(mrn="BA-2026-001092", when=DT(2026,6, 26, 10, 30), tier="green", esc=False,
         summary="Sau cắt tử cung: ra ít dịch hồng, không sốt, đau nhẹ. Ổn định, nhắc bổ sung sắt.",
         answers={"Sốt": "Không", "Ra huyết": "Ít, màu hồng nhạt", "Đau": "Nhẹ", "Uống thuốc": "Đủ"},
         transcript=[
             turn("Trợ lý", "Dạ em chào cô Bích, em hỏi thăm sau mổ cắt tử cung ạ."),
             turn("Cô Bích", "Cảm ơn cháu, cô đỡ nhiều, chỉ ra ít dịch hồng nhạt thôi."),
             turn("Trợ lý", "Cô có sốt, đau bụng nhiều hay ra huyết đỏ tươi không ạ?"),
             turn("Cô Bích", "Không, chỉ hơi đau nhẹ bụng dưới."),
             turn("Trợ lý", "Dạ vậy là bình thường ạ. Cô nhớ uống sắt, nghỉ ngơi, kiêng vận động mạnh nhé."),
         ]),
    # 001104 — appendectomy, progression amber -> RED (wound infection)
    dict(mrn="BA-2026-001104", when=DT(2026,6, 23, 11, 0), tier="amber", esc=False,
         summary="Ngày 1: đau vết mổ tăng nhẹ, chưa sốt, vết mổ hơi đỏ. Dặn theo dõi sát dấu hiệu nhiễm trùng.",
         answers={"Sốt": "Không", "Vết mổ": "Hơi đỏ", "Đau": "Tăng nhẹ", "Uống thuốc": "Đủ"},
         transcript=[
             turn("Trợ lý", "Dạ em chào anh Bảo, em hỏi thăm sau mổ ruột thừa ạ. Anh thấy sao rồi?"),
             turn("Anh Bảo", "Đau chỗ mổ hơi tăng, nhìn hơi đỏ nhưng chưa sốt."),
             turn("Trợ lý", "Dạ anh theo dõi kỹ nhé, nếu vết mổ đỏ nhiều, chảy dịch hoặc sốt thì báo ngay ạ."),
             turn("Anh Bảo", "Ừ, anh để ý."),
         ]),
    dict(mrn="BA-2026-001104", when=DT(2026,6, 26, 11, 15), tier="red", esc=True,
         summary="Ngày 4: sốt 38.7°C, vết mổ sưng đỏ chảy dịch đục, đau tăng. Nghi nhiễm trùng vết mổ — đã nâng cảnh báo và báo bác sĩ phụ trách.",
         answers={"Sốt": "Có, 38.7°C", "Vết mổ": "Sưng đỏ, chảy dịch đục", "Đau": "Tăng nhiều", "Chảy máu": "Không"},
         transcript=[
             turn("Trợ lý", "Dạ em chào anh Bảo, em gọi lại theo dõi vết mổ ạ. Hôm nay anh thế nào?"),
             turn("Anh Bảo", "Không ổn cháu ơi, anh sốt, chỗ mổ sưng đỏ và chảy nước đục."),
             turn("Trợ lý", "Dạ anh đo nhiệt độ bao nhiêu ạ?"),
             turn("Anh Bảo", "38.7 độ, đau hơn hôm trước nhiều."),
             turn("Trợ lý", "Dạ đây là dấu hiệu nhiễm trùng vết mổ. Em xin phép nâng mức ưu tiên và báo bác sĩ phụ trách liên hệ với anh ngay ạ. Anh giữ máy giúp em nhé."),
         ]),
    # 001110 — ankle ORIF, progression amber -> RED (suspected DVT)
    dict(mrn="BA-2026-001110", when=DT(2026,6, 22, 9, 0), tier="amber", esc=False,
         summary="Ngày 2: sưng nề cổ chân, đau khi vận động, tê nhẹ. Dặn kê cao chân, theo dõi dấu hiệu chèn ép/huyết khối.",
         answers={"Sốt": "Không", "Vết mổ": "Khô", "Sưng nề": "Có", "Tê chân": "Nhẹ"},
         transcript=[
             turn("Trợ lý", "Dạ em chào bà Hạnh, em hỏi thăm sau mổ cổ chân ạ."),
             turn("Bà Hạnh", "Ừ, chân bà còn sưng, đi lại đau, hơi tê."),
             turn("Trợ lý", "Dạ bà nhớ kê cao chân khi nằm nhé. Nếu tê tăng, đầu ngón chân tím hoặc đau bắp chân thì báo ngay ạ."),
             turn("Bà Hạnh", "Ừ bà nhớ rồi."),
         ]),
    dict(mrn="BA-2026-001110", when=DT(2026,6, 25, 9, 20), tier="red", esc=True,
         summary="Ngày 5: đau bắp chân trái tăng, sưng nóng một bên, khó gấp bàn chân. Nghi huyết khối tĩnh mạch sâu — đã nâng cảnh báo, báo bác sĩ.",
         answers={"Sốt": "Nhẹ", "Bắp chân": "Đau, sưng nóng một bên", "Khó thở": "Không", "Đi lại": "Rất đau"},
         transcript=[
             turn("Trợ lý", "Dạ em chào bà Hạnh, em gọi lại theo dõi ạ. Chân bà hôm nay sao rồi?"),
             turn("Bà Hạnh", "Bắp chân bà đau nhiều hơn, sờ vào thấy nóng và sưng hơn bên kia."),
             turn("Trợ lý", "Dạ bà có thấy khó thở hay đau ngực không ạ?"),
             turn("Bà Hạnh", "Không, chỉ đau chân thôi nhưng khó chịu lắm."),
             turn("Trợ lý", "Dạ đây có thể là dấu hiệu huyết khối tĩnh mạch, cần được khám sớm. Em nâng mức ưu tiên và báo bác sĩ liên hệ với gia đình ngay ạ."),
         ]),
    # 001126 (Vũ Minh Tân) — no call yet → "chưa đánh giá"
]

# --- config tables (unchanged shape) ---
TEMPLATES = [
    dict(disease="Hậu phẫu", name="Theo dõi hậu phẫu chung", version="v2", active=True,
         assign="Tự động theo chẩn đoán: Hậu phẫu",
         questions=[
             {"text": "Anh/chị có bị sốt trên 38.5°C không?", "required": True},
             {"text": "Vết mổ có sưng đỏ, chảy dịch hay có mủ không?", "required": True},
             {"text": "Cơn đau có tăng và không giảm khi dùng thuốc không?", "required": True},
             {"text": "Anh/chị có uống thuốc đủ theo đơn không?", "required": False},
         ],
         history=[{"v": "v2", "when": "18/06/2026", "by": "BS. Trần Quốc Việt", "note": "Thêm câu hỏi vết mổ"},
                  {"v": "v1", "when": "02/05/2026", "by": "Hệ thống", "note": "Bản khởi tạo"}]),
    dict(disease="Sản khoa", name="Theo dõi hậu sản (mổ lấy thai)", version="v1", active=True,
         assign="Tự động theo chẩn đoán: Mổ lấy thai",
         questions=[
             {"text": "Sản dịch có ra nhiều bất thường hoặc mùi hôi không?", "required": True},
             {"text": "Vết mổ có đau tăng, chảy dịch không?", "required": True},
             {"text": "Anh/chị có sốt hoặc đau bụng dưới nhiều không?", "required": True},
         ],
         history=[{"v": "v1", "when": "20/05/2026", "by": "BS. Nguyễn Thanh Hương", "note": "Bản khởi tạo"}]),
    dict(disease="Chấn thương chỉnh hình", name="Theo dõi sau kết hợp xương", version="v1", active=False,
         assign="Gán thủ công",
         questions=[
             {"text": "Vùng mổ có sưng nề, tê bì hay tím tái không?", "required": True},
             {"text": "Anh/chị có đau bắp chân hoặc sưng nóng một bên không?", "required": True},
             {"text": "Anh/chị có tập vận động theo hướng dẫn không?", "required": False},
         ],
         history=[{"v": "v1", "when": "05/05/2026", "by": "Hệ thống", "note": "Bản khởi tạo"}]),
]

RULES = [
    dict(name="Nhiễm trùng vết mổ", active=True,
         when_text="Sốt > 38.5°C  VÀ  vết mổ chảy dịch/mủ", risk="red",
         recipients=["Bác sĩ phụ trách", "Điều dưỡng trực"],
         auto_appt={"on": True, "specialty": "Ngoại tổng quát", "within": "24 giờ"}, approval=False),
    dict(name="Nghi huyết khối tĩnh mạch sâu", active=True,
         when_text="Đau bắp chân  VÀ  sưng nóng một bên chân", risk="red",
         recipients=["Bác sĩ phụ trách"],
         auto_appt={"on": True, "specialty": "Chấn thương chỉnh hình", "within": "24 giờ"}, approval=False),
    dict(name="Đau tăng không kiểm soát", active=True,
         when_text="Đau tăng nhiều  VÀ  không giảm khi dùng thuốc", risk="amber",
         recipients=["Điều dưỡng phụ trách"],
         auto_appt={"on": False, "specialty": "", "within": ""}, approval=True),
    dict(name="Không liên lạc được", active=True,
         when_text="Gọi thất bại ≥ 3 lần", risk="amber",
         recipients=["Điều dưỡng phụ trách"],
         auto_appt={"on": False, "specialty": "", "within": ""}, approval=False),
]

PATIENT_COLS = ["ho_ten", "gioi_tinh", "tuoi", "ngay_nhap_vien", "ngay_xuat_vien",
                "bac_si_phu_trach", "ly_do_vao_vien", "chan_doan", "sinh_hieu",
                "phau_thuat", "thuoc_ke", "ghi_chu_theo_doi", "lich_tai_kham"]


def main():
    with engine.begin() as c:
        # 0) schema
        c.execute(text(f'ALTER TABLE {P} ADD COLUMN IF NOT EXISTS sdt_benh_nhan TEXT'))
        c.execute(text(f'ALTER TABLE {P} ADD COLUMN IF NOT EXISTS sdt_nguoi_nha TEXT'))
        c.execute(text('ALTER TABLE call_results ADD COLUMN IF NOT EXISTS transcript JSONB'))
        c.execute(text('ALTER TABLE monitoring ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ'))
        c.execute(text("""
            CREATE TABLE IF NOT EXISTS question_templates (
                id SERIAL PRIMARY KEY, disease TEXT, name TEXT, version TEXT,
                active BOOLEAN, assign TEXT, questions JSONB, history JSONB)"""))
        c.execute(text("""
            CREATE TABLE IF NOT EXISTS escalation_rules (
                id SERIAL PRIMARY KEY, name TEXT, active BOOLEAN, when_text TEXT,
                risk TEXT, recipients JSONB, auto_appt JSONB, approval BOOLEAN,
                order_index INTEGER)"""))

        # 1) config tables
        c.execute(text("DELETE FROM question_templates"))
        for t in TEMPLATES:
            c.execute(text("""INSERT INTO question_templates (disease, name, version, active, assign, questions, history)
                VALUES (:disease,:name,:version,:active,:assign,CAST(:q AS JSONB),CAST(:h AS JSONB))"""),
                dict(disease=t["disease"], name=t["name"], version=t["version"], active=t["active"],
                     assign=t["assign"], q=json.dumps(t["questions"], ensure_ascii=False),
                     h=json.dumps(t["history"], ensure_ascii=False)))
        c.execute(text("DELETE FROM escalation_rules"))
        for i, r in enumerate(RULES):
            c.execute(text("""INSERT INTO escalation_rules (name, active, when_text, risk, recipients, auto_appt, approval, order_index)
                VALUES (:name,:active,:when_text,:risk,CAST(:rec AS JSONB),CAST(:aa AS JSONB),:approval,:oi)"""),
                dict(name=r["name"], active=r["active"], when_text=r["when_text"], risk=r["risk"],
                     rec=json.dumps(r["recipients"], ensure_ascii=False),
                     aa=json.dumps(r["auto_appt"], ensure_ascii=False), approval=r["approval"], oi=i))

        # 2) our 5 patients (upsert full clinical fields; existing 5 untouched)
        set_clause = ", ".join(f"{col}=EXCLUDED.{col}" for col in PATIENT_COLS)
        cols = ", ".join(["ma_ho_so"] + PATIENT_COLS)
        binds = ", ".join([":ma_ho_so"] + [f":{col}" for col in PATIENT_COLS])
        for p in NEW_PATIENTS:
            # keep the surgery date inside the description in step with the shifted admit date
            p["phau_thuat"] = re.sub(r"\(\d{2}/\d{2}/\d{4}\)",
                                     f"({vn(p['ngay_nhap_vien'])})", p["phau_thuat"])
            c.execute(text(f"INSERT INTO {P} ({cols}) VALUES ({binds}) "
                           f"ON CONFLICT (ma_ho_so) DO UPDATE SET {set_clause}"), p)

        # 3) phones
        for mrn, (bn, nn) in PHONES.items():
            c.execute(text(f'UPDATE {P} SET sdt_benh_nhan=:bn, sdt_nguoi_nha=:nn WHERE ma_ho_so=:mrn'),
                      dict(bn=bn, nn=nn, mrn=mrn))

        # 4) monitoring
        for mrn, when in MONITORING.items():
            c.execute(text("""INSERT INTO monitoring (ma_ho_so, monitoring_status, next_call_at, updated_at, resolved_at)
                VALUES (:mrn,'active',:when,:now, NULL)
                ON CONFLICT (ma_ho_so) DO UPDATE
                  SET monitoring_status='active', next_call_at=EXCLUDED.next_call_at,
                      updated_at=EXCLUDED.updated_at, resolved_at=NULL"""),
                dict(mrn=mrn, when=when, now=datetime.now()))

        # 5) call history with transcripts (idempotent by session_id 'seed-%')
        c.execute(text("DELETE FROM call_results WHERE session_id LIKE 'seed-%'"))
        seq = {}
        for cr in CALLS:
            seq[cr["mrn"]] = seq.get(cr["mrn"], 0) + 1
            c.execute(text("""INSERT INTO call_results (ma_ho_so, session_id, started_at, ended_at,
                    raw_answers, extracted, transcript, tier, summary, escalated, escalation_channel)
                VALUES (:mrn,:sid,:started,:ended,CAST(:raw AS JSONB),CAST(:ext AS JSONB),
                    CAST(:tr AS JSONB),:tier,:summary,:esc,:chan)"""),
                dict(mrn=cr["mrn"], sid=f"seed-{cr['mrn']}-{seq[cr['mrn']]}",
                     started=cr["when"], ended=cr["when"],
                     raw=json.dumps(cr["answers"], ensure_ascii=False),
                     ext=json.dumps(cr["answers"], ensure_ascii=False),
                     tr=json.dumps(cr["transcript"], ensure_ascii=False),
                     tier=cr["tier"], summary=cr["summary"], esc=cr["esc"],
                     chan="Bác sĩ phụ trách" if cr["esc"] else None))

    print("seed done")


if __name__ == "__main__":
    main()
