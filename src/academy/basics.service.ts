import { ForbiddenException, Injectable } from '@nestjs/common';
import { todayKST } from '../common/dates';
import { RuleError } from '../common/errors';
import { DbService } from '../db/db.service';
import { AdminStudentDto, ClassDto, ContactDto, StudentDto, TeacherDto, UpdateClassDto, UpdateStudentDto } from './dto';

/** 기본 정보 (A): 가족, 학생, 연락처, 강사, 반, 시간표 */
@Injectable()
export class BasicsService {
  constructor(private readonly db: DbService) {}

  // ───────── 가족 ─────────
  families() {
    return this.db.query(
      `SELECT f.id, f.name,
              COALESCE(json_agg(json_build_object('id', s.id, 'name', s.name, 'grade', s.grade, 'birthDate', s.birth_date)
                       ORDER BY s.birth_date) FILTER (WHERE s.id IS NOT NULL), '[]') AS students,
              (SELECT json_agg(json_build_object('name', p.name, 'email', p.email)) FROM parents p WHERE p.family_id = f.id) AS parents
         FROM families f LEFT JOIN students s ON s.family_id = f.id
        GROUP BY f.id ORDER BY f.name`,
    );
  }

  createFamily(name: string) {
    return this.db.one('INSERT INTO families (name) VALUES ($1) RETURNING id, name', [name.trim()]);
  }

  // ───────── 학생 ─────────
  students(familyId?: number) {
    return this.db.query(
      `SELECT s.id, s.name, s.grade, s.school, s.birth_date AS "birthDate", f.id AS "familyId", f.name AS "familyName",
              COALESCE((SELECT json_agg(json_build_object('relation', g.relation, 'phone', g.phone) ORDER BY g.id)
                          FROM guardian_contacts g WHERE g.student_id = s.id), '[]') AS contacts,
              COALESCE((SELECT json_agg(c.name ORDER BY c.name) FROM enrollments e JOIN classes c ON c.id = e.class_id
                         WHERE e.student_id = s.id AND (e.end_date IS NULL OR e.end_date > $2)
                           AND (e.end_date IS NULL OR e.end_date > e.start_date)), '[]') AS classes
         FROM students s JOIN families f ON f.id = s.family_id
        WHERE ($1::bigint IS NULL OR s.family_id = $1)
        ORDER BY s.grade, s.name`,
      [familyId ?? null, todayKST()],
    );
  }

  async student(id: number, familyId?: number) {
    const s = await this.db.one(
      `SELECT s.id, s.name, s.grade, s.school, s.birth_date AS "birthDate", s.family_id AS "familyId", f.name AS "familyName"
         FROM students s JOIN families f ON f.id = s.family_id WHERE s.id = $1`,
      [id],
    );
    if (!s) throw new RuleError('학생을 찾을 수 없습니다.');
    if (familyId && s.familyId !== familyId) throw new ForbiddenException('내 자녀만 볼 수 있습니다.');
    const [contacts, siblings, enrollments, payments] = await Promise.all([
      this.db.query('SELECT id, relation, phone FROM guardian_contacts WHERE student_id = $1 ORDER BY id', [id]),
      this.db.query('SELECT id, name, grade, birth_date AS "birthDate" FROM students WHERE family_id = $1 AND id <> $2 ORDER BY birth_date', [s.familyId, id]),
      this.db.query(
        `SELECT e.id, c.id AS "classId", c.name AS "className", e.start_date AS "startDate", e.end_date AS "endDate"
           FROM enrollments e JOIN classes c ON c.id = e.class_id WHERE e.student_id = $1 ORDER BY e.start_date DESC`,
        [id],
      ),
      this.db.query(
        `SELECT p.id, to_char(p.billing_month, 'YYYY-MM') AS month, c.name AS "className", p.paid_at AS "paidAt", p.paid_amount AS "paidAmount"
           FROM tuition_payments p JOIN classes c ON c.id = p.class_id WHERE p.student_id = $1 ORDER BY p.billing_month DESC`,
        [id],
      ),
    ]);
    return { ...s, contacts, siblings, enrollments, payments };
  }

  /** 학부모가 자녀 등록: 가족은 학부모 계정의 가족으로 고정 */
  createStudentForFamily(familyId: number, dto: StudentDto) {
    return this.insertStudent(familyId, dto);
  }

  /** 직원이 학생 등록: 기존 가족에 넣거나(형제자매) 새 가족을 만든다 */
  async createStudentByStaff(dto: AdminStudentDto) {
    let familyId = dto.familyId;
    if (!familyId) {
      const fam = await this.createFamily(dto.newFamilyName?.trim() || `${dto.name} 가족`);
      familyId = fam!.id;
    }
    return this.insertStudent(familyId!, dto);
  }

  private insertStudent(familyId: number, dto: StudentDto) {
    return this.db.tx(async (c) => {
      const s = (
        await c.query(
          `INSERT INTO students (family_id, name, birth_date, grade, school) VALUES ($1, $2, $3, $4, $5)
           RETURNING id, name, grade, school, birth_date AS "birthDate", family_id AS "familyId"`,
          [familyId, dto.name.trim(), dto.birthDate, dto.grade, dto.school.trim()],
        )
      ).rows[0];
      for (const ct of dto.contacts ?? []) {
        if (!ct.phone?.trim()) continue;
        await c.query('INSERT INTO guardian_contacts (student_id, relation, phone) VALUES ($1, $2, $3)', [
          s.id,
          ct.relation.trim(),
          ct.phone.trim(),
        ]);
      }
      return s;
    });
  }

  async updateStudent(id: number, dto: UpdateStudentDto) {
    const row = await this.db.one(
      `UPDATE students SET name = COALESCE($2, name), birth_date = COALESCE($3, birth_date),
              grade = COALESCE($4, grade), school = COALESCE($5, school), family_id = COALESCE($6, family_id)
        WHERE id = $1 RETURNING id`,
      [id, dto.name ?? null, dto.birthDate ?? null, dto.grade ?? null, dto.school ?? null, dto.familyId ?? null],
    );
    if (!row) throw new RuleError('학생을 찾을 수 없습니다.');
    return this.student(id);
  }

  async addContact(studentId: number, dto: ContactDto, familyId?: number) {
    if (familyId) await this.student(studentId, familyId); // 내 자녀인지 확인
    return this.db.one(
      'INSERT INTO guardian_contacts (student_id, relation, phone) VALUES ($1, $2, $3) RETURNING id, relation, phone',
      [studentId, dto.relation.trim(), dto.phone.trim()],
    );
  }

  async removeContact(contactId: number, familyId?: number) {
    const ct = await this.db.one(
      'SELECT g.id, s.family_id FROM guardian_contacts g JOIN students s ON s.id = g.student_id WHERE g.id = $1',
      [contactId],
    );
    if (!ct) throw new RuleError('연락처를 찾을 수 없습니다.');
    if (familyId && ct.family_id !== familyId) throw new ForbiddenException('내 자녀의 연락처만 지울 수 있습니다.');
    await this.db.query('DELETE FROM guardian_contacts WHERE id = $1', [contactId]);
    return { ok: true };
  }

  // ───────── 강사 ─────────
  teachers() {
    return this.db.query(
      `SELECT t.id, t.name, t.subject, t.staff_id AS "staffId", st.email AS "staffEmail",
              COALESCE((SELECT json_agg(c.name ORDER BY c.name) FROM classes c WHERE c.teacher_id = t.id AND c.is_active), '[]') AS classes
         FROM teachers t LEFT JOIN staff st ON st.id = t.staff_id ORDER BY t.name`,
    );
  }

  createTeacher(dto: TeacherDto) {
    return this.db.one('INSERT INTO teachers (name, subject, staff_id) VALUES ($1, $2, $3) RETURNING id, name, subject', [
      dto.name.trim(),
      dto.subject.trim(),
      dto.staffId ?? null,
    ]);
  }

  async updateTeacher(id: number, dto: TeacherDto) {
    const row = await this.db.one(
      'UPDATE teachers SET name = $2, subject = $3, staff_id = $4 WHERE id = $1 RETURNING id, name, subject',
      [id, dto.name.trim(), dto.subject.trim(), dto.staffId ?? null],
    );
    if (!row) throw new RuleError('강사를 찾을 수 없습니다.');
    return row;
  }

  // ───────── 반 ─────────
  /** seats = 오늘 이후 하루라도 겹치는 수강 수 (앞으로 시작할 학생 포함) — 신청 때 정원 검사와 같은 기준 */
  classes(opts: { activeOnly?: boolean } = {}) {
    return this.db.query(
      `SELECT c.id, c.name, c.target_grade AS "targetGrade", c.capacity, c.monthly_fee AS "monthlyFee", c.is_active AS "isActive",
              t.id AS "teacherId", t.name AS "teacherName",
              COALESCE((SELECT json_agg(json_build_object('dayOfWeek', cs.day_of_week,
                                 'startTime', to_char(cs.start_time, 'HH24:MI'), 'endTime', to_char(cs.end_time, 'HH24:MI'))
                                 ORDER BY cs.day_of_week, cs.start_time)
                          FROM class_schedules cs WHERE cs.class_id = c.id), '[]') AS schedules,
              (SELECT count(*)::int FROM enrollments e
                WHERE e.class_id = c.id AND (e.end_date IS NULL OR e.end_date > $1)
                  AND (e.end_date IS NULL OR e.end_date > e.start_date)) AS enrolled
         FROM classes c JOIN teachers t ON t.id = c.teacher_id
        WHERE (NOT $2 OR c.is_active)
        ORDER BY c.target_grade, c.name`,
      [todayKST(), opts.activeOnly ?? false],
    );
  }

  async classDetail(id: number) {
    const cl = (await this.classes()).find((c) => c.id === id);
    if (!cl) throw new RuleError('반을 찾을 수 없습니다.');
    const enrollments = await this.db.query(
      `SELECT e.id, s.id AS "studentId", s.name AS "studentName", s.grade, e.start_date AS "startDate", e.end_date AS "endDate"
         FROM enrollments e JOIN students s ON s.id = e.student_id
        WHERE e.class_id = $1 ORDER BY (e.end_date IS NULL) DESC, s.name`,
      [id],
    );
    return { ...cl, enrollments };
  }

  async createClass(dto: ClassDto) {
    return this.db.tx(async (c) => {
      const cl = (
        await c.query(
          `INSERT INTO classes (name, target_grade, teacher_id, capacity, monthly_fee)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, teacher_id`,
          [dto.name.trim(), dto.targetGrade, dto.teacherId, dto.capacity ?? 8, dto.monthlyFee],
        )
      ).rows[0];
      for (const s of dto.schedules) {
        await c.query(
          `INSERT INTO class_schedules (class_id, teacher_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4, $5)`,
          [cl.id, cl.teacher_id, s.dayOfWeek, s.startTime, s.endTime],
        );
      }
      return { id: cl.id };
    });
  }

  /**
   * 반 수정. 강사를 바꾸면 복합 FK(ON UPDATE CASCADE)로 시간표의 강사도 따라 바뀌고,
   * 새 강사의 다른 반과 시간이 겹치면 DB 배제 제약이 거절한다.
   */
  async updateClass(id: number, dto: UpdateClassDto) {
    return this.db.tx(async (c) => {
      const cl = (
        await c.query(
          `UPDATE classes SET name = COALESCE($2, name), target_grade = COALESCE($3, target_grade),
                  teacher_id = COALESCE($4, teacher_id), capacity = COALESCE($5, capacity),
                  monthly_fee = COALESCE($6, monthly_fee), is_active = COALESCE($7, is_active)
            WHERE id = $1 RETURNING id, teacher_id`,
          [id, dto.name ?? null, dto.targetGrade ?? null, dto.teacherId ?? null, dto.capacity ?? null, dto.monthlyFee ?? null, dto.isActive ?? null],
        )
      ).rows[0];
      if (!cl) throw new RuleError('반을 찾을 수 없습니다.');
      if (dto.schedules) {
        await c.query('DELETE FROM class_schedules WHERE class_id = $1', [id]);
        for (const s of dto.schedules) {
          await c.query(
            `INSERT INTO class_schedules (class_id, teacher_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4, $5)`,
            [id, cl.teacher_id, s.dayOfWeek, s.startTime, s.endTime],
          );
        }
      }
      return { id };
    });
  }
}
