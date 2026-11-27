import { describe, expect, it } from 'vitest';
import { deploymentEnvironment, deploymentHost } from './deployment-environment';

describe('deploymentEnvironment', () => {
  it('is prd for a public host with no non-production label', () => {
    expect(deploymentEnvironment('https://app.example.com')).toBe('prd');
    expect(deploymentEnvironment('https://forms.example.com/')).toBe('prd');
    expect(deploymentEnvironment('https://staging-forms.example.com')).toBe('prd');
    expect(deploymentEnvironment('https://devtools.example.com')).toBe('prd');
  });

  it('is dev when any label of the host is a non-production marker', () => {
    expect(deploymentEnvironment('https://app.dev.example.com')).toBe('dev');
    expect(deploymentEnvironment('https://forms.example.dev')).toBe('dev');
    expect(deploymentEnvironment('https://staging.example.com')).toBe('dev');
    expect(deploymentEnvironment('https://forms.qa.example.com')).toBe('dev');
    expect(deploymentEnvironment('https://APP.DEV.EXAMPLE.COM')).toBe('dev');
  });

  it('is local with no public URL, a loopback host or a reserved name', () => {
    expect(deploymentEnvironment('')).toBe('local');
    expect(deploymentEnvironment('   ')).toBe('local');
    expect(deploymentEnvironment(undefined)).toBe('local');
    expect(deploymentEnvironment(null)).toBe('local');
    expect(deploymentEnvironment('http://localhost:3400')).toBe('local');
    expect(deploymentEnvironment('http://forms.localhost:3000')).toBe('local');
    expect(deploymentEnvironment('http://127.0.0.1:3000')).toBe('local');
    expect(deploymentEnvironment('http://[::1]:3000')).toBe('local');
    expect(deploymentEnvironment('http://forms.test')).toBe('local');
    expect(deploymentEnvironment('http://10.0.0.5:3000')).toBe('local');
  });

  it('is local for a value that is not an http(s) URL', () => {
    expect(deploymentEnvironment('not a url')).toBe('local');
    expect(deploymentEnvironment('ftp://files.example.com')).toBe('local');
  });
});

describe('deploymentHost', () => {
  it('returns the lowercased hostname, without port or path', () => {
    expect(deploymentHost('https://App.Example.com:8443/admin')).toBe('app.example.com');
  });

  it('returns null with nothing usable', () => {
    expect(deploymentHost('')).toBeNull();
    expect(deploymentHost(undefined)).toBeNull();
    expect(deploymentHost('nope')).toBeNull();
  });
});
