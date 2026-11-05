import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

/** 업무 규칙 위반: 쉬운 말로 거절 이유를 돌려준다 */
export class RuleError extends BadRequestException {
  constructor(message: string) {
    super({ message, source: 'backend' });
  }
}

// DB 제약 이름 → 쉬운 말
const CONSTRAINT_MESSAGES: Record<string, string> = {
  parents_email_key: '이미 가입된 이메일입니다.',
  staff_email_key: '이미 사용 중인 직원 이메일입니다.',
  parents_email_lower: '이메일은 소문자로 저장해야 합니다.',
  staff_email_lower: '이메일은 소문자로 저장해야 합니다.',
  staff_role_check: '직원 역할은 관리자(ADMIN) 또는 일반 직원(STAFF)만 됩니다.',
  students_grade_check: '학년은 중1~고3(7~12)만 됩니다.',
  classes_grade_check: '대상 학년은 중1~고3(7~12)만 됩니다.',
  classes_capacity_check: '정원은 1명 이상이어야 합니다.',
  classes_fee_check: '수강료는 0원 이상이어야 합니다.',
  class_schedules_time_check: '수업 끝 시각은 시작 시각보다 늦어야 합니다.',
  class_schedules_dow_check: '요일 값이 올바르지 않습니다.',
  class_schedules_teacher_no_overlap: '이 강사는 같은 요일·시간에 이미 다른 반을 맡고 있습니다.',
  enrollments_date_check: '그만둔 날은 시작일보다 빠를 수 없습니다.',
  enrollments_no_overlap: '이 학생은 이미 이 반을 다니고 있습니다.',
  attendances_status_check: '출결은 출석, 지각, 결석 중 하나여야 합니다.',
  attendances_unique: '이 학생의 같은 날 출결이 이미 있습니다.',
  makeups_absence_id_key: '이 결석에는 이미 보강이 잡혀 있습니다.',
  tuition_payments_unique: '이 달 수강료 납부 기록이 이미 있습니다.',
  tuition_payments_month_check: '납부 월은 그 달 1일로 저장해야 합니다.',
  tuition_payments_amount_check: '납부 금액은 0원 이상이어야 합니다.',
  teachers_staff_id_key: '이 직원 계정은 이미 다른 강사에 연결돼 있습니다.',
};

/** 모든 오류를 { message } 형태로 통일하고, DB 제약 위반은 쉬운 말로 바꾼다 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(err: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (err instanceof HttpException) {
      const body = err.getResponse() as any;
      let message = typeof body === 'string' ? body : body.message;
      if (Array.isArray(message)) message = message.join(' / ');
      return res.status(err.getStatus()).json({ message, source: body?.source ?? 'backend' });
    }

    // PostgreSQL 오류 코드: 23505 중복, 23P01 배제(겹침), 23514 CHECK, 23503 FK
    if (err?.code && ['23505', '23P01', '23514', '23503', '23502'].includes(err.code)) {
      const known = err.constraint && CONSTRAINT_MESSAGES[err.constraint];
      const fallback =
        err.code === '23503' ? '연결된 데이터가 없거나, 다른 데이터가 이 항목을 쓰고 있습니다.' : '저장할 수 없는 값입니다.';
      return res.status(HttpStatus.CONFLICT).json({
        message: known ?? fallback,
        source: 'database',
        constraint: err.constraint,
      });
    }
    if (err?.code === '22007' || err?.code === '22008' || err?.code === '22P02') {
      return res.status(HttpStatus.BAD_REQUEST).json({ message: '입력 형식이 올바르지 않습니다.', source: 'database' });
    }

    console.error(err);
    return res.status(500).json({ message: '서버 오류가 났습니다. 잠시 후 다시 시도해 주세요.' });
  }
}
