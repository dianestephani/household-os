import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireToken } from './auth.js';
import { signSession } from '../services/session.js';

const ORIGINAL_ENV = { ...process.env };

function makeReq(authHeader?: string): Request {
  return { headers: authHeader ? { authorization: authHeader } : {} } as Request;
}

function makeRes() {
  const res: Partial<Response> = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

beforeEach(() => {
  process.env.JWT_SECRET = 'a-very-long-test-secret-string';
  delete process.env.API_TOKEN;
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('requireToken middleware', () => {
  it('allows through when neither API_TOKEN nor GOOGLE_OAUTH_CLIENT_ID is configured', () => {
    const next = vi.fn() as unknown as NextFunction;
    const res = makeRes();
    requireToken(makeReq(), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('accepts the legacy API_TOKEN bearer', () => {
    process.env.API_TOKEN = 'legacy-token';
    const next = vi.fn() as unknown as NextFunction;
    const res = makeRes();
    requireToken(makeReq('Bearer legacy-token'), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects the wrong API_TOKEN', () => {
    process.env.API_TOKEN = 'legacy-token';
    const next = vi.fn() as unknown as NextFunction;
    const res = makeRes();
    requireToken(makeReq('Bearer not-the-token'), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('accepts a valid session JWT when Google auth is configured', () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'fake-client-id';
    const token = signSession('diane@onemoregame.com');
    const next = vi.fn() as unknown as NextFunction;
    const res = makeRes();
    requireToken(makeReq(`Bearer ${token}`), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a malformed session JWT', () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'fake-client-id';
    const next = vi.fn() as unknown as NextFunction;
    const res = makeRes();
    requireToken(makeReq('Bearer not-a-jwt'), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('accepts EITHER API_TOKEN or a valid JWT when both are configured', () => {
    process.env.API_TOKEN = 'legacy-token';
    process.env.GOOGLE_OAUTH_CLIENT_ID = 'fake-client-id';
    const token = signSession('diane@onemoregame.com');

    const nextA = vi.fn() as unknown as NextFunction;
    requireToken(makeReq('Bearer legacy-token'), makeRes(), nextA);
    expect(nextA).toHaveBeenCalledTimes(1);

    const nextB = vi.fn() as unknown as NextFunction;
    requireToken(makeReq(`Bearer ${token}`), makeRes(), nextB);
    expect(nextB).toHaveBeenCalledTimes(1);
  });

  it('rejects a missing Authorization header', () => {
    process.env.API_TOKEN = 'legacy-token';
    const next = vi.fn() as unknown as NextFunction;
    const res = makeRes();
    requireToken(makeReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
