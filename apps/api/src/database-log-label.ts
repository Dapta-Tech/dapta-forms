import { isPostgresUrl } from '@quill/config/env';

export function databaseLogLabel(databaseUrl: string): 'postgres' | 'sqlite' {
  return isPostgresUrl(databaseUrl) ? 'postgres' : 'sqlite';
}
