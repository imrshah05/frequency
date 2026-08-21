import { useCallback, useEffect, useRef, useState } from 'react';

import {
  dismissSuggestion,
  getSuggestedTuneIns,
  type SuggestedTuneIn,
} from '@/lib/suggestedTuneIns';

/**
 * Loads Suggested Tune-Ins for a user, one page at a time via
 * getSuggestedTuneIns(userId, pageSize, offset) -- the data layer itself is
 * untouched. Works for a small fixed inline row (pass a small pageSize and
 * never call loadMore) or a full infinite-scroll list (pass a larger
 * pageSize and call loadMore as the user scrolls) -- same hook, same
 * underlying call, just how far you page.
 */
export function useSuggestedTuneIns(userId: string, pageSize: number) {
  const [suggestions, setSuggestions] = useState<SuggestedTuneIn[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const offsetRef = useRef(0);

  const load = useCallback(
    async (mode: 'refresh' | 'append') => {
      if (!userId) {
        setSuggestions([]);
        setLoading(false);
        return;
      }

      if (mode === 'refresh') {
        setLoading(true);
        offsetRef.current = 0;
      } else {
        setLoadingMore(true);
      }

      const results = await getSuggestedTuneIns(userId, pageSize, offsetRef.current);
      offsetRef.current += results.length;
      setHasMore(results.length === pageSize);

      setSuggestions((current) => (mode === 'append' ? [...current, ...results] : results));
      setLoading(false);
      setLoadingMore(false);
    },
    [userId, pageSize]
  );

  useEffect(() => {
    load('refresh');
  }, [load]);

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return;
    void load('append');
  }, [load, loading, loadingMore, hasMore]);

  const dismiss = useCallback(
    async (suggestedUserId: string) => {
      if (!userId) return;

      await dismissSuggestion(userId, suggestedUserId);
      setSuggestions((current) => current.filter((suggestion) => suggestion.id !== suggestedUserId));
    },
    [userId]
  );

  // Local-only removal, no dismissed_suggestions write -- used when a
  // suggestion resolves itself (e.g. the user Tuned In), since
  // getSuggestedTuneIns already excludes existing Tune Ins on the next
  // load and this isn't a dismissal.
  const remove = useCallback((suggestedUserId: string) => {
    setSuggestions((current) => current.filter((suggestion) => suggestion.id !== suggestedUserId));
  }, []);

  return {
    suggestions,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    refresh: () => load('refresh'),
    dismiss,
    remove,
  };
}
