import { redactSecrets } from '../providers/errors.js';

// Log estruturado em JSON (uma linha por evento), sem segredos.
export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export function createLogger(base: Record<string, unknown> = {}, sink: (line: string) => void = (l) => process.stdout.write(l + '\n')): Logger {
  const write = (level: string, msg: string, fields?: Record<string, unknown>) => {
    const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...base, ...fields });
    sink(redactSecrets(line));
  };
  return {
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
  };
}

export const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };
