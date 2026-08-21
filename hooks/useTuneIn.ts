import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { error as hapticError, light } from "../lib/haptics";
import { requestTuneIn, withdrawTuneIn } from "../lib/tuneIns";

type TuneInStatus = "none" | "pending" | "accepted" | "declined";

export function useTuneIn(ownerId: string) {
  const [tunedInCount, setTunedInCount] = useState(0);
  const [listeningCount, setListeningCount] = useState(0);
  const [tuneInStatus, setTuneInStatus] = useState<TuneInStatus>("none");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const channelIdRef = useRef(`${Date.now()}-${Math.random().toString(36).slice(2)}`);

  const refresh = useCallback(async () => {
    if (!ownerId) {
      setTunedInCount(0);
      setListeningCount(0);
      setTuneInStatus("none");
      return;
    }

    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) return;

    const me = userData.user.id;

    // people tuned into this user
    const { count: followers } = await supabase
      .from("tune_ins")
      .select("*", { count: "exact", head: true })
      .eq("frequency_owner_id", ownerId)
      .eq("status", "accepted");

    // people this user listens to
    const { count: following } = await supabase
      .from("tune_ins")
      .select("*", { count: "exact", head: true })
      .eq("listener_id", ownerId)
      .eq("status", "accepted");

    // am I tuned into this frequency?
    const { data } = await supabase
      .from("tune_ins")
      .select("status")
      .eq("listener_id", me)
      .eq("frequency_owner_id", ownerId)
      .order("created_at", { ascending: false })
      .limit(1);

    setTunedInCount(followers ?? 0);
    setListeningCount(following ?? 0);
    setTuneInStatus((data?.[0]?.status as TuneInStatus | undefined) ?? "none");
  }, [ownerId]);

  async function toggleTuneIn() {
    if (isSubmitting || tuneInStatus === "accepted") return;

    const { data: userData } = await supabase.auth.getUser();

    if (!userData.user) return;

    const me = userData.user.id;
    if (me === ownerId) return;

    if (tuneInStatus === "pending") {
      setIsSubmitting(true);
      try {
        await withdrawTuneIn(ownerId);
      } catch {
        setIsSubmitting(false);
        void hapticError();
        return;
      }

      setTuneInStatus("none");
      void light();

      await refresh();
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await requestTuneIn(ownerId);

      if (result.status === "accepted") {
        setTuneInStatus("accepted");
        setIsSubmitting(false);
        return;
      }
    } catch {
      setIsSubmitting(false);
      void hapticError();
      return;
    }

    setTuneInStatus("pending");
    void light();

    await refresh();
    setIsSubmitting(false);
  }

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!ownerId) return;

    const channel = supabase
      .channel(`tune-ins-${ownerId}-${channelIdRef.current}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tune_ins",
          filter: `frequency_owner_id=eq.${ownerId}`,
        },
        refresh
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "tune_ins",
          filter: `listener_id=eq.${ownerId}`,
        },
        refresh
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [ownerId, refresh]);

  return {
    tunedInCount,
    listeningCount,
    tuneInStatus,
    isTunedIn: tuneInStatus === "accepted",
    isPending: tuneInStatus === "pending",
    isSubmitting,
    toggleTuneIn,
  };
}
