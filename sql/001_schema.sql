-- 한빛수학 수강·출결 관리 스키마
-- 모든 테이블은 hw2 스키마에 둔다 (1주차 과제 테이블과 섞이지 않게).
-- 배제 제약(EXCLUDE)에 쓰는 btree_gist 확장은 public에 둔다.

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA public;
CREATE SCHEMA IF NOT EXISTS hw2;
SET search_path TO hw2, public;

-- ───────────── 계정 ─────────────

CREATE TABLE IF NOT EXISTS families (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 학부모 (코어 웹 고객)
CREATE TABLE IF NOT EXISTS parents (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  family_id      bigint NOT NULL REFERENCES families(id),
  email          text NOT NULL,
  password_hash  text NOT NULL,
  name           text NOT NULL,
  phone          text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT parents_email_key UNIQUE (email),
  CONSTRAINT parents_email_lower CHECK (email = lower(email))
);

-- 직원 (어드민)
CREATE TABLE IF NOT EXISTS staff (
  id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email                 text NOT NULL,
  password_hash         text NOT NULL,
  name                  text NOT NULL,
  role                  text NOT NULL DEFAULT 'STAFF',
  is_active             boolean NOT NULL DEFAULT true,
  must_change_password  boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_email_key UNIQUE (email),
  CONSTRAINT staff_email_lower CHECK (email = lower(email)),
  CONSTRAINT staff_role_check CHECK (role IN ('ADMIN', 'STAFF'))
);

-- ───────────── 기본 정보 (A) ─────────────

CREATE TABLE IF NOT EXISTS students (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  family_id   bigint NOT NULL REFERENCES families(id),
  name        text NOT NULL,
  birth_date  date NOT NULL,
  grade       smallint NOT NULL,          -- 7~12 = 중1~고3
  school      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT students_grade_check CHECK (grade BETWEEN 7 AND 12)
);

CREATE TABLE IF NOT EXISTS guardian_contacts (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id  bigint NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  relation    text NOT NULL,              -- 엄마, 아빠, 할머니 ...
  phone       text NOT NULL
);

CREATE TABLE IF NOT EXISTS teachers (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id    bigint REFERENCES staff(id),   -- 어드민 로그인 계정 (없어도 됨)
  name        text NOT NULL,
  subject     text NOT NULL,
  CONSTRAINT teachers_staff_id_key UNIQUE (staff_id)
);

CREATE TABLE IF NOT EXISTS classes (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name          text NOT NULL,
  target_grade  smallint NOT NULL,
  teacher_id    bigint NOT NULL REFERENCES teachers(id),
  capacity      smallint NOT NULL DEFAULT 8,
  monthly_fee   integer NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT classes_grade_check CHECK (target_grade BETWEEN 7 AND 12),
  CONSTRAINT classes_capacity_check CHECK (capacity > 0),
  CONSTRAINT classes_fee_check CHECK (monthly_fee >= 0),
  CONSTRAINT classes_id_teacher_key UNIQUE (id, teacher_id)   -- 시간표의 복합 FK용
);

-- 반의 요일·시각 (반 하나가 주 2회 → 여러 줄)
-- teacher_id는 classes에서 복사해 두고 복합 FK로 묶는다.
-- 그래야 "같은 강사·같은 요일·겹치는 시각"을 이 테이블 안에서 DB가 막을 수 있다.
CREATE TABLE IF NOT EXISTS class_schedules (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  class_id     bigint NOT NULL,
  teacher_id   bigint NOT NULL,
  day_of_week  smallint NOT NULL,           -- 0=일 1=월 ... 6=토
  start_time   time NOT NULL,
  end_time     time NOT NULL,
  CONSTRAINT class_schedules_class_fk FOREIGN KEY (class_id, teacher_id)
    REFERENCES classes(id, teacher_id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT class_schedules_dow_check CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT class_schedules_time_check CHECK (end_time > start_time),
  CONSTRAINT class_schedules_teacher_no_overlap EXCLUDE USING gist (
    teacher_id WITH =,
    day_of_week WITH =,
    tsrange(DATE '2000-01-01' + start_time, DATE '2000-01-01' + end_time) WITH &&
  )
);

-- ───────────── 수강과 규칙 (B) ─────────────

-- end_date = 그만둔 날 (그날부터 안 다님). null이면 수강 중.
-- 행은 지우지 않는다 (환불 계산에 필요).
CREATE TABLE IF NOT EXISTS enrollments (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id  bigint NOT NULL REFERENCES students(id),
  class_id    bigint NOT NULL REFERENCES classes(id),
  start_date  date NOT NULL,
  end_date    date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT enrollments_date_check CHECK (end_date IS NULL OR end_date >= start_date),
  CONSTRAINT enrollments_no_overlap EXCLUDE USING gist (
    student_id WITH =,
    class_id WITH =,
    daterange(start_date, end_date, '[)') WITH &&
  )
);

CREATE TABLE IF NOT EXISTS attendances (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id  bigint NOT NULL REFERENCES students(id),
  class_id    bigint NOT NULL REFERENCES classes(id),
  class_date  date NOT NULL,
  status      text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendances_status_check CHECK (status IN ('PRESENT', 'LATE', 'ABSENT')),
  CONSTRAINT attendances_unique UNIQUE (student_id, class_id, class_date)
);

-- 결석 1건 → 다른 반 수업일 보강 1건
CREATE TABLE IF NOT EXISTS makeups (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  absence_id       bigint NOT NULL REFERENCES attendances(id),
  target_class_id  bigint NOT NULL REFERENCES classes(id),
  makeup_date      date NOT NULL,
  created_by       bigint REFERENCES staff(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT makeups_absence_id_key UNIQUE (absence_id)
);

-- 행이 있으면 납부, 없으면 미납
CREATE TABLE IF NOT EXISTS tuition_payments (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  student_id     bigint NOT NULL REFERENCES students(id),
  class_id       bigint NOT NULL REFERENCES classes(id),
  billing_month  date NOT NULL,              -- 그 달 1일
  paid_at        date NOT NULL,
  paid_amount    integer NOT NULL,
  created_by     bigint REFERENCES staff(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tuition_payments_month_check CHECK (extract(day FROM billing_month) = 1),
  CONSTRAINT tuition_payments_amount_check CHECK (paid_amount >= 0),
  CONSTRAINT tuition_payments_unique UNIQUE (student_id, class_id, billing_month)
);

CREATE INDEX IF NOT EXISTS idx_students_family ON students(family_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_class ON enrollments(class_id);
CREATE INDEX IF NOT EXISTS idx_attendances_date ON attendances(class_date);
CREATE INDEX IF NOT EXISTS idx_makeups_target ON makeups(target_class_id, makeup_date);
