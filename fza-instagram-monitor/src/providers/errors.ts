// Erros padronizados de coleta. Todo adaptador converte as falhas da fonte para um destes códigos.

export type ErrorCode =
  | 'PROFILE_NOT_FOUND_OR_PERSONAL'
  | 'PROFILE_PRIVATE_OR_UNAVAILABLE'
  | 'SOURCE_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'PROVIDER_AUTH_FAILED'
  | 'UNSUPPORTED_FIELD'
  | 'INVALID_RESPONSE'
  | 'TIMEOUT'
  | 'PERSISTENCE_ERROR'
  | 'NOT_CONFIGURED'
  | 'PERMANENT_FAILURE';

export interface ErrorInfo {
  label: string;
  // Transitório: vale tentar de novo com backoff.
  retryable: boolean;
  // De quem é o problema: do perfil monitorado ou do coletor/fonte.
  category: 'profile' | 'collector';
}

export const ERROR_INFO: Record<ErrorCode, ErrorInfo> = {
  PROFILE_NOT_FOUND_OR_PERSONAL: {
    label: 'Perfil não encontrado ou não é conta profissional (Business/Creator)',
    retryable: false,
    category: 'profile',
  },
  PROFILE_PRIVATE_OR_UNAVAILABLE: {
    label: 'Perfil privado, com restrição de idade ou indisponível',
    retryable: false,
    category: 'profile',
  },
  SOURCE_UNAVAILABLE: { label: 'Fonte temporariamente indisponível', retryable: true, category: 'collector' },
  RATE_LIMITED: { label: 'Limite de requisições atingido', retryable: true, category: 'collector' },
  PROVIDER_AUTH_FAILED: { label: 'Falha de autenticação na fonte (token)', retryable: false, category: 'collector' },
  UNSUPPORTED_FIELD: { label: 'Campo ou métrica não suportada pela fonte', retryable: false, category: 'collector' },
  INVALID_RESPONSE: { label: 'Resposta inválida da fonte', retryable: true, category: 'collector' },
  TIMEOUT: { label: 'Tempo limite excedido', retryable: true, category: 'collector' },
  PERSISTENCE_ERROR: { label: 'Erro ao gravar no banco', retryable: true, category: 'collector' },
  NOT_CONFIGURED: { label: 'Fonte de dados não configurada', retryable: false, category: 'collector' },
  PERMANENT_FAILURE: { label: 'Falha permanente', retryable: false, category: 'collector' },
};

export class CollectionError extends Error {
  readonly code: ErrorCode;
  readonly retryAfterMs: number | null;
  readonly detail: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, opts: { retryAfterMs?: number | null; detail?: Record<string, unknown> } = {}) {
    super(message);
    this.name = 'CollectionError';
    this.code = code;
    this.retryAfterMs = opts.retryAfterMs ?? null;
    this.detail = opts.detail ?? {};
  }

  get retryable(): boolean {
    return ERROR_INFO[this.code].retryable;
  }

  get category(): 'profile' | 'collector' {
    return ERROR_INFO[this.code].category;
  }
}

export function toCollectionError(err: unknown): CollectionError {
  if (err instanceof CollectionError) return err;
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
    return new CollectionError('TIMEOUT', 'A fonte não respondeu dentro do tempo limite.');
  }
  return new CollectionError('PERMANENT_FAILURE', 'Erro inesperado no coletor.', {
    detail: { error: err instanceof Error ? err.message : String(err) },
  });
}

// Remove tokens de qualquer texto antes de logar ou gravar.
export function redactSecrets(text: string): string {
  return text
    .replace(/access_token=[^&\s"']+/gi, 'access_token=[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, 'Bearer [REDACTED]')
    .replace(/\bEA[A-Za-z0-9]{20,}\b/g, '[REDACTED]')
    .replace(/\bIG[A-Za-z0-9]{20,}\b/g, '[REDACTED]');
}
