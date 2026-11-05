import { Injectable } from '@nestjs/common';
import { DAY_NAMES, datesInMonth, dayOfWeek, GRADE_NAMES, monthRange } from '../common/dates';
import { RuleError } from '../common/errors';
import { DbService, Queryable } from '../db/db.service';
import { MakeupDto } from './dto';

/** 그날 그 반에 오는 인원 = 수강 중 학생 + 보강 학생 (B7) */
async function headcount(c: Queryable, classId: number, date: string): Promise<number> {
  const r = await c.query(
    `SELECT
       (SELECT count(*) FROM enrollments e
         WHERE e.class_id = $1 AND e.start_date <= $2 AND (e.end_date IS NULL OR e.end_date > $2))
     + (SELECT count(*) FROM makeups m WHERE m.target_class_id = $1 AND m.makeup_date = $2) AS n`,
    [classId, date],
  );
  return Number(r.rows[0].n);
}

@Injectable()
export class MakeupsService {
  constructor(private readonly db: DbService) {}

  /** 그 달 결석 중 아직 보강이 없는 것 */
  candidates(month?: string) {
    const { start, end } = monthRange(month);
    return this.db.query(
      `SELECT a.id AS "absenceId", a.class_date AS "absentDate", s.id AS "studentId", s.name AS "studentName",
              s.grade, c.id AS "classId", c.name AS "className"
         FROM attendances a
         JOIN students s ON s.id = a.student_id
         JOIN classes c ON c.id = a.class_id
         LEFT JOIN makeups m ON m.absence_id = a.id
        WHERE a.status = 'ABSENT' AND m.id IS NULL AND a.class_date >= $1 AND a.class_date < $2
        ORDER BY a.class_date, s.name`,
      [start, end],
    );
  }

  /** 결석 하나에 대해 보강 들어갈 수 있는 (반, 날짜) 목록: 같은 학년 다른 반, 결석한 달 안의 수업일 */
  async options(absenceId: number) {
    const ab = await this.db.one(
      `SELECT a.id, a.class_id, a.class_date, a.status, s.grade, s.name
         FROM attendances a JOIN students s ON s.id = a.student_id WHERE a.id = $1`,
      [absenceId],
    );
    if (!ab) throw new RuleError('결석 기록을 찾을 수 없습니다.');
    const month = ab.class_date.slice(0, 7);
    const classes = await this.db.query(
      `SELECT c.id, c.name, c.capacity, array_agg(DISTINCT cs.day_of_week) AS days
         FROM classes c JOIN class_schedules cs ON cs.class_id = c.id
        WHERE c.target_grade = $1 AND c.id <> $2 AND c.is_active
        GROUP BY c.id ORDER BY c.name`,
      [ab.grade, ab.class_id],
    );
    const result: any[] = [];
    for (const cl of classes) {
      for (const d of datesInMonth(month)) {
        if (!cl.days.includes(dayOfWeek(d))) continue;
        const n = await headcount(this.db.pool, cl.id, d);
        result.push({
          classId: cl.id,
          className: cl.name,
          date: d,
          day: DAY_NAMES[dayOfWeek(d)],
          headcount: n,
          capacity: cl.capacity,
          full: n >= cl.capacity,
        });
      }
    }
    return { absence: { id: ab.id, studentName: ab.name, absentDate: ab.class_date }, options: result };
  }

  list(month?: string) {
    const { start, end } = monthRange(month);
    return this.db.query(
      `SELECT m.id, m.makeup_date AS "makeupDate", tc.name AS "targetClass", s.name AS "studentName",
              oc.name AS "fromClass", a.class_date AS "absentDate", st.name AS "createdBy"
         FROM makeups m
         JOIN attendances a ON a.id = m.absence_id
         JOIN students s ON s.id = a.student_id
         JOIN classes oc ON oc.id = a.class_id
         JOIN classes tc ON tc.id = m.target_class_id
         LEFT JOIN staff st ON st.id = m.created_by
        WHERE a.class_date >= $1 AND a.class_date < $2
        ORDER BY m.makeup_date, s.name`,
      [start, end],
    );
  }

  async create(dto: MakeupDto, staffId: number) {
    return this.db.tx(async (c) => {
      const ab = (
        await c.query(
          `SELECT a.id, a.class_id, a.class_date, a.status, a.student_id, s.grade, s.name
             FROM attendances a JOIN students s ON s.id = a.student_id WHERE a.id = $1`,
          [dto.absenceId],
        )
      ).rows[0];
      if (!ab) throw new RuleError('결석 기록을 찾을 수 없습니다.');
      if (ab.status !== 'ABSENT') throw new RuleError('보강은 결석한 수업에만 잡을 수 있습니다.');

      // 그날 정원 계산이 동시에 꼬이지 않게 보강 들어갈 반을 잠근다
      const tc = (
        await c.query('SELECT id, name, target_grade, capacity FROM classes WHERE id = $1 FOR UPDATE', [dto.targetClassId])
      ).rows[0];
      if (!tc) throw new RuleError('보강 들어갈 반을 찾을 수 없습니다.');
      if (tc.id === ab.class_id) throw new RuleError('보강은 원래 반이 아닌 다른 반 수업에 잡아야 합니다.');
      if (tc.target_grade !== ab.grade) {
        throw new RuleError(`${ab.name} 학생은 ${GRADE_NAMES[ab.grade]}이라 ${GRADE_NAMES[tc.target_grade]} 반(${tc.name})에서 보강할 수 없습니다.`);
      }
      if (dto.makeupDate.slice(0, 7) !== ab.class_date.slice(0, 7)) {
        throw new RuleError(`보강은 결석한 달(${ab.class_date.slice(0, 7)}) 안에서만 잡을 수 있습니다.`);
      }
      const days = (await c.query('SELECT day_of_week FROM class_schedules WHERE class_id = $1', [tc.id])).rows.map(
        (r) => r.day_of_week,
      );
      if (!days.includes(dayOfWeek(dto.makeupDate))) {
        throw new RuleError(`${dto.makeupDate}은(는) ${tc.name} 수업일이 아닙니다.`);
      }
      const already = await c.query(
        `SELECT 1 FROM enrollments WHERE student_id = $1 AND class_id = $2
            AND start_date <= $3 AND (end_date IS NULL OR end_date > $3)`,
        [ab.student_id, tc.id, dto.makeupDate],
      );
      if (already.rowCount) throw new RuleError(`${ab.name} 학생은 이미 ${tc.name}을(를) 다니고 있습니다.`);

      const n = await headcount(c, tc.id, dto.makeupDate);
      if (n >= tc.capacity) {
        throw new RuleError(
          `${dto.makeupDate} ${tc.name} 수업은 이미 ${n}명(수강생 + 보강)이라 정원 ${tc.capacity}명을 넘습니다.`,
        );
      }

      return (
        await c.query(
          `INSERT INTO makeups (absence_id, target_class_id, makeup_date, created_by)
           VALUES ($1, $2, $3, $4) RETURNING id, makeup_date AS "makeupDate"`,
          [ab.id, tc.id, dto.makeupDate, staffId],
        )
      ).rows[0];
    });
  }

  async remove(id: number) {
    const r = await this.db.query('DELETE FROM makeups WHERE id = $1 RETURNING id', [id]);
    if (!r.length) throw new RuleError('보강을 찾을 수 없습니다.');
    return { ok: true };
  }
}
