import { supabase } from '../src/auth.js';

async function testSupabase() {
  console.log('Testing Supabase connection...');
  try {
    // We can't actually call Supabase without real keys, 
    // but we can check if the client was initialized.
    if (supabase && typeof supabase.auth !== 'undefined') {
      console.log('✅ Supabase client initialized successfully.');
    } else {
      console.error('❌ Supabase client not properly initialized.');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error during Supabase test:', error.message);
    process.exit(1);
  }
}

testSupabase();
