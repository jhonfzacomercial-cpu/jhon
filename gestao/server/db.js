import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { SCHEMA } from './schema.js';

export const DATA_DIR = process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');



export function openDb(file = path.join(DATA_DIR, 'gestao.db')) {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

/** Converte rows "null prototype" do node:sqlite em objetos comuns. */
export const plain = (row) => (row ? { ...row } : row);
export const plainAll = (rows) => rows.map((r) => ({ ...r }));

export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
