import { Injectable } from '@nestjs/common';
import { datesInMonth, dayOfWeek, monthRange } from '../common/dates';
import { DbService } from '../db/db.service';

/**
 * 현황과 계산 (C1~C3, D4, D5).
 * 여기 나오는 값은 하나도 저장하지 않는다. 출결·수강·납부 같은 "사실"에서 그때그때 계산한다.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly db: DbService) {}

  /** C1 학생별 이번 달 출석률. 지각 3번 = 결석 1번 */
  async attendance(month?: string, familyId?: number) {
    const { start, end } = monthRange(month);
    const rows = await this.db.query(
      `SELECT s.id AS "studentId", s.name, s.grade,
              count(*)::int AS total,
              count(*) FILTER (WHERE a.status = 'PRESENT')::int AS present,
              count(*) FILTER (WHERE a.status = 'LATE')::int AS late,
              count(*) FILTER (WHERE a.status = 'ABSENT')::int AS absent
         FROM attendances a JOIN students s ON s.id = a.student_id
        WHERE a.class_date >= $1 AND a.class_date < $2
          AND ($3::bigint IS NULL OR s.family_id = $3)
        GROUP BY s.id ORDER BY s.grade, s.name`,
      [start, end, familyId ?? null],
    );
    return rows.map((r) => {
      const convertedAbsent = r.absent + Math.floor(r.late / 3);
      const rate = r.total ? Math.round(((r.total - convertedAbsent) / r.total) * 1000) / 10 : null;
      return { ...r, convertedAbsent, rate };
    });
  }

  /** C2 이번 달 결석 2회 이상인데 보강이 하나도 잡히지 않은 학생 */
  makeupNeeded(month?: string) {
    const { start, end } = monthRange(month);
    return this.db.query(
      `SELECT s.id AS "studentId", s.name, s.grade, count(*)::int AS "absentCount",
              json_agg(json_build_object('absenceId', a.id, 'date', a.class_date, 'className', c.name)
                       ORDER BY a.class_date) AS absences
         FROM attendances a
         JOIN students s ON s.id = a.student_id
         JOIN classes c ON c.id = a.class_id
        WHERE a.status = 'ABSENT' AND a.class_date >= $1 AND a.class_date < $2
        GROUP BY s.id
       HAVING count(*) >= 2
          AND NOT EXISTS (
            SELECT 1 FROM makeups m JOIN attendances a2 ON a2.id = m.absence_id
             WHERE a2.student_id = s.id AND a2.class_date >= $1 AND a2.class_date < $2)
        ORDER BY count(*) DESC, s.name`,
      [start, end],
    );
  }

  /**
   * C3 그 달 수강료 청구와 납부 현황.
   * 그 달에 하루라도 수강한 (학생, 반)마다 한 줄.
   * 형제 순서: 같은 가족에서 그 달 수강하는 학생을 생년월일 순으로 센다. 둘째부터 10% 할인.
   */
  tuition(month?: string, opts: { familyId?: number; unpaidOnly?: boolean } = {}) {
    const { start, end } = monthRange(month);
    return this.db.query(
      `WITH active AS (
         SELECT DISTINCT e.student_id, e.class_id
           FROM enrollments e
          WHERE e.start_date < $2 AND (e.end_date IS NULL OR e.end_date > $1)
            AND (e.end_date IS NULL OR e.end_date > e.start_date)
       ), siblings AS (
         SELECT s.id AS student_id,
                row_number() OVER (PARTITION BY s.family_id ORDER BY s.birth_date, s.id)::int AS sibling_order
           FROM students s
          WHERE s.id IN (SELECT student_id FROM active)
       )
       SELECT s.id AS "studentId", s.name AS "studentName", s.grade, f.id AS "familyId", f.name AS "familyName",
              c.id AS "classId", c.name AS "className", c.monthly_fee AS "monthlyFee",
              sb.sibling_order AS "siblingOrder",
              CASE WHEN sb.sibling_order >= 2 THEN round(c.monthly_fee * 0.9)::int ELSE c.monthly_fee END AS "amountDue",
              (p.id IS NOT NULL) AS paid, p.id AS "paymentId", p.paid_at AS "paidAt", p.paid_amount AS "paidAmount"
         FROM active a
         JOIN students s ON s.id = a.student_id
         JOIN families f ON f.id = s.family_id
         JOIN classes c ON c.id = a.class_id
         JOIN siblings sb ON sb.student_id = s.id
         LEFT JOIN tuition_payments p
           ON p.student_id = a.student_id AND p.class_id = a.class_id AND p.billing_month = $1
        WHERE ($3::bigint IS NULL OR s.family_id = $3)
          AND (NOT $4 OR p.id IS NULL)
        ORDER BY f.name, sb.sibling_order, c.name`,
      [start, end, opts.familyId ?? null, opts.unpaidOnly ?? false],
    );
  }

  /**
   * D5 그만둔 학생의 환불 금액 (규정 기준).
   * 그만둔 달의 수업 횟수 중 지난 비율로 정한다:
   *   시작 전 전액 / 1/3 지나기 전 2/3 / 1/2 지나기 전 1/2 / 그 뒤 없음
   * 기준 금액은 그 달 실제로 낸 금액. 안 냈으면 환불할 돈도 없다.
   */
  async refunds(month?: string) {
    const { start, end } = monthRange(month);
    const rows = await this.db.query(
      `SELECT e.id AS "enrollmentId", s.name AS "studentName", c.id AS "classId", c.name AS "className",
              e.start_date AS "startDate", e.end_date AS "endDate",
              p.paid_amount AS "paidAmount",
              (SELECT array_agg(DISTINCT cs.day_of_week) FROM class_schedules cs WHERE cs.class_id = c.id) AS days
         FROM enrollments e
         JOIN students s ON s.id = e.student_id
         JOIN classes c ON c.id = e.class_id
         LEFT JOIN tuition_payments p
           ON p.student_id = e.student_id AND p.class_id = e.class_id
          AND p.billing_month = date_trunc('month', e.end_date)::date
        WHERE e.end_date >= $1 AND e.end_date < $2
        ORDER BY e.end_date, s.name`,
      [start, end],
    );
    return rows.map((r) => ({ ...r, ...this.refundFor(r.startDate, r.endDate, r.days ?? [], r.paidAmount) }));
  }

  refundFor(startDate: string, endDate: string, days: number[], paidAmount: number | null) {
    const month = endDate.slice(0, 7);
    const sessions = datesInMonth(month).filter((d) => days.includes(dayOfWeek(d)));
    // 그 달 안에서 이 학생이 다니기 시작한 뒤의 수업만 센다
    const mine = sessions.filter((d) => d >= startDate);
    const total = mine.length;
    const passed = mine.filter((d) => d < endDate).length;

    let ratio: number;
    let rule: string;
    if (passed === 0) [ratio, rule] = [1, '수업 시작 전: 전액'];
    else if (passed / total < 1 / 3) [ratio, rule] = [2 / 3, '1/3 지나기 전: 2/3'];
    else if (passed / total < 1 / 2) [ratio, rule] = [1 / 2, '1/2 지나기 전: 1/2'];
    else [ratio, rule] = [0, '1/2 지난 뒤: 환불 없음'];

    const refund = paidAmount == null ? 0 : Math.floor(paidAmount * ratio);
    return {
      sessionsTotal: total,
      sessionsPassed: passed,
      rule: paidAmount == null ? `${rule} (그 달 수강료 미납이라 환불 없음)` : rule,
      refund,
    };
  }

  /** D4 학부모용 자녀 요약: 출석, 보강, 납부 */
  async parentSummary(familyId: number, month?: string) {
    const { month: m, start, end } = monthRange(month);
    const students = await this.db.query(
      `SELECT s.id, s.name, s.grade, s.school,
              COALESCE(json_agg(json_build_object('className', c.name, 'startDate', e.start_date))
                       FILTER (WHERE e.id IS NOT NULL), '[]') AS classes
         FROM students s
         LEFT JOIN enrollments e ON e.student_id = s.id
               AND e.start_date < $3 AND (e.end_date IS NULL OR e.end_date > $2)
         LEFT JOIN classes c ON c.id = e.class_id
        WHERE s.family_id = $1
        GROUP BY s.id ORDER BY s.birth_date`,
      [familyId, start, end],
    );
    const attendance = await this.attendance(m, familyId);
    const absences = await this.db.query(
      `SELECT a.student_id AS "studentId", a.class_date AS "date", c.name AS "className",
              m.makeup_date AS "makeupDate", tc.name AS "makeupClass"
         FROM attendances a
         JOIN students s ON s.id = a.student_id
         JOIN classes c ON c.id = a.class_id
         LEFT JOIN makeups m ON m.absence_id = a.id
         LEFT JOIN classes tc ON tc.id = m.target_class_id
        WHERE s.family_id = $1 AND a.status = 'ABSENT' AND a.class_date >= $2 AND a.class_date < $3
        ORDER BY a.class_date`,
      [familyId, start, end],
    );
    const tuition = await this.tuition(m, { familyId });
    return {
      month: m,
      children: students.map((s) => ({
        ...s,
        attendance: attendance.find((a) => a.studentId === s.id) ?? null,
        absences: absences.filter((a) => a.studentId === s.id),
        tuition: tuition.filter((t) => t.studentId === s.id),
      })),
    };
  }
}
