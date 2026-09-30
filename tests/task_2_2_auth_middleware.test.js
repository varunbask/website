import { describe, it, expect, vi } from 'vitest';
import { authMiddleware } from '../src/middleware/auth.js';
import { supabase } from '../src/auth.js';

vi.mock('../src/auth.js', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
  },
}));

describe('Auth Middleware', () => {
  const mockRes = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next = vi.fn();

  it('should return 401 if no authorization header is present', async () => {
    const req = { headers: {} };
    await authMiddleware(req, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Missing or invalid authorization header' }));
    expect(next).not.toHaveBeenCalled();
  });

  it('should return 401 if token is invalid', async () => {
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: null }, error: { message: 'Invalid' } });
    const req = { headers: { authorization: 'Bearer invalid-token' } };
    await authMiddleware(req, mockRes, next);
    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Invalid token' }));
  });

  it('should call next() and attach user if token is valid', async () => {
    const user = { id: 'user-123', role: 'student' };
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user }, error: null });
    const req = { headers: { authorization: 'Bearer valid-token' } };
    await authMiddleware(req, mockRes, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual(user);
  });
});
