import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./client";
import {
  ensureProfile,
  recoveryUser,
  restoreAccess,
  setRecoveryUser,
} from "./session";

// One bootstrap per page, including React StrictMode's effect replay. A PKCE code is single use.
let bootstrap: ReturnType<typeof restoreAccess> | undefined;
export function useAuth(locale: string) {
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!!supabase);
  const [recovery, setRecovery] = useState(false);
  const [message, setMessage] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [profileError, setProfileError] = useState(false);
  const [profileAttempt, setProfileAttempt] = useState(0);
  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let active = true;
    setLoading(true);
    setSessionError("");
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, next) => {
      // Keep this synchronous: awaiting other Auth calls here can deadlock the SDK lock.
      if (!active) return;
      if (event === "INITIAL_SESSION") return; // bootstrap owns initial ordering
      setSession(next);
      if (event === "PASSWORD_RECOVERY" && next) {
        setRecoveryUser(next.user.id);
        setRecovery(true);
      } else if (!next || recoveryUser() !== next.user.id) {
        // Another tab may sign in as a different user during recovery.
        setRecoveryUser(null);
        setRecovery(false);
      }
      if (event === "SIGNED_OUT") {
        setRecoveryUser(null);
        setRecovery(false);
        setMessage("auth.sessionEnded");
      }
    });
    bootstrap ??= restoreAccess(client);
    void bootstrap
      .then((result) => {
        if (!active) return;
        setSession(result.session);
        setRecovery(result.recovery);
        setMessage(result.message);
      })
      .catch((error: unknown) => {
        if (active)
          setSessionError(
            error instanceof Error && error.message === "invalid_callback"
              ? "auth.errors.callback"
              : "auth.errors.session",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [attempt]);
  const userId = session?.user.id;
  useEffect(() => {
    setProfileError(false);
    if (!supabase || !userId || loading || sessionError) return;
    let active = true;
    void ensureProfile(supabase, userId, localeRef.current).catch(() => {
      if (active) setProfileError(true);
    });
    return () => {
      active = false;
    };
    // Locale is used only when creating the profile; never sync UI changes to stored preferences.
  }, [userId, loading, sessionError, profileAttempt]);
  return {
    session,
    loading,
    recovery,
    message,
    setMessage,
    sessionError,
    profileError,
    retrySession: () => {
      bootstrap = undefined;
      setAttempt((n) => n + 1);
    },
    retryProfile: () => setProfileAttempt((n) => n + 1),
    finishRecovery: () => {
      setRecovery(false);
      setRecoveryUser(null);
    },
  };
}
