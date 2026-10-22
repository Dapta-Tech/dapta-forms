import { describe, expect, it } from 'vitest';
import {
  API_AREAS,
  API_ERROR_CODES,
  API_ISSUE_CODES,
  API_NOT_ALLOWED,
  API_REFERENCE,
  apiAnchor,
  apiCurl,
  apiDisplayPath,
  apiEndpoints,
  type ApiParamDoc,
} from './api-reference';
import { getMessages } from './i18n';

const endpoints = apiEndpoints();

/** Every string anywhere in a value, for the copy checks. */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings);
  return [];
}

describe('the discard-draft example', () => {
  it('moves updatedAt past publishedAt, as a real discard does (it stamps the write)', () => {
    const view = API_REFERENCE['POST /v1/forms/:id/discard-draft']!.response as { updatedAt: number; publishedAt: number };
    expect(view.updatedAt).toBeGreaterThan(view.publishedAt);
  });
});

describe('apiEndpoints', () => {
  it('lists every route once, grouped by area in reading order', () => {
    expect(endpoints).toHaveLength(Object.keys(API_REFERENCE).length);
    const areas = endpoints.map((e) => e.area);
    const firstSeen = [...new Set(areas)];
    expect(firstSeen).toEqual(API_AREAS.filter((a) => areas.includes(a)));
    for (const area of API_AREAS) expect(areas, area).toContain(area);
  });

  it('splits each route into its method and path', () => {
    const put = endpoints.find((e) => e.route === 'PUT /v1/forms/:id')!;
    expect(put.method).toBe('PUT');
    expect(put.path).toBe('/v1/forms/:id');
  });
});

describe('apiAnchor and apiDisplayPath', () => {
  it('gives every endpoint its own anchor', () => {
    const anchors = endpoints.map((e) => apiAnchor(e.route));
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(apiAnchor('GET /v1/forms/:id/submissions.csv')).toBe('get-v1-forms-id-submissions-csv');
    for (const a of anchors) expect(a).toMatch(/^[a-z0-9-]+$/);
  });

  it('shows path parameters in braces', () => {
    expect(apiDisplayPath('/v1/forms/:id/submissions/:submissionId')).toBe('/v1/forms/{id}/submissions/{submissionId}');
  });
});

describe('apiCurl', () => {
  const api = 'https://api.forms.example.com/';

  it('calls the real URL with the key from the environment, never a key itself', () => {
    for (const e of endpoints) {
      const curl = apiCurl(e, api);
      expect(curl, e.route).toContain('https://api.forms.example.com/v1/');
      expect(curl, e.route).toContain('Authorization: Bearer $DFORMS_API_KEY');
      expect(curl, e.route).not.toMatch(/dforms_[A-Za-z0-9]/);
      expect(curl, e.route).not.toContain(':id');
    }
  });

  it('turns path parameters into shell variables and sends the method', () => {
    const curl = apiCurl(endpoints.find((e) => e.route === 'DELETE /v1/folders/:id')!, api);
    expect(curl.split('\n')[0]).toBe('curl -sS -X DELETE "https://api.forms.example.com/v1/folders/$FOLDER_ID" \\');
  });

  it('sends the example body as JSON that parses back to it', () => {
    const e = endpoints.find((x) => x.route === 'POST /v1/forms')!;
    const curl = apiCurl(e, api);
    expect(curl).toContain('-H "Content-Type: application/json"');
    const json = /--data '([\s\S]+)'$/.exec(curl)![1]!;
    expect(JSON.parse(json)).toEqual(e.body);
  });

  it('url-encodes the query examples, quoting JSON safely', () => {
    const curl = apiCurl(endpoints.find((x) => x.route === 'GET /v1/forms/:id/submissions')!, api);
    expect(curl).toContain(' -G "');
    expect(curl).toContain(`--data-urlencode 'answers={"interest":["demo"]}'`);
    expect(curl).toContain('--data-urlencode "status=completed"');
  });

  it('saves the CSV to a file', () => {
    expect(apiCurl(endpoints.find((x) => x.route === 'GET /v1/forms/:id/submissions.csv')!, api)).toContain(
      '-o responses.csv',
    );
  });
});

describe('the docs prose (admin.apiDocs)', () => {
  const used = new Set<ApiParamDoc>(endpoints.flatMap((e) => (e.params ?? []).map((p) => p.doc)));

  for (const locale of ['en', 'es'] as const) {
    const m = getMessages(locale).admin.apiDocs;

    it(`${locale}: has text for every endpoint, parameter, area, code and limit`, () => {
      for (const e of endpoints) expect(m.endpoints[e.route], e.route).toBeTruthy();
      for (const doc of used) expect(m.params[doc], doc).toBeTruthy();
      for (const area of API_AREAS) expect(m.areas[area].title, area).toBeTruthy();
      for (const { code } of API_ERROR_CODES) expect(m.errors.codes[code], code).toBeTruthy();
      for (const code of API_ISSUE_CODES) expect(m.errors.issueCodes[code], code).toBeTruthy();
      for (const item of API_NOT_ALLOWED) expect(m.notAllowed.items[item], item).toBeTruthy();
      expect(m.limits.rate).toContain('{count}');
      expect(m.limits.keys).toContain('{count}');
    });

    it(`${locale}: describes no parameter that no endpoint has`, () => {
      expect(Object.keys(m.params).filter((k) => !used.has(k as ApiParamDoc))).toEqual([]);
    });

    it(`${locale}: carries no em or en dash`, () => {
      for (const s of strings(m)) expect(s).not.toMatch(/—|―|–/);
    });
  }

  it('es: speaks with tú, never vos', () => {
    const es = strings(getMessages('es').admin.apiDocs).join('\n');
    // Letter lookarounds, not \b: \b treats an accented letter as a boundary.
    expect(es).not.toMatch(/(?<!\p{L})(vos|querés|podés|tenés|mandá|usá|elegí|leé|fijate|hacé|corregí)(?!\p{L})/iu);
    expect('Si querés, mandá el form'.match(/(?<!\p{L})(querés|mandá)(?!\p{L})/giu)).toHaveLength(2);
  });

  it('the examples themselves carry no dash and no apostrophe that would break the curl quoting', () => {
    for (const e of endpoints) {
      for (const s of strings([e.body, e.response])) expect(s, e.route).not.toMatch(/—|―|–/);
      expect(JSON.stringify(e.body ?? null), e.route).not.toContain("'");
    }
  });
});
