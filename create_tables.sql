-- Operational + AfterCare-side tables for the Mock HIS API.
-- Patient records already live in "Hồ sơ bệnh nhân" (the HIS export) — untouched here.
-- Run once against Supabase. Idempotent (IF NOT EXISTS); DROP to reverse.

CREATE TABLE IF NOT EXISTS question_sets (
    id          BIGSERIAL PRIMARY KEY,
    ma_ho_so    TEXT NOT NULL REFERENCES "Hồ sơ bệnh nhân"(ma_ho_so),
    status      TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','pending','approved')),
    created_at  TIMESTAMPTZ DEFAULT now(),
    approved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS questions (
    id              BIGSERIAL PRIMARY KEY,
    question_set_id BIGINT NOT NULL REFERENCES question_sets(id) ON DELETE CASCADE,
    text            TEXT NOT NULL,
    order_index     INTEGER NOT NULL,
    expected_var    TEXT,
    red_flag        BOOLEAN DEFAULT false,
    approved        BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS call_results (
    id                 BIGSERIAL PRIMARY KEY,
    ma_ho_so           TEXT NOT NULL REFERENCES "Hồ sơ bệnh nhân"(ma_ho_so),
    question_set_id    BIGINT REFERENCES question_sets(id),
    session_id         TEXT,
    started_at         TIMESTAMPTZ,
    ended_at           TIMESTAMPTZ,
    raw_answers        JSONB,
    extracted          JSONB,
    tier               TEXT,
    summary            TEXT,
    escalated          BOOLEAN DEFAULT false,
    escalation_channel TEXT
);

-- AfterCare-side monitoring, kept separate from the HIS export table.
CREATE TABLE IF NOT EXISTS monitoring (
    ma_ho_so          TEXT PRIMARY KEY REFERENCES "Hồ sơ bệnh nhân"(ma_ho_so),
    monitoring_status TEXT,
    next_call_at      TIMESTAMPTZ,
    resolved_at       TIMESTAMPTZ,   -- case closed: calls up to here stop counting toward current state
    updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_call_results_ma_ho_so   ON call_results(ma_ho_so);
CREATE INDEX IF NOT EXISTS ix_question_sets_ma_ho_so  ON question_sets(ma_ho_so);
CREATE INDEX IF NOT EXISTS ix_questions_set_id        ON questions(question_set_id);
