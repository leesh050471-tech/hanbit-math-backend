import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { DbService } from '../db/db.service';
import { ALLOW_PENDING_KEY, AUTH_KEY, Audience, CurrentUser } from './auth.decorators';

export interface TokenPayload {
  sub: number;
  type: 'parent' | 'staff';
}

/**
 * 모든 요청에서 실행된다.
 * 1) 토큰이 있는지, 위조되지 않았는지 확인
 * 2) 토큰의 type으로 학부모/직원을 구분
 * 3) 직원이면 DB에서 지금 상태(사용 중지, 역할, 비밀번호 변경 필요)를 다시 읽는다
 *    → 관리자가 계정을 멈추면 이미 받은 토큰도 바로 막힌다
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly db: DbService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const audience = this.reflector.getAllAndOverride<Audience | undefined>(AUTH_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!audience) return true; // 공개 주소

    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('로그인이 필요합니다.');

    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token);
    } catch {
      throw new UnauthorizedException('로그인이 만료됐습니다. 다시 로그인해 주세요.');
    }

    let user: CurrentUser;
    if (payload.type === 'parent') {
      const p = await this.db.one('SELECT id, family_id, name, email FROM parents WHERE id = $1', [payload.sub]);
      if (!p) throw new UnauthorizedException('계정을 찾을 수 없습니다.');
      user = { id: p.id, type: 'parent', familyId: p.family_id, name: p.name, email: p.email };
    } else {
      const s = await this.db.one(
        'SELECT id, name, email, role, is_active, must_change_password FROM staff WHERE id = $1',
        [payload.sub],
      );
      if (!s) throw new UnauthorizedException('계정을 찾을 수 없습니다.');
      if (!s.is_active) throw new UnauthorizedException('사용이 중지된 계정입니다. 관리자에게 문의하세요.');
      user = {
        id: s.id,
        type: 'staff',
        role: s.role,
        name: s.name,
        email: s.email,
        mustChangePassword: s.must_change_password,
      };
    }
    req.user = user;

    // 누가 쓸 수 있는 주소인가
    if (audience === 'parent' && user.type !== 'parent') throw new ForbiddenException('학부모만 쓸 수 있습니다.');
    if (audience !== 'parent' && user.type !== 'staff') throw new ForbiddenException('직원만 쓸 수 있습니다.');
    if (audience === 'admin' && user.role !== 'ADMIN') throw new ForbiddenException('관리자만 할 수 있습니다.');

    const allowPending = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (user.mustChangePassword && !allowPending) {
      throw new ForbiddenException('임시 비밀번호로 로그인했습니다. 먼저 새 비밀번호로 바꿔 주세요.');
    }
    return true;
  }
}
