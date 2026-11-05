import { Injectable } from '@nestjs/common';
import { DAY_NAMES, dayOfWeek, todayKST } from '../common/dates';
import { RuleError } from '../common/errors';
import { DbService } from '../db/db.service';
import { SaveAttendanceDto } from './dto';

const ACTIVE_ON = (alias: string, param: string) =>
  `${alias}.start_date <= ${param} AND (${alias}.end_date IS NULL OR ${alias}.end_date > ${param})`;

@Injectable()
export class AttendanceService {
  constructor(private readonly db: DbService) {}

  private async classWithDays(classId: number) {
    const cl = await this.db.one('SELECT id, name, capacity FROM classes WHERE id = $1', [classId]);
    if (!cl) throw new RuleError('반을 찾을 수 없습니다.');
    const days = (
      await this.db.query('SELECT DISTINCT day_of_week FROM class_schedules WHERE class_id = $1 ORDER BY 1', [classId])
    ).map((r) => r.day_of_week as number);
    return { ...cl, days };
  }

  /** 그날 출결 명단: 그날 수강 중인 학생 + 그날 보강 들어오는 학생 */
  async roster(classId: number, date: string) {
    const cl = await this.classWithDays(classId);
    const isClassDay = cl.days.includes(dayOfWeek(date));

    const students = await this.db.query(
      `SELECT s.id AS "studentId", s.name, s.grade, a.status, a.id AS "attendanceId",
              (m.id IS NOT NULL) AS "hasMakeup"
         FROM enrollments e
         JOIN students s ON s.id = e.student_id
         LEFT JOIN attendances a ON a.student_id = s.id AND a.class_id = e.class_id AND a.class_date = $2
         LEFT JOIN makeups m ON m.absence_id = a.id
        WHERE e.class_id = $1 AND ${ACTIVE_ON('e', '$2')}
        ORDER BY s.name`,
      [classId, date],
    );
    const makeupStudents = await this.db.query(
      `SELECT s.id AS "studentId", s.name, s.grade, oc.name AS "fromClass", a.class_date AS "absentDate"
         FROM makeups m
         JOIN attendances a ON a.id = m.absence_id
         JOIN students s ON s.id = a.student_id
         JOIN classes oc ON oc.id = a.class_id
        WHERE m.target_class_id = $1 AND m.makeup_date = $2
        ORDER BY s.name`,
      [classId, date],
    );
    return {
      class: { id: cl.id, name: cl.name, capacity: cl.capacity, days: cl.days.map((d: number) => DAY_NAMES[d]) },
      date,
      isClassDay,
      students,
      makeupStudents,
    };
  }

  /** 출결 저장 (B6): 학생·반·날짜마다 하나 → 있으면 고치고 없으면 넣는다 */
  async save(classId: number, dto: SaveAttendanceDto) {
    const cl = await this.classWithDays(classId);
    if (!cl.days.includes(dayOfWeek(dto.date))) {
      throw new RuleError(
        `${dto.date}은(는) ${DAY_NAMES[dayOfWeek(dto.date)]}요일이라 ${cl.name} 수업일이 아닙니다. (수업 요일: ${cl.days
          .map((d: number) => DAY_NAMES[d])
          .join(', ')})`,
      );
    }
    if (dto.date > todayKST()) throw new RuleError('아직 오지 않은 날짜의 출결은 남길 수 없습니다.');

    return this.db.tx(async (c) => {
      for (const r of dto.records) {
        const enrolled = await c.query(
          `SELECT s.name FROM enrollments e JOIN students s ON s.id = e.student_id
            WHERE e.class_id = $1 AND e.student_id = $2 AND ${ACTIVE_ON('e', '$3')}`,
          [classId, r.studentId, dto.date],
        );
        if (!enrolled.rowCount) throw new RuleError(`학생(${r.studentId})은 ${dto.date}에 ${cl.name}을(를) 다니고 있지 않습니다.`);

        const prev = (
          await c.query(
            `SELECT a.id, a.status, m.id AS makeup_id FROM attendances a LEFT JOIN makeups m ON m.absence_id = a.id
              WHERE a.student_id = $1 AND a.class_id = $2 AND a.class_date = $3`,
            [r.studentId, classId, dto.date],
          )
        ).rows[0];
        if (prev?.makeup_id && r.status !== 'ABSENT') {
          throw new RuleError(
            `${enrolled.rows[0].name} 학생의 이 결석에는 보강이 잡혀 있어 결석이 아닌 것으로 바꿀 수 없습니다. 보강을 먼저 지워 주세요.`,
          );
        }

        await c.query(
          `INSERT INTO attendances (student_id, class_id, class_date, status)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (student_id, class_id, class_date)
           DO UPDATE SET status = EXCLUDED.status, updated_at = now()`,
          [r.studentId, classId, dto.date, r.status],
        );
      }
      return { saved: dto.records.length };
    });
  }
}
