import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';

/** 비밀번호는 bcrypt 해시로만 저장한다. 해시는 되돌릴 수 없고, 같은 비밀번호도 매번 다른 값이 된다(솔트). */
export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const verifyPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

/** 헷갈리는 글자(0, O, 1, l, I)를 뺀 임시 비밀번호 */
export function makeTempPassword(length = 10): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length }, () => chars[randomInt(chars.length)]).join('');
}
