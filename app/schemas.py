from datetime import date, datetime
from typing import Any

from pydantic import BaseModel


# --- Bot-facing: set_variables contract ---
class SetVariablesIn(BaseModel):
    # ponytail: shape per the doc. VERIFY against the real console request before
    # locking — log the incoming body in /his/patient/fetch first.
    set_variables: dict[str, Any]


class SetVariablesOut(BaseModel):
    status: str = "success"
    code: int = 200
    set_variables: dict[str, Any]


# --- Dashboard / write-back payloads ---
class GhiChuIn(BaseModel):
    ghi_chu_theo_doi: str


class ThuocIn(BaseModel):
    thuoc_ke: str


class MonitoringIn(BaseModel):
    monitoring_status: str | None = None
    next_call_at: datetime | None = None


class ReExamIn(BaseModel):
    lich_tai_kham: date | None = None  # null = clear the re-exam appointment


class QuestionIn(BaseModel):
    text: str
    order_index: int
    expected_var: str | None = None
    red_flag: bool | None = None


class QuestionSetIn(BaseModel):
    ma_ho_so: str
    questions: list[QuestionIn]


# --- Web demo: generate / edit / BFF ---
class GenerateIn(BaseModel):
    ma_ho_so: str


class QuestionEditIn(BaseModel):
    id: int | None = None  # present for existing questions, None for new ones
    text: str
    expected_var: str | None = None
    answer_type: str | None = None
    source: str | None = None  # "core" items cannot be deleted
    red_flag: bool | None = None


class QuestionsSaveIn(BaseModel):
    questions: list[QuestionEditIn]


class ConversationIn(BaseModel):
    text: str
    session_id: str
    ma_ho_so: str
    first_turn: bool = False


class TtsIn(BaseModel):
    text: str


class CallDemoIn(BaseModel):
    ma_ho_so: str
    transcript: list[dict[str, Any]] = []
    answers: list[dict[str, Any]] | None = None
    question_set_id: int | None = None


# --- Manual call (nurse/doctor dialed themselves, picked the outcome) ---
class ManualCallIn(BaseModel):
    ma_ho_so: str
    outcome: str  # green | amber | red | no_contact
    note: str = ""


# --- Escalation rules (Giao thức & cảnh báo) ---
class RuleIn(BaseModel):
    name: str
    active: bool = True
    when_text: str = ""
    risk: str = "amber"  # red | amber | green
    recipients: list[str] = []
    auto_appt: dict[str, Any] = {}
    approval: bool = False


# --- AI call settings (working hours / retry / blackout days) ---
class CallSettingsIn(BaseModel):
    working_hours: dict[str, Any] = {}
    retry: dict[str, Any] = {}
    blackout: list[str] = []


# --- Disease question templates (per-disease default set) ---
class TemplateIn(BaseModel):
    disease: str
    name: str
    active: bool = True
    assign: str | None = None
    # question dicts pass through as-is: {text, required, disabled?, branch?}
    questions: list[dict[str, Any]] = []


# --- Patient-specific (optional) questions saved from the case panel ---
class PatientQuestionIn(BaseModel):
    text: str
    expected_var: str | None = None


class PatientQuestionSetIn(BaseModel):
    questions: list[PatientQuestionIn] = []
