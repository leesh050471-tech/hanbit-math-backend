import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RuleError } from '../common/errors';
import { DbService } from '../db/db.service';
import { CurrentUser } from './auth.decorators';
import { TokenPayload } from './auth.guard';
import { ChangePasswordDto, LoginDto, ParentSignupDto } from './auth.dto';
import { hashPassword, verifyPassword } from './password';

const LOGIN_FAIL = '이메일 또는 비밀번호가 맞지 않습니다.';

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly jwt: JwtService,
  ) {}

  private sign(payload: TokenPayload) {
    return this.jwt.signAsync(payload);
  }

  /** 학부모 회원가입: 가족을 하나 만들고 그 가족의 계정으로 등록 */
  async parentSignup(dto: ParentSignupDto) {
    const email = dto.email.trim().toLowerCase();
    const exists = await this.db.one('SELECT 1 FROM parents WHERE email = $1', [email]);
    if (exists) throw new RuleError('이미 가입된 이메일입니다.');

    const hash = await hashPassword(dto.password);
    const parent = await this.db.tx(async (c) => {
      const fam = await c.query('INSERT INTO families (name) VALUES ($1) RETURNING id', [`${dto.name} 가족`]);
      const p = await c.query(
        `INSERT INTO parents (family_id, email, password_hash, name, phone)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, family_id`,
        [fam.rows[0].id, email, hash, dto.name.trim(), dto.phone.trim()],
      );
      return p.rows[0];
    });
    return {
      token: await this.sign({ sub: parent.id, type: 'parent' }),
      user: { id: parent.id, type: 'parent', name: parent.name, email: parent.email },
    };
  }

  async parentLogin(dto: LoginDto) {
    const p = await this.db.one('SELECT id, name, email, password_hash FROM parents WHERE email = $1', [
      dto.email.trim().toLowerCase(),
    ]);
    if (!p || !(await verifyPassword(dto.password, p.password_hash))) throw new UnauthorizedException(LOGIN_FAIL);
    return {
      token: await this.sign({ sub: p.id, type: 'parent' }),
      user: { id: p.id, type: 'parent', name: p.name, email: p.email },
    };
  }

  async staffLogin(dto: LoginDto) {
    const s = await this.db.one(
      'SELECT id, name, email, role, is_active, must_change_password, password_hash FROM staff WHERE email = $1',
      [dto.email.trim().toLowerCase()],
    );
    if (!s || !(await verifyPassword(dto.password, s.password_hash))) throw new UnauthorizedException(LOGIN_FAIL);
    if (!s.is_active) throw new UnauthorizedException('사용이 중지된 계정입니다. 관리자에게 문의하세요.');
    return {
      token: await this.sign({ sub: s.id, type: 'staff' }),
      user: {
        id: s.id,
        type: 'staff',
        name: s.name,
        email: s.email,
        role: s.role,
        mustChangePassword: s.must_change_password,
      },
    };
  }

  /** 직원 비밀번호 변경 (임시 비밀번호 → 새 비밀번호 포함) */
  async staffChangePassword(user: CurrentUser, dto: ChangePasswordDto) {
    const s = await this.db.one('SELECT password_hash FROM staff WHERE id = $1', [user.id]);
    if (!s || !(await verifyPassword(dto.currentPassword, s.password_hash))) {
      throw new RuleError('지금 비밀번호가 맞지 않습니다.');
    }
    if (dto.currentPassword === dto.newPassword) throw new RuleError('새 비밀번호는 지금 비밀번호와 달라야 합니다.');
    await this.db.query(
      'UPDATE staff SET password_hash = $1, must_change_password = false, updated_at = now() WHERE id = $2',
      [await hashPassword(dto.newPassword), user.id],
    );
    return { ok: true };
  }
}
