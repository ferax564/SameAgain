import { DatabaseSync } from 'node:sqlite';
import { AsyncLocalStorage } from 'node:async_hooks';
import { readFileSync, readdirSync } from 'node:fs';
const sql = new DatabaseSync(':memory:');
for (const file of readdirSync('drizzle').filter((p) => p.endsWith('.sql')))
  sql.exec(readFileSync('drizzle/' + file, 'utf8'));
export const context = new AsyncLocalStorage<string>();
class Statement {
  args: any[] = [];
  constructor(public text: string) {}
  bind(...args: any[]) {
    this.args = args;
    return this;
  }
  async all() {
    return {
      results: sql.prepare(this.text).all(...this.args),
      meta: { changes: Number(sql.prepare('SELECT changes() AS n').get()!.n) },
    };
  }
  async run() {
    const r = sql.prepare(this.text).run(...this.args);
    return { meta: { changes: Number(r.changes) } };
  }
}
export const database = {
  prepare: (text: string) => new Statement(text),
  async batch(statements: Statement[]) {
    sql.exec('BEGIN');
    try {
      const out = [];
      for (const s of statements) out.push(await s.run());
      sql.exec('COMMIT');
      return out;
    } catch (e) {
      sql.exec('ROLLBACK');
      throw e;
    }
  },
};
