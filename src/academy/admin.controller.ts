import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Auth, CurrentUser, User } from '../auth/auth.decorators';
import { monthRange } from '../common/dates';
import { RuleError } from '../common/errors';
import { DbService } from '../db/db.service';
import { AttendanceService } from './attendance.service';
import { BasicsService } from './basics.service';
import {
  AdminStudentDto,
  ClassDto,
  ContactDto,
  EndEnrollmentDto,
  EnrollDto,
  FamilyDto,
  MakeupDto,
  PaymentDto,
  SaveAttendanceDto,
  TeacherDto,
  UpdateClassDto,
  UpdateStudentDto,
} from './dto';
import { EnrollmentsService } from './enrollments.service';
import { MakeupsService } from './makeups.service';
import { ReportsService } from './reports.service';

/** 어드민 웹용 주소. 직원(관리자·일반 직원) 누구나 전체를 보고 상태를 바꾼다 (공통 4) */
@Controller('admin')
@Auth('staff')
export class AdminController {
  constructor(
    private readonly db: DbService,
    private readonly basics: BasicsService,
    private readonly enrollments: EnrollmentsService,
    private readonly attendance: AttendanceService,
    private readonly makeups: MakeupsService,
    private readonly reports: ReportsService,
  ) {}

  // ── 가족·학생 ──
  @Get('families') families() { return this.basics.families(); }
  @Post('families') createFamily(@Body() dto: FamilyDto) { return this.basics.createFamily(dto.name); }

  @Get('students') students() { return this.basics.students(); }
  @Get('students/:id') student(@Param('id', ParseIntPipe) id: number) { return this.basics.student(id); }
  @Post('students') createStudent(@Body() dto: AdminStudentDto) { return this.basics.createStudentByStaff(dto); }
  @Patch('students/:id') updateStudent(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateStudentDto) {
    return this.basics.updateStudent(id, dto);
  }
  @Post('students/:id/contacts') addContact(@Param('id', ParseIntPipe) id: number, @Body() dto: ContactDto) {
    return this.basics.addContact(id, dto);
  }
  @Delete('contacts/:id') removeContact(@Param('id', ParseIntPipe) id: number) { return this.basics.removeContact(id); }

  // ── 강사 ──
  @Get('teachers') teachers() { return this.basics.teachers(); }
  @Post('teachers') createTeacher(@Body() dto: TeacherDto) { return this.basics.createTeacher(dto); }
  @Patch('teachers/:id') updateTeacher(@Param('id', ParseIntPipe) id: number, @Body() dto: TeacherDto) {
    return this.basics.updateTeacher(id, dto);
  }

  // ── 반 ──
  @Get('classes') classes() { return this.basics.classes(); }
  @Get('classes/:id') classDetail(@Param('id', ParseIntPipe) id: number) { return this.basics.classDetail(id); }
  @Post('classes') createClass(@Body() dto: ClassDto) { return this.basics.createClass(dto); }
  @Patch('classes/:id') updateClass(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateClassDto) {
    return this.basics.updateClass(id, dto);
  }

  // ── 수강 ──
  @Post('enrollments') enroll(@Body() dto: EnrollDto) { return this.enrollments.create(dto); }
  @Post('enrollments/:id/end')
  @HttpCode(200)
  endEnrollment(@Param('id', ParseIntPipe) id: number, @Body() dto: EndEnrollmentDto) {
    return this.enrollments.end(id, dto.endDate);
  }

  // ── 출결 ──
  @Get('classes/:id/attendance')
  roster(@Param('id', ParseIntPipe) id: number, @Query('date') date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new RuleError('날짜를 YYYY-MM-DD로 보내 주세요.');
    return this.attendance.roster(id, date);
  }
  @Put('classes/:id/attendance')
  saveAttendance(@Param('id', ParseIntPipe) id: number, @Body() dto: SaveAttendanceDto) {
    return this.attendance.save(id, dto);
  }

  // ── 보강 ──
  @Get('makeups') makeupList(@Query('month') month?: string) { return this.makeups.list(month); }
  @Get('makeups/candidates') makeupCandidates(@Query('month') month?: string) { return this.makeups.candidates(month); }
  @Get('makeups/options/:absenceId') makeupOptions(@Param('absenceId', ParseIntPipe) id: number) {
    return this.makeups.options(id);
  }
  @Post('makeups') createMakeup(@User() me: CurrentUser, @Body() dto: MakeupDto) { return this.makeups.create(dto, me.id); }
  @Delete('makeups/:id') removeMakeup(@Param('id', ParseIntPipe) id: number) { return this.makeups.remove(id); }

  // ── 수강료 ──
  @Get('payments') payments(@Query('month') month?: string) { return this.reports.tuition(month); }
  @Post('payments')
  async pay(@User() me: CurrentUser, @Body() dto: PaymentDto) {
    const { start } = monthRange(dto.month);
    return this.db.one(
      `INSERT INTO tuition_payments (student_id, class_id, billing_month, paid_at, paid_amount, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [dto.studentId, dto.classId, start, dto.paidAt, dto.paidAmount, me.id],
    );
  }
  @Delete('payments/:id')
  async unpay(@Param('id', ParseIntPipe) id: number) {
    const r = await this.db.query('DELETE FROM tuition_payments WHERE id = $1 RETURNING id', [id]);
    if (!r.length) throw new RuleError('납부 기록을 찾을 수 없습니다.');
    return { ok: true };
  }

  // ── 현황 (C1~C3, D5) ──
  @Get('reports/attendance') reportAttendance(@Query('month') month?: string) { return this.reports.attendance(month); }
  @Get('reports/makeup-needed') reportMakeupNeeded(@Query('month') month?: string) { return this.reports.makeupNeeded(month); }
  @Get('reports/unpaid') reportUnpaid(@Query('month') month?: string) { return this.reports.tuition(month, { unpaidOnly: true }); }
  @Get('reports/refunds') reportRefunds(@Query('month') month?: string) { return this.reports.refunds(month); }
}
