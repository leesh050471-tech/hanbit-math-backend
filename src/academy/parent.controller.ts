import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { Auth, CurrentUser, User } from '../auth/auth.decorators';
import { BasicsService } from './basics.service';
import { ContactDto, EnrollDto, StudentDto } from './dto';
import { EnrollmentsService } from './enrollments.service';
import { ReportsService } from './reports.service';

/**
 * 코어 웹(학부모)용 주소.
 * 모든 조회·변경은 토큰에서 꺼낸 가족 id로 거른다 → 자기 자녀 것만 (공통 4)
 */
@Controller('me')
@Auth('parent')
export class ParentController {
  constructor(
    private readonly basics: BasicsService,
    private readonly enrollments: EnrollmentsService,
    private readonly reports: ReportsService,
  ) {}

  @Get('students')
  students(@User() me: CurrentUser) {
    return this.basics.students(me.familyId);
  }

  @Get('students/:id')
  student(@User() me: CurrentUser, @Param('id', ParseIntPipe) id: number) {
    return this.basics.student(id, me.familyId);
  }

  @Post('students')
  addStudent(@User() me: CurrentUser, @Body() dto: StudentDto) {
    return this.basics.createStudentForFamily(me.familyId!, dto);
  }

  @Post('students/:id/contacts')
  addContact(@User() me: CurrentUser, @Param('id', ParseIntPipe) id: number, @Body() dto: ContactDto) {
    return this.basics.addContact(id, dto, me.familyId);
  }

  @Delete('contacts/:id')
  removeContact(@User() me: CurrentUser, @Param('id', ParseIntPipe) id: number) {
    return this.basics.removeContact(id, me.familyId);
  }

  /** 신청할 수 있는 반 목록 (운영 중인 반 전체. 학년이 맞는지는 신청할 때 백엔드가 검사) */
  @Get('classes')
  classes() {
    return this.basics.classes({ activeOnly: true });
  }

  @Post('enrollments')
  enroll(@User() me: CurrentUser, @Body() dto: EnrollDto) {
    return this.enrollments.create(dto, { familyId: me.familyId });
  }

  @Post('enrollments/:id/cancel')
  @HttpCode(200)
  cancel(@User() me: CurrentUser, @Param('id', ParseIntPipe) id: number) {
    return this.enrollments.end(id, undefined, { familyId: me.familyId });
  }

  /** D4 학부모용 자녀 요약 */
  @Get('summary')
  summary(@User() me: CurrentUser, @Query('month') month?: string) {
    return this.reports.parentSummary(me.familyId!, month);
  }
}
