export type ApiErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNAUTHORIZED'
  | 'VAULT_LOCKED'
  | 'VAULT_PASSWORD_REQUIRED'
  | 'AUTH_FAILED'
  | 'AUTH_PROMPT_REQUIRED'
  | 'HOST_KEY_UNKNOWN'
  | 'HOST_KEY_MISMATCH'
  | 'SESSION_NOT_CONNECTED'
  | 'CONNECTION_FAILED'
  | 'SFTP_ERROR'
  | 'TUNNEL_ERROR'
  | 'INTERNAL';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details: Record<string, unknown> | null;

  constructor(status: number, code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details ?? null;
  }

  toJSON() {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new ApiError(400, 'VALIDATION', message, details);
export const notFound = (message = 'Resource not found') => new ApiError(404, 'NOT_FOUND', message);
export const conflict = (message: string, details?: Record<string, unknown>) =>
  new ApiError(409, 'CONFLICT', message, details);
export const unauthorized = (message = 'Not authorized') => new ApiError(401, 'UNAUTHORIZED', message);
export const vaultLocked = () =>
  new ApiError(423, 'VAULT_LOCKED', 'The vault is locked. Unlock it to access saved secrets.');
export const internal = (message = 'Internal server error') => new ApiError(500, 'INTERNAL', message);
