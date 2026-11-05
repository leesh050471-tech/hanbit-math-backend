import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

/** parent = 학부모, staff = 직원 누구나, admin = 관리자만 */
export type Audience = 'parent' | 'staff' | 'admin';

export const AUTH_KEY = 'auth:audience';
export const ALLOW_PENDING_KEY = 'auth:allowPending';

/** 이 주소는 로그인한 해당 사람만 쓸 수 있다 (붙이지 않으면 누구나) */
export const Auth = (audience: Audience) => SetMetadata(AUTH_KEY, audience);

/** 비밀번호를 바꿔야 하는 직원도 쓸 수 있는 주소 (비밀번호 변경, 내 정보) */
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PENDING_KEY, true);

export interface CurrentUser {
  id: number;
  type: 'parent' | 'staff';
  role?: 'ADMIN' | 'STAFF';
  familyId?: number;
  name: string;
  email: string;
  mustChangePassword?: boolean;
}

export const User = createParamDecorator((_: unknown, ctx: ExecutionContext): CurrentUser => {
  return ctx.switchToHttp().getRequest().user;
});
