import { ForbiddenException, Injectable } from '@nestjs/common';
import { GRADE_NAMES, todayKST } from '../common/dates';
import { RuleError } from '../common/errors';
import { DbService } from '../db/db.service';
import { EnrollDto } from './dto';

/**
 * 수강 신청·그만두기. 어드민과 코어 웹이 같은 규칙을 쓰도록 한 곳에 둔다.
 *
 * 수강 기간: [start_date, end_date) — end_date는 "그만둔 날"(그날부터 안 다님), null이면 계속.
 * 정원 계산: 새 시작일 이후에 하루라도 겹치는 수강을 모두 센다(앞으로 시작할 학생 포함).
 */
@Injectable()
export class EnrollmentsService {
  constructor(private readonly db: DbService) {}

  async create(dto: EnrollDto, opts: { familyId?: number } = {}) {
    if (opts.familyId && dto.startDate < todayKST()) {
      throw new RuleError('시작일은 오늘이나 그 뒤로 골라 주세요.');
    }

    return this.db.tx(async (c) => {
      const st = (await c.query('SELECT id, name, grade, family_id FROM students WHERE id = $1', [dto.studentId])).rows[0];
      if (!st) throw new RuleError('학생을 찾을 수 없습니다.');
      if (opts.familyId && st.family_id !== opts.familyId) throw new ForbiddenException('내 자녀만 신청할 수 있습니다.');

      // 같은 반에 동시에 신청이 몰려도 한 명씩 처리되도록 반 행을 잠근다 (B3)
      const cl = (
        await c.query('SELECT id, name, target_grade, capacity, is_active FROM classes WHERE id = $1 FOR UPDATE', [
          dto.classId,
        ])
      ).rows[0];
      if (!cl) throw new RuleError('반을 찾을 수 없습니다.');
      if (!cl.is_active) throw new RuleError(`${cl.name}은(는) 지금 운영하지 않는 반입니다.`);

      // B4 학년
      if (st.grade !== cl.target_grade) {
        throw new RuleError(
          `${st.name} 학생은 ${GRADE_NAMES[st.grade]}이라 ${GRADE_NAMES[cl.target_grade]} 반(${cl.name})에 신청할 수 없습니다.`,
        );
      }

      // B2 중복 (DB 배제 제약도 막지만, 쉬운 말로 먼저 알려 준다)
      const dup = await c.query(
        `SELECT 1 FROM enrollments
          WHERE student_id = $1 AND class_id = $2
            AND (end_date IS NULL OR end_date > $3) AND (end_date IS NULL OR end_date > start_date)`,
        [st.id, cl.id, dto.startDate],
      );
      if (dup.rowCount) throw new RuleError(`${st.name} 학생은 이미 ${cl.name}을(를) 다니고 있습니다.`);

      // B3 정원
      const cnt = (
        await c.query(
          `SELECT count(*)::int AS n FROM enrollments
            WHERE class_id = $1
              AND (end_date IS NULL OR end_date > $2) AND (end_date IS NULL OR end_date > start_date)`,
          [cl.id, dto.startDate],
        )
      ).rows[0].n;
      if (cnt >= cl.capacity) {
        throw new RuleError(`${cl.name}은(는) 정원 ${cl.capacity}명이 모두 찼습니다. (지금 ${cnt}명 수강 중)`);
      }

      const row = (
        await c.query(
          `INSERT INTO enrollments (student_id, class_id, start_date)
           VALUES ($1, $2, $3) RETURNING id, student_id AS "studentId", class_id AS "classId",
             start_date AS "startDate", end_date AS "endDate"`,
          [st.id, cl.id, dto.startDate],
        )
      ).rows[0];
      return row;
    });
  }

  /** 그만두기: 행을 지우지 않고 그만둔 날만 남긴다 (B1) */
  async end(enrollmentId: number, endDate: string | undefined, opts: { familyId?: number } = {}) {
    const e = await this.db.one(
      `SELECT e.id, e.start_date, e.end_date, s.family_id, s.name AS student_name, c.name AS class_name
         FROM enrollments e JOIN students s ON s.id = e.student_id JOIN classes c ON c.id = e.class_id
        WHERE e.id = $1`,
      [enrollmentId],
    );
    if (!e) throw new RuleError('수강 기록을 찾을 수 없습니다.');
    if (opts.familyId && e.family_id !== opts.familyId) throw new ForbiddenException('내 자녀의 수강만 취소할 수 있습니다.');
    if (e.end_date) throw new RuleError(`이미 ${e.end_date}에 그만둔 수강입니다.`);

    let date = endDate ?? todayKST();
    if (opts.familyId) {
      // 학부모는 오늘 기준으로만 취소. 아직 시작 전이면 시작일로 (= 시작 전 취소)
      date = todayKST() < e.start_date ? e.start_date : todayKST();
    } else if (date < e.start_date) {
      throw new RuleError(`그만둔 날은 시작일(${e.start_date})보다 빠를 수 없습니다.`);
    }

    return this.db.one(
      `UPDATE enrollments SET end_date = $2 WHERE id = $1
       RETURNING id, student_id AS "studentId", class_id AS "classId", start_date AS "startDate", end_date AS "endDate"`,
      [enrollmentId, date],
    );
  }
}
