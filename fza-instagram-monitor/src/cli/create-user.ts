// Cria (ou redefine a senha de) um usuário interno.
// Uso: npm run user:create -- --email voce@grupofza.com.br --name "Seu Nome" --role admin
// A senha é lida da variável FZA_NEW_PASSWORD ou digitada no terminal (não aparece no histórico).
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { getPool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';
import { hashPassword, validatePasswordStrength } from '../server/auth.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'admin' },
  },
});
if (!values.email || !values.name || !['admin', 'analyst', 'viewer'].includes(values.role!)) {
  console.error('Uso: npm run user:create -- --email <e-mail> --name "<nome>" [--role admin|analyst|viewer]');
  process.exit(1);
}

let password = process.env.FZA_NEW_PASSWORD;
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question('Senha (mín. 12 caracteres, letras e números): ');
  rl.close();
}
const weak = validatePasswordStrength(password);
if (weak) {
  console.error(weak);
  process.exit(1);
}

const db = getPool();
await migrate(db);
await db.query(
  `INSERT INTO users (email, name, role, password_hash) VALUES (lower($1), $2, $3, $4)
   ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role,
     password_hash = EXCLUDED.password_hash, status = 'active', failed_login_count = 0, locked_until = NULL, updated_at = now()`,
  [values.email, values.name, values.role, await hashPassword(password)],
);
console.log(`Usuário ${values.email} (${values.role}) pronto.`);
await db.end();
