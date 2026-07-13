import { HttpException } from '@nestjs/common';

export interface ServiceError {
  error: string;
  message: string;
  status: number;
}

export function isServiceError(v: unknown): v is ServiceError {
  return !!v && typeof v === 'object' && 'error' in v && 'status' in v;
}

/** Throw the mapped HttpException for a ServiceError; otherwise return the value. */
export function unwrap<T>(v: T | ServiceError): T {
  if (isServiceError(v)) {
    throw new HttpException({ error: v.error, message: v.message }, v.status);
  }
  return v;
}
