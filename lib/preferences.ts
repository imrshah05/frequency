import { supabase } from './supabase';

/**
 * A single boolean column on profiles, no separate preferences table.
 */
export async function fetchFeedSuggestionsEnabled(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('profiles')
    .select('feed_suggestions_enabled')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    if (__DEV__) {
      console.warn('[preferences] Failed to read feed_suggestions_enabled.', error.message);
    }

    return true;
  }

  return data?.feed_suggestions_enabled ?? true;
}

export async function setFeedSuggestionsEnabled(userId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ feed_suggestions_enabled: enabled })
    .eq('id', userId);

  if (error) throw error;
}
