/**
 * 처음 관리자 계정 + 가상 데이터 넣기.
 *   npm run db:seed
 *
 * - 관리자: .env의 SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD (저장소에 적지 않는다)
 * - 가상 직원·학부모 계정: SEED_DEMO_PASSWORD가 있을 때만 만든다 (이메일은 모두 *.test 가짜 주소)
 * - 가상 학생·반·출결·납부: 학생이 하나도 없을 때만 넣는다 (날짜는 실행하는 달 기준)
 * 사람, 학교, 전화번호는 모두 가상이다.
 */
import 'dotenv/config';
import { PoolClient } from 'pg';
import { hashPassword } from '../src/auth/password';
import { datesInMonth, dayOfWeek, todayKST } from '../src/common/dates';
import { createPool } from '../src/db/pool';

const FEE = 280000;

function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** 실행할 때마다 같은 결과가 나오는 가짜 난수 */
function pseudo(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

async function insert(c: PoolClient, sql: string, params: unknown[]): Promise<number> {
  return (await c.query(sql, params)).rows[0].id;
}

async function main() {
  const adminEmail = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const demoPassword = process.env.SEED_DEMO_PASSWORD;
  if (!adminEmail || !adminPassword) throw new Error('.env에 SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD를 넣어 주세요.');

  const pool = createPool();
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('SET LOCAL search_path TO hw2, public');

    // ── 처음 관리자 (원장) ──
    const admin = await c.query('SELECT id FROM staff WHERE email = $1', [adminEmail]);
    let adminId: number;
    if (admin.rowCount) {
      adminId = admin.rows[0].id;
      console.log('관리자 계정이 이미 있습니다.');
    } else {
      adminId = await insert(
        c,
        `INSERT INTO staff (email, password_hash, name, role) VALUES ($1, $2, '한원장', 'ADMIN') RETURNING id`,
        [adminEmail, await hashPassword(adminPassword)],
      );
      console.log('관리자 계정을 만들었습니다.');
    }

    const studentCount = (await c.query('SELECT count(*)::int AS n FROM students')).rows[0].n;
    if (studentCount > 0) {
      console.log('학생 데이터가 이미 있어 가상 데이터는 넣지 않습니다. (다시 넣으려면 npm run db:reset 후 실행)');
      await c.query('COMMIT');
      return;
    }

    // ── 가상 직원 (실장, 강사 2명) ──
    const staffIds: Record<string, number | null> = { office: null, park: null, choi: null };
    if (demoPassword) {
      const hash = await hashPassword(demoPassword);
      staffIds.office = await insert(c, `INSERT INTO staff (email, password_hash, name) VALUES ('office@hanbit.test', $1, '정실장') RETURNING id`, [hash]);
      staffIds.park = await insert(c, `INSERT INTO staff (email, password_hash, name) VALUES ('park@hanbit.test', $1, '박지훈') RETURNING id`, [hash]);
      staffIds.choi = await insert(c, `INSERT INTO staff (email, password_hash, name) VALUES ('choi@hanbit.test', $1, '최유진') RETURNING id`, [hash]);
    }

    // ── 강사 ──
    const T = {
      park: await insert(c, `INSERT INTO teachers (name, subject, staff_id) VALUES ('박지훈', '수학(중등)', $1) RETURNING id`, [staffIds.park]),
      choi: await insert(c, `INSERT INTO teachers (name, subject, staff_id) VALUES ('최유진', '수학(중등·고3)', $1) RETURNING id`, [staffIds.choi]),
      kim: await insert(c, `INSERT INTO teachers (name, subject) VALUES ('김민수', '수학(중3)') RETURNING id`, []),
      lee: await insert(c, `INSERT INTO teachers (name, subject) VALUES ('이서연', '수학(고등)') RETURNING id`, []),
    };

    // ── 반 (주 2회, 월 280,000원, 정원 8명) ──
    const classDefs = [
      { key: 'm1a', name: '중1-A', grade: 7, teacher: T.park, slots: [[1, '17:00', '18:30'], [4, '17:00', '18:30']] },
      { key: 'm2a', name: '중2-A', grade: 8, teacher: T.choi, slots: [[2, '17:00', '18:30'], [5, '17:00', '18:30']] },
      { key: 'm2b', name: '중2-B', grade: 8, teacher: T.park, slots: [[1, '19:00', '20:30'], [3, '19:00', '20:30']] },
      { key: 'm3a', name: '중3-A', grade: 9, teacher: T.kim, slots: [[2, '19:00', '20:30'], [4, '19:00', '20:30']] },
      { key: 'h1a', name: '고1-A', grade: 10, teacher: T.lee, slots: [[1, '17:00', '18:30'], [3, '17:00', '18:30']] },
      { key: 'h2a', name: '고2-A', grade: 11, teacher: T.lee, slots: [[2, '17:00', '18:30'], [4, '17:00', '18:30']] },
      { key: 'h3a', name: '고3-A', grade: 12, teacher: T.choi, slots: [[2, '19:00', '20:30'], [5, '19:00', '20:30']] },
    ] as const;
    const C: Record<string, { id: number; days: number[] }> = {};
    for (const d of classDefs) {
      const id = await insert(
        c,
        `INSERT INTO classes (name, target_grade, teacher_id, capacity, monthly_fee) VALUES ($1, $2, $3, 8, $4) RETURNING id`,
        [d.name, d.grade, d.teacher, FEE],
      );
      for (const [dow, s, e] of d.slots) {
        await c.query(
          'INSERT INTO class_schedules (class_id, teacher_id, day_of_week, start_time, end_time) VALUES ($1, $2, $3, $4, $5)',
          [id, d.teacher, dow, s, e],
        );
      }
      C[d.key] = { id, days: d.slots.map((x) => x[0]) };
    }

    // ── 가족·학생 ──
    // [가족 이름, [[학생 이름, 생년월일, 학년, 학교, 반 key | null]], 학부모 계정 이메일]
    const familyDefs: [string, [string, string, number, string, string | null][], string?][] = [
      ['김하준 가족', [['김하준', '2012-03-14', 8, '한빛중', 'm2b'], ['김하은', '2013-07-02', 7, '한빛중', 'm1a']], 'parent.kim@hanbit.test'],
      ['이도윤 가족', [['이도윤', '2011-05-20', 9, '새솔중', 'm3a']], 'parent.lee@hanbit.test'],
      ['박서준 가족', [['박서준', '2010-01-09', 10, '한빛고', 'h1a'], ['박서아', '2012-11-23', 8, '한빛중', 'm2a']]],
      ['최서연 가족', [['최서연', '2012-06-30', 8, '새솔중', 'm2b']]],
      ['정우진 가족', [['정우진', '2012-02-11', 8, '한빛중', 'm2b']]],
      ['강민서 가족', [['강민서', '2012-09-05', 8, '바른중', 'm2b']]],
      ['조예준 가족', [['조예준', '2012-04-17', 8, '새솔중', 'm2b']]],
      ['윤지아 가족', [['윤지아', '2012-12-01', 8, '바른중', 'm2b']]],
      ['장시우 가족', [['장시우', '2012-08-19', 8, '한빛중', 'm2b']]],
      ['임하린 가족', [['임하린', '2012-05-08', 8, '바른중', 'm2b']]],
      ['한유준 가족', [['한유준', '2012-10-12', 8, '새솔중', 'm2a']]],
      ['오수아 가족', [['오수아', '2012-07-27', 8, '한빛중', 'm2a']]],
      ['서은우 가족', [['서은우', '2012-01-30', 8, '바른중', null]]], // 아직 수강 안 함 → 꽉 찬 중2-B 신청 테스트용
      ['신지호 가족', [['신지호', '2013-03-03', 7, '한빛중', 'm1a']]],
      ['권나윤 가족', [['권나윤', '2013-09-14', 7, '새솔중', 'm1a']]],
      ['황도현 가족', [['황도현', '2011-02-22', 9, '바른중', 'm3a']]],
      ['오지훈 가족', [['오지훈', '2011-08-08', 9, '한빛중', 'm3a']]], // 지난달 중간에 그만둠 → 환불 계산
      ['송가은 가족', [['송가은', '2010-06-16', 10, '새솔고', 'h1a']]],
      ['유태윤 가족', [['유태윤', '2009-04-04', 11, '한빛고', 'h2a']]],
      ['윤채원 가족', [['윤채원', '2009-10-21', 11, '바른고', 'h2a']]], // 이번 달에 그만둠
      ['문준서 가족', [['문준서', '2008-12-25', 12, '한빛고', 'h3a']]],
      ['배소율 가족', [['배소율', '2008-07-07', 12, '새솔고', 'h3a']]],
    ];

    const today = todayKST();
    const thisMonth = today.slice(0, 7);
    const prevMonth = addMonths(thisMonth, -1);
    const startMonth = addMonths(thisMonth, -2);
    const parentHash = demoPassword ? await hashPassword(demoPassword) : null;

    type Enr = { id: number; studentId: number; name: string; classKey: string; start: string; end: string | null };
    const enrollments: Enr[] = [];
    let phone = 1000;

    for (const [famName, kids, parentEmail] of familyDefs) {
      const famId = await insert(c, 'INSERT INTO families (name) VALUES ($1) RETURNING id', [famName]);
      const parentName = `${famName.replace(' 가족', '')} 보호자`;
      if (parentEmail && parentHash) {
        await c.query('INSERT INTO parents (family_id, email, password_hash, name, phone) VALUES ($1, $2, $3, $4, $5)', [
          famId, parentEmail, parentHash, parentName, `010-0000-${phone}`,
        ]);
      }
      for (const [name, birth, grade, school, classKey] of kids) {
        const sid = await insert(
          c,
          'INSERT INTO students (family_id, name, birth_date, grade, school) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [famId, name, birth, grade, school],
        );
        await c.query('INSERT INTO guardian_contacts (student_id, relation, phone) VALUES ($1, $2, $3)', [sid, '엄마', `010-0000-${phone++}`]);
        if (pseudo(sid) > 0.5) {
          await c.query('INSERT INTO guardian_contacts (student_id, relation, phone) VALUES ($1, $2, $3)', [sid, '아빠', `010-0000-${phone++}`]);
        }
        if (!classKey) continue;
        let end: string | null = null;
        if (name === '오지훈') end = `${prevMonth}-10`;
        if (name === '윤채원') end = today;
        const start = `${startMonth}-01`;
        const eid = await insert(
          c,
          'INSERT INTO enrollments (student_id, class_id, start_date, end_date) VALUES ($1, $2, $3, $4) RETURNING id',
          [sid, C[classKey].id, start, end],
        );
        enrollments.push({ id: eid, studentId: sid, name, classKey, start, end });
      }
    }

    // ── 출결: 지난달 ~ 오늘 ──
    // 대부분 출석, 가끔 지각·결석. 김하준·최서연은 이번 달 첫 두 수업 결석(보강 대상 만들기).
    const forcedAbsent = new Set(['김하준', '최서연']);
    const absenceIds: Record<string, number[]> = {};
    for (const month of [prevMonth, thisMonth]) {
      for (const date of datesInMonth(month)) {
        if (date > today) break;
        for (const e of enrollments) {
          const cls = C[e.classKey];
          if (!cls.days.includes(dayOfWeek(date))) continue;
          if (date < e.start || (e.end && date >= e.end)) continue;
          let status: 'PRESENT' | 'LATE' | 'ABSENT';
          const r = pseudo(e.studentId * 1000 + Number(date.replace(/-/g, '')) % 997);
          status = r < 0.06 ? 'ABSENT' : r < 0.16 ? 'LATE' : 'PRESENT';
          if (month === thisMonth && forcedAbsent.has(e.name)) {
            const n = (absenceIds[e.name] ?? []).length;
            status = n < 2 ? 'ABSENT' : 'PRESENT';
          } else if (month === thisMonth && status === 'ABSENT') {
            status = 'PRESENT'; // 이번 달 보강 대상은 위 두 명만 보이게
          }
          if (e.name === '이도윤' && month === prevMonth && r < 0.5) status = 'LATE'; // 지각이 잦은 학생
          const aid = await insert(
            c,
            'INSERT INTO attendances (student_id, class_id, class_date, status) VALUES ($1, $2, $3, $4) RETURNING id',
            [e.studentId, cls.id, date, status],
          );
          if (month === thisMonth && status === 'ABSENT') (absenceIds[e.name] ??= []).push(aid);
        }
      }
    }

    // ── 보강: 최서연은 이번 달 결석 하나에 중2-A 보강을 잡아 둔다 → 보강 대상 목록에서 빠짐 ──
    const choiAbs = absenceIds['최서연']?.[0];
    const m2aDay = datesInMonth(thisMonth).find((d) => C.m2a.days.includes(dayOfWeek(d)));
    if (choiAbs && m2aDay) {
      await c.query('INSERT INTO makeups (absence_id, target_class_id, makeup_date, created_by) VALUES ($1, $2, $3, $4)', [
        choiAbs, C.m2a.id, m2aDay, adminId,
      ]);
    }

    // ── 수강료 납부 ──
    // 지난 두 달: 거의 다 냄 (형제 할인 반영). 이번 달: 절반쯤만 냄 → 미납 목록.
    const famOrder = await c.query(
      `SELECT s.id, row_number() OVER (PARTITION BY s.family_id ORDER BY s.birth_date, s.id) AS ord FROM students s`,
    );
    const order = new Map<number, number>(famOrder.rows.map((r) => [r.id, Number(r.ord)]));
    for (const month of [startMonth, prevMonth, thisMonth]) {
      for (const e of enrollments) {
        const monthStart = `${month}-01`;
        if (e.end && e.end <= monthStart) continue;
        const amount = (order.get(e.studentId) ?? 1) >= 2 ? Math.round(FEE * 0.9) : FEE;
        const r = pseudo(e.studentId * 31 + Number(month.replace('-', '')));
        const paid = month === thisMonth ? r < 0.5 && !e.name.startsWith('김') : !(month === prevMonth && e.name === '황도현');
        if (!paid) continue;
        await c.query(
          `INSERT INTO tuition_payments (student_id, class_id, billing_month, paid_at, paid_amount, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [e.studentId, C[e.classKey].id, monthStart, `${month}-0${1 + Math.floor(r * 5)}`, amount, adminId],
        );
      }
    }

    await c.query('COMMIT');
    console.log(`가상 데이터: 반 ${classDefs.length}개, 학생 ${familyDefs.reduce((n, f) => n + f[1].length, 0)}명, 수강 ${enrollments.length}건`);
    if (!demoPassword) console.log('SEED_DEMO_PASSWORD가 없어 가상 직원·학부모 계정은 만들지 않았습니다.');
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('실패:', e.message);
  process.exit(1);
});
