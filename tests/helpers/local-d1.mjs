import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
export class LocalD1 {
  constructor(path = ':memory:') { this.raw = new DatabaseSync(path); this.raw.exec('PRAGMA foreign_keys=ON'); }
  prepare(sql) {
    const db = this.raw;
    return { bind(...args) { return {
      async first() { return db.prepare(sql).get(...args) || null; },
      async all() { return { results: db.prepare(sql).all(...args) }; },
      async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    }; } };
  }
  async batch(stmts) {
    this.raw.exec('BEGIN IMMEDIATE');
    try { const result = []; for (const s of stmts) result.push(await s.run()); this.raw.exec('COMMIT'); return result; }
    catch (e) { this.raw.exec('ROLLBACK'); throw e; }
  }
  migrate() { for (const f of readdirSync(new URL('../../drizzle', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) this.raw.exec(readFileSync(new URL('../../drizzle/' + f, import.meta.url), 'utf8')); }
}
