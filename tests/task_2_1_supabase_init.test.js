import { describe, it, expect } from 'vitest';
import { supabase } from '../src/auth.js';

describe('Supabase Initialization', () => {
  it('should have a supabase client initialized', () => {
    expect(supabase).toBeDefined();
    expect(supabase.auth).toBeDefined();
  });
});
