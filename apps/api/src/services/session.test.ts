import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isAllowedEmail,
  signSession,
  verifySession,
} from './session.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.JWT_SECRET = 'a-very-long-test-secret-string';
  process.env.AUTH_ALLOWED_EMAIL = 'diane@onemoregame.com';
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('signSession / verifySession', () => {
  it('round-trips an email through the signed session', () => {
    const token = signSession('diane@onemoregame.com');
    const session = verifySession(token);
    expect(session.email).toBe('diane@onemoregame.com');
    expect(typeof session.iat).toBe('number');
    expect(typeof session.exp).toBe('number');
    expect(session.exp! - session.iat!).toBe(24 * 60 * 60);
  });

  it('rejects a tampered token', () => {
    const token = signSession('diane@onemoregame.com');
    const tampered = token.slice(0, -2) + 'xx';
    expect(() => verifySession(tampered)).toThrow();
  });

  it('rejects a token signed with a different secret', () => {
    const token = signSession('diane@onemoregame.com');
    process.env.JWT_SECRET = 'a-different-secret-also-long';
    expect(() => verifySession(token)).toThrow();
  });

  it('requires JWT_SECRET to be at least 16 chars', () => {
    process.env.JWT_SECRET = 'short';
    expect(() => signSession('x@y.z')).toThrow(/JWT_SECRET/);
  });

  it('requires JWT_SECRET to be set at all', () => {
    delete process.env.JWT_SECRET;
    expect(() => signSession('x@y.z')).toThrow(/JWT_SECRET/);
  });
});

describe('isAllowedEmail', () => {
  it('matches the only allowlisted email', () => {
    expect(isAllowedEmail('diane@onemoregame.com')).toBe(true);
  });

  it('is case-insensitive on both sides', () => {
    process.env.AUTH_ALLOWED_EMAIL = 'Diane@OneMoreGame.com';
    expect(isAllowedEmail('diane@onemoregame.com')).toBe(true);
    expect(isAllowedEmail('DIANE@ONEMOREGAME.COM')).toBe(true);
  });

  it('supports comma-separated multi-allowlist', () => {
    process.env.AUTH_ALLOWED_EMAIL = 'diane@onemoregame.com, hire@me.io';
    expect(isAllowedEmail('diane@onemoregame.com')).toBe(true);
    expect(isAllowedEmail('hire@me.io')).toBe(true);
    expect(isAllowedEmail('stranger@example.com')).toBe(false);
  });

  it('rejects anyone if the allowlist is empty / unset', () => {
    delete process.env.AUTH_ALLOWED_EMAIL;
    expect(isAllowedEmail('diane@onemoregame.com')).toBe(false);
    process.env.AUTH_ALLOWED_EMAIL = '   ';
    expect(isAllowedEmail('diane@onemoregame.com')).toBe(false);
  });
});
