import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const dateMsg = { message: '날짜는 YYYY-MM-DD 형식으로 보내 주세요.' };

export class ContactDto {
  @IsString()
  @IsNotEmpty({ message: '관계를 입력해 주세요. (예: 엄마)' })
  relation: string;

  @IsString()
  @IsNotEmpty({ message: '전화번호를 입력해 주세요.' })
  phone: string;
}

export class StudentDto {
  @IsString()
  @IsNotEmpty({ message: '학생 이름을 입력해 주세요.' })
  name: string;

  @Matches(DATE, dateMsg)
  birthDate: string;

  @Type(() => Number)
  @IsInt()
  @Min(7, { message: '학년은 중1~고3만 됩니다.' })
  @Max(12, { message: '학년은 중1~고3만 됩니다.' })
  grade: number;

  @IsString()
  @IsNotEmpty({ message: '학교를 입력해 주세요.' })
  school: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ContactDto)
  contacts?: ContactDto[];
}

export class AdminStudentDto extends StudentDto {
  /** 기존 가족에 넣기 (형제자매 묶기) */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  familyId?: number;

  /** 새 가족 만들기 */
  @IsOptional()
  @IsString()
  newFamilyName?: string;
}

export class UpdateStudentDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @Matches(DATE, dateMsg) birthDate?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(7) @Max(12) grade?: number;
  @IsOptional() @IsString() @IsNotEmpty() school?: string;
  @IsOptional() @Type(() => Number) @IsInt() familyId?: number;
}

export class FamilyDto {
  @IsString()
  @IsNotEmpty({ message: '가족 이름을 입력해 주세요.' })
  name: string;
}

export class TeacherDto {
  @IsString()
  @IsNotEmpty({ message: '강사 이름을 입력해 주세요.' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: '담당 과목을 입력해 주세요.' })
  subject: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  staffId?: number | null;
}

export class ScheduleDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @Matches(TIME, { message: '시각은 HH:MM 형식으로 보내 주세요.' })
  startTime: string;

  @Matches(TIME, { message: '시각은 HH:MM 형식으로 보내 주세요.' })
  endTime: string;
}

export class ClassDto {
  @IsString()
  @IsNotEmpty({ message: '반 이름을 입력해 주세요.' })
  name: string;

  @Type(() => Number)
  @IsInt()
  targetGrade: number;

  @Type(() => Number)
  @IsInt({ message: '담당 강사를 골라 주세요.' })
  teacherId: number;

  @Type(() => Number)
  @IsInt()
  capacity: number = 8;

  @Type(() => Number)
  @IsInt()
  monthlyFee: number;

  @IsArray()
  @ArrayMinSize(1, { message: '수업 요일·시각을 하나 이상 넣어 주세요.' })
  @ValidateNested({ each: true })
  @Type(() => ScheduleDto)
  schedules: ScheduleDto[];
}

export class UpdateClassDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @Type(() => Number) @IsInt() targetGrade?: number;
  @IsOptional() @Type(() => Number) @IsInt() teacherId?: number;
  @IsOptional() @Type(() => Number) @IsInt() capacity?: number;
  @IsOptional() @Type(() => Number) @IsInt() monthlyFee?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1, { message: '수업 요일·시각을 하나 이상 넣어 주세요.' })
  @ValidateNested({ each: true })
  @Type(() => ScheduleDto)
  schedules?: ScheduleDto[];
}

export class EnrollDto {
  @Type(() => Number)
  @IsInt({ message: '학생을 골라 주세요.' })
  studentId: number;

  @Type(() => Number)
  @IsInt({ message: '반을 골라 주세요.' })
  classId: number;

  @Matches(DATE, dateMsg)
  startDate: string;
}

export class EndEnrollmentDto {
  @IsOptional()
  @Matches(DATE, dateMsg)
  endDate?: string;
}

export class AttendanceRecordDto {
  @Type(() => Number)
  @IsInt()
  studentId: number;

  @IsIn(['PRESENT', 'LATE', 'ABSENT'], { message: '출결은 출석, 지각, 결석 중 하나입니다.' })
  status: 'PRESENT' | 'LATE' | 'ABSENT';
}

export class SaveAttendanceDto {
  @Matches(DATE, dateMsg)
  date: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttendanceRecordDto)
  records: AttendanceRecordDto[];
}

export class MakeupDto {
  @Type(() => Number)
  @IsInt({ message: '결석을 골라 주세요.' })
  absenceId: number;

  @Type(() => Number)
  @IsInt({ message: '보강 들어갈 반을 골라 주세요.' })
  targetClassId: number;

  @Matches(DATE, dateMsg)
  makeupDate: string;
}

export class PaymentDto {
  @Type(() => Number)
  @IsInt()
  studentId: number;

  @Type(() => Number)
  @IsInt()
  classId: number;

  @Matches(MONTH, { message: '월은 YYYY-MM 형식으로 보내 주세요.' })
  month: string;

  @Matches(DATE, dateMsg)
  paidAt: string;

  @Type(() => Number)
  @IsInt()
  paidAmount: number;
}
