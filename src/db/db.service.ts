import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { createPool } from './pool';

export type Queryable = Pick<PoolClient, 'query'>;

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool: Pool = createPool();

  async query<T extends QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query<T>(sql, params);
    return res.rows;
  }

  async one<T extends QueryResultRow = any>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    const rows = await this.query<T>(sql, params);
    return rows[0];
  }

  /** 트랜잭션: fn 안에서 오류가 나면 전부 되돌린다 */
  async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL search_path TO hw2, public');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
