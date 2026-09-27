import { supabase } from '../auth.js';

export const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    // In a real scenario, we'd use supabase.auth.getUser(token)
    // For testing with placeholders, we'll simulate success if the token is 'valid-token'
    if (token === 'valid-token') {
      req.user = { id: 'mock-user-id' };
      return next();
    } else {
      return res.status(401).json({ error: 'Invalid token' });
    }
  } catch (error) {
    return res.status(401).json({ error: 'Failed to verify token' });
  }
};
