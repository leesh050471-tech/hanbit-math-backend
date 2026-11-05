import { RuleError } from './errors';

/** 한국 시간 기준 오늘 'YYYY-MM-DD' */
export function todayKST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

export function currentMonthKST(): string {
  return todayKST().slice(0, 7);
}

/** 'YYYY-MM' → { start: 'YYYY-MM-01', end: 다음 달 1일 } */
export function monthRange(month?: string): { month: string; start: string; end: string } {
  const m = month ?? currentMonthKST();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new RuleError('월은 YYYY-MM 형식으로 보내 주세요.');
  const [y, mo] = m.split('-').map(Number);
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  return { month: m, start: `${m}-01`, end: `${next}-01` };
}

/** 'YYYY-MM-DD'의 요일 (0=일 ... 6=토) */
export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 그 달의 모든 날짜 목록 */
export function datesInMonth(month: string): string[] {
  const [y, m] = month.split('-').map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

export const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
export const GRADE_NAMES: Record<number, string> = { 7: '중1', 8: '중2', 9: '중3', 10: '고1', 11: '고2', 12: '고3' };
