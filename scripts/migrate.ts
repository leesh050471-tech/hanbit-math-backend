/**
 * hw2 스키마 만들기.
 *   npm run db:migrate          → 없는 테이블만 만든다
 *   npm run db:reset            → hw2 스키마만 통째로 지우고 다시 만든다 (1주차 테이블은 건드리지 않음)
 */
import 'dotenv/config';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { createPool } from '../src/db/pool';

async function main() {
  const pool = createPool();
  const reset = process.argv.includes('--reset');
  try {
    if (reset) {
      console.log('hw2 스키마를 지우고 다시 만듭니다...');
      await pool.query('DROP SCHEMA IF EXISTS hw2 CASCADE');
    }
    const dir = join(__dirname, '..', 'sql');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      console.log(`실행: ${file}`);
      await pool.query(readFileSync(join(dir, file), 'utf8'));
    }
    const tables = await pool.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'hw2' ORDER BY 1`,
    );
    console.log(`hw2 테이블 ${tables.rowCount}개: ${tables.rows.map((r) => r.table_name).join(', ')}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('실패:', e.message);
  process.exit(1);
});
