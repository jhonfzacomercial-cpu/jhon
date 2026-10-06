// Substitui server/db.js no navegador: mesmos auxiliares, sem node:sqlite.
export const DATA_DIR = '';
export const UPLOAD_DIR = '';
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
export function openDb() { throw new Error('openDb indisponível no navegador'); }
