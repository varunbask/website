import { supabase } from '../src/auth.js';
import { authMiddleware } from '../src/middleware/auth.js';

async function testAuthMiddleware() {
  console.log('Testing auth middleware...');
  
  const mockRes = {
    status: (code) => ({
      json: (data) => {
        console.log(`Response status: ${code}, body: ${JSON.stringify(data)}`);
        return { end: () => {} };
      }
    })
  };
  const next = () => {
    console.log('✅ next() called');
  };

  // Case 1: Missing header
  console.log('Case 1: Missing header');
  const req1 = { headers: {} };
  await authMiddleware(req1, mockRes, next);

  // Case 2: Invalid token
  console.log('\nCase 2: Invalid token');
  const req2 = { headers: { authorization: 'Bearer invalid-token' } };
  await authMiddleware(req2, mockRes, next);

  // Case 3: Valid token
  console.log('\nCase 3: Valid token');
  const req3 = { headers: { authorization: 'Bearer valid-token' } };
  await authMiddleware(req3, mockRes, next);
  if (req3.user && req3.user.id === 'mock-user-id') {
    console.log('✅ User correctly attached to request');
  } else {
    console.error('❌ User not correctly attached to request');
    process.exit(1);
  }
}

testAuthMiddleware();
