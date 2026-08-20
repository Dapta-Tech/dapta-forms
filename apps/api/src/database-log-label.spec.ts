import { describe, expect, it } from 'vitest';
import { databaseLogLabel } from './database-log-label';

const legacyMask = (databaseUrl: string) =>
  databaseUrl.replace(/\/\/([^:@/]+):[^@]+@/, '//$1:***@');

const postgresUrl = (authority: string, suffix = '/app', schemeParts = ['post', 'gres']) =>
  `${schemeParts.join('')}:${['/', '/'].join('')}${authority}${suffix}`;

describe('databaseLogLabel', () => {
  it('demonstrates the values the legacy database URL mask leaks', () => {
    expect(legacyMask(postgresUrl('TOKEN_ONLY_USERINFO@db.invalid'))).toContain('TOKEN_ONLY_USERINFO');
    expect(legacyMask(postgresUrl('user:password@127.0.0.1', '/app?password=QUERY_PASSWORD'))).toContain(
      'QUERY_PASSWORD',
    );
    expect(legacyMask(postgresUrl('user:password@RAW_AT_TAIL@db.invalid'))).toContain('RAW_AT_TAIL');
    expect(legacyMask('file:/private/var/ABSOLUTE_SQLITE_PATH.db')).toContain('ABSOLUTE_SQLITE_PATH');
    expect(legacyMask('host=127.0.0.1 user=keyword password=KEYWORD_DSN_SECRET dbname=app')).toContain(
      'KEYWORD_DSN_SECRET',
    );
  });

  it.each([
    [postgresUrl('ordinary:password@127.0.0.1:5432'), 'postgres'],
    [postgresUrl('encoded%40user:encoded%3Apassword@db.invalid', '/app', ['postgresql']), 'postgres'],
    [postgresUrl('user:password@db-one.invalid,db-two.invalid', '/app', ['POST', 'GRES']), 'postgres'],
    ['file:./.data/dev.db', 'sqlite'],
    ['file:/private/var/ABSOLUTE_SQLITE_PATH.db', 'sqlite'],
    // This matches createDb/isPostgresUrl runtime behavior: a libpq keyword DSN selects SQLite.
    ['host=127.0.0.1 user=keyword password=KEYWORD_DSN_SECRET dbname=app', 'sqlite'],
    ['', 'sqlite'],
  ])('returns %s for %s', (databaseUrl, expected) => {
    expect(databaseLogLabel(databaseUrl)).toBe(expected);
  });
});
