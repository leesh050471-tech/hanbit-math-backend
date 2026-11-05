import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsEmail, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { Auth, CurrentUser, User } from '../auth/auth.decorators';
import { hashPassword, makeTempPassword } from '../auth/password';
import { RuleError } from '../common/errors';
import { DbService } from '../db/db.service';

class CreateStaffDto {
  @IsEmail({}, { message: '이메일 형식이 올바르지 않습니다.' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: '이름을 입력해 주세요.' })
  name: string;

  @IsIn(['ADMIN', 'STAFF'], { message: '역할은 관리자 또는 일반 직원 중 하나입니다.' })
  role: 'ADMIN' | 'STAFF';
}

class UpdateStaffDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: '이름을 입력해 주세요.' })
  name?: string;

  @IsOptional()
  @IsIn(['ADMIN', 'STAFF'], { message: '역할은 관리자 또는 일반 직원 중 하나입니다.' })
  role?: 'ADMIN' | 'STAFF';

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

const STAFF_COLUMNS = `id, email, name, role, is_active AS "isActive",
  must_change_password AS "mustChangePassword", created_at AS "createdAt"`;

/** 직원 계정 관리: 관리자만 (공통 요구사항 5~8) */
@Controller('admin/staff')
@Auth('admin')
export class StaffController {
  constructor(private readonly db: DbService) {}

  @Get()
  list() {
    return this.db.query(`SELECT ${STAFF_COLUMNS} FROM staff ORDER BY role, id`);
  }

  /** 새 직원 계정: 임시 비밀번호를 만들어 한 번만 보여 준다. 첫 로그인 때 바꿔야 한다. */
  @Post()
  async create(@Body() dto: CreateStaffDto) {
    const temp = makeTempPassword();
    const row = await this.db.one(
      `INSERT INTO staff (email, password_hash, name, role, must_change_password)
       VALUES ($1, $2, $3, $4, true) RETURNING ${STAFF_COLUMNS}`,
      [dto.email.trim().toLowerCase(), await hashPassword(temp), dto.name.trim(), dto.role],
    );
    return { staff: row, tempPassword: temp };
  }

  @Patch(':id')
  async update(@User() me: CurrentUser, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateStaffDto) {
    if (id === me.id && (dto.isActive === false || dto.role === 'STAFF')) {
      throw new RuleError('내 계정의 사용을 멈추거나 관리자 역할을 뺄 수 없습니다.');
    }
    const row = await this.db.one(
      `UPDATE staff SET
         name = COALESCE($2, name),
         role = COALESCE($3, role),
         is_active = COALESCE($4, is_active),
         updated_at = now()
       WHERE id = $1 RETURNING ${STAFF_COLUMNS}`,
      [id, dto.name?.trim() ?? null, dto.role ?? null, dto.isActive ?? null],
    );
    if (!row) throw new RuleError('직원을 찾을 수 없습니다.');
    return row;
  }

  /** 비밀번호 리셋: 임시 비밀번호 발급 + 다음 로그인 때 변경 강제 */
  @Post(':id/reset-password')
  @HttpCode(200)
  async resetPassword(@Param('id', ParseIntPipe) id: number) {
    const temp = makeTempPassword();
    const row = await this.db.one(
      `UPDATE staff SET password_hash = $2, must_change_password = true, updated_at = now()
       WHERE id = $1 RETURNING ${STAFF_COLUMNS}`,
      [id, await hashPassword(temp)],
    );
    if (!row) throw new RuleError('직원을 찾을 수 없습니다.');
    return { staff: row, tempPassword: temp };
  }
}
