import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import '../server/db.ts';
test('PostgreSQL DATE stays a YYYY-MM-DD civil date without a local-time UTC shift',()=>{assert.equal(pg.types.getTypeParser(1082)('2026-09-01'),'2026-09-01');});
