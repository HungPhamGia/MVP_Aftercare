"""Models align to the live Supabase tables — never create_all().

ponytail: scalar columns typed loosely (Text) where the live type is unknown;
tighten to JSONB/Date if a column turns out structured. JSONB used only where the
doc states it (call_results.raw_answers / extracted).
"""
from datetime import date, datetime

from sqlalchemy import (
    Boolean, Date, DateTime, ForeignKey, Integer, String, Text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class BenhAn(Base):
    # Live table is named in Vietnamese, with spaces — verified via reflection.
    __tablename__ = "Hồ sơ bệnh nhân"

    ma_ho_so: Mapped[str] = mapped_column(String, primary_key=True)
    ho_ten: Mapped[str | None] = mapped_column(String)
    gioi_tinh: Mapped[str | None] = mapped_column(String)
    ngay_sinh: Mapped[date | None] = mapped_column(Date)
    tuoi: Mapped[int | None] = mapped_column(Integer)
    so_the_bhyt: Mapped[str | None] = mapped_column(String)
    ngay_nhap_vien: Mapped[date | None] = mapped_column(Date)
    ngay_xuat_vien: Mapped[date | None] = mapped_column(Date)
    bac_si_phu_trach: Mapped[str | None] = mapped_column(String)
    ly_do_vao_vien: Mapped[str | None] = mapped_column(Text)
    chan_doan: Mapped[str | None] = mapped_column(Text)
    sinh_hieu: Mapped[str | None] = mapped_column(Text)
    phau_thuat: Mapped[str | None] = mapped_column(Text)
    thuoc_ke: Mapped[str | None] = mapped_column(Text)
    xet_nghiem: Mapped[str | None] = mapped_column(Text)
    ghi_chu_theo_doi: Mapped[str | None] = mapped_column(Text)
    lich_tai_kham: Mapped[date | None] = mapped_column(Date)
    sdt_benh_nhan: Mapped[str | None] = mapped_column(String)
    sdt_nguoi_nha: Mapped[str | None] = mapped_column(String)


class CallResult(Base):
    __tablename__ = "call_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ma_ho_so: Mapped[str] = mapped_column(ForeignKey("Hồ sơ bệnh nhân.ma_ho_so"))
    question_set_id: Mapped[int | None] = mapped_column(ForeignKey("question_sets.id"))
    session_id: Mapped[str | None] = mapped_column(String)
    started_at: Mapped[datetime | None] = mapped_column(DateTime)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime)
    raw_answers: Mapped[dict | None] = mapped_column(JSONB)
    extracted: Mapped[dict | None] = mapped_column(JSONB)
    transcript: Mapped[list | None] = mapped_column(JSONB)
    tier: Mapped[str | None] = mapped_column(String)
    summary: Mapped[str | None] = mapped_column(Text)
    escalated: Mapped[bool | None] = mapped_column(Boolean)
    escalation_channel: Mapped[str | None] = mapped_column(String)


class QuestionSet(Base):
    __tablename__ = "question_sets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ma_ho_so: Mapped[str] = mapped_column(ForeignKey("Hồ sơ bệnh nhân.ma_ho_so"))
    status: Mapped[str] = mapped_column(String, default="draft")  # draft|pending|approved
    created_at: Mapped[datetime | None] = mapped_column(DateTime)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime)

    questions: Mapped[list["Question"]] = relationship(
        back_populates="question_set", order_by="Question.order_index"
    )


class Question(Base):
    __tablename__ = "questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    question_set_id: Mapped[int] = mapped_column(ForeignKey("question_sets.id"))
    text: Mapped[str] = mapped_column(Text)
    order_index: Mapped[int] = mapped_column(Integer)
    expected_var: Mapped[str | None] = mapped_column(String)
    red_flag: Mapped[bool | None] = mapped_column(Boolean)
    approved: Mapped[bool | None] = mapped_column(Boolean)

    question_set: Mapped["QuestionSet"] = relationship(back_populates="questions")


class Monitoring(Base):
    """AfterCare-side monitoring, separate from the HIS export table."""
    __tablename__ = "monitoring"

    ma_ho_so: Mapped[str] = mapped_column(
        ForeignKey("Hồ sơ bệnh nhân.ma_ho_so"), primary_key=True
    )
    monitoring_status: Mapped[str | None] = mapped_column(String)
    next_call_at: Mapped[datetime | None] = mapped_column(DateTime)
    # set when a doctor closes the case: calls up to this moment stop counting
    # toward the patient's current risk/last-contact (case goes back to "chưa đánh giá").
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime)
