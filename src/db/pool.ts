import { Pool, types } from 'pg';

// date 칸은 'YYYY-MM-DD' 문자열 그대로 받는다 (시간대 때문에 날짜가 하루 밀리는 일 방지)
types.setTypeParser(1082, (v: string) => v);
// bigint(int8)와 count()는 숫자로 받는다 (이 규모에서는 안전)
types.setTypeParser(20, (v: string) => Number(v));
types.setTypeParser(1700, (v: string) => Number(v));

export function createPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL 설정값이 없습니다 (.env 확인)');
  const pool = new Pool({
    connectionString: url,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    max: 5,
    // 모든 연결에서 hw2 스키마를 먼저 본다 (1주차 public 테이블과 섞이지 않게)
    options: '-c search_path=hw2,public',
  });
  return pool;
}
