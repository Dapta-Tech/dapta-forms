import { describe, it, expect } from 'vitest';
import { normalizeLocale, renderSubmissionReceived, renderSubmissionConfirmed } from './templates';

describe('normalizeLocale', () => {
  it('maps Spanish-ish values to es and everything else to en', () => {
    expect(normalizeLocale('es')).toBe('es');
    expect(normalizeLocale('es-CO')).toBe('es');
    expect(normalizeLocale('ES_es')).toBe('es');
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale('en-US')).toBe('en');
    expect(normalizeLocale('fr')).toBe('en');
    expect(normalizeLocale(undefined)).toBe('en');
    expect(normalizeLocale(null)).toBe('en');
    expect(normalizeLocale('')).toBe('en');
  });
});

describe('renderSubmissionReceived', () => {
  it('renders the English owner notice with interpolated fields', () => {
    const { subject, lines } = renderSubmissionReceived('en', {
      formName: 'Lead Qualifier',
      respondentEmail: 'lead@acme.io',
      score: 15,
      outcomeLabel: 'Qualified',
    });
    expect(subject).toBe('New submission — Lead Qualifier');
    const text = lines.filter(Boolean).join('\n');
    expect(text).toContain('Lead Qualifier');
    expect(text).toContain('From: lead@acme.io');
    expect(text).toContain('Score: 15');
    expect(text).toContain('Outcome: Qualified');
  });

  it('renders the Spanish owner notice', () => {
    const { subject, lines } = renderSubmissionReceived('es', {
      formName: 'Calificador de Leads',
      respondentEmail: 'lead@acme.io',
      score: 15,
      outcomeLabel: 'Calificado',
    });
    expect(subject).toBe('Nueva respuesta — Calificador de Leads');
    const text = lines.filter(Boolean).join('\n');
    expect(text).toContain('Recibiste una nueva respuesta');
    expect(text).toContain('De: lead@acme.io');
    expect(text).toContain('Puntuación: 15');
    expect(text).toContain('Resultado: Calificado');
  });

  it('drops absent optional fields (only the headline line remains)', () => {
    const { lines } = renderSubmissionReceived('en', { formName: 'Survey' });
    expect(lines.filter(Boolean)).toHaveLength(1);
  });
});

describe('renderSubmissionConfirmed', () => {
  it('renders EN and ES respondent confirmations with the form link', () => {
    const en = renderSubmissionConfirmed('en', { formName: 'Survey', formLink: 'https://forms.example.com/x' });
    expect(en.subject).toBe('We got your responses — Survey');
    expect(en.lines.join('\n')).toContain('View or edit: https://forms.example.com/x');

    const es = renderSubmissionConfirmed('es', { formName: 'Encuesta', formLink: 'https://forms.example.com/x' });
    expect(es.subject).toBe('Recibimos tus respuestas — Encuesta');
    expect(es.lines.join('\n')).toContain('Ver o editar: https://forms.example.com/x');
  });
});
