import { supabase } from './supabase';

// See supabase/functions/delete-account for the backend side. That
// function does the actual data/Storage cleanup and deletes the
// auth.users row; signing out here just clears the local session
// immediately so app/_layout.tsx's existing auth-state listener redirects
// to /login right away instead of waiting on the next token refresh.
export async function deleteAccount() {
  const { error } = await supabase.functions.invoke('delete-account');
  if (error) throw error;
  await supabase.auth.signOut();
}
