import { useCallback, useEffect, useRef, useState } from "react";
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
  const [session, setSessionState] = useState<Session | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const setSession = useCallback((next: Session | null) => {
    sessionRef.current = next;
    setSessionState(next);
  }, []);
  const [loading, setLoading] = useState(!!supabase);
  const [recovery, setRecovery] = useState(false);
  const [message, setMessage] = useState("");
  const [sessionError, setSessionError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const signingOut = useRef(false);
  const [profileReady, setProfileReady] = useState<string | null>(null);
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
      if (!active || (signingOut.current && next)) return;
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
    setProfileReady(null);
    if (!supabase || !userId || loading || sessionError) return;
    let active = true;
    void ensureProfile(supabase, userId, localeRef.current)
      .then(() => {
        if (active) setProfileReady(userId);
      })
      .catch(() => {
        if (active) setProfileError(true);
      });
    return () => {
      active = false;
    };
    // Locale is used only when creating the profile; never sync UI changes to stored preferences.
  }, [userId, loading, sessionError, profileAttempt]);
  const invalidateSession = useCallback(() => {
    setSession(null);
    setProfileReady(null);
    setSessionError("auth.errors.session");
    bootstrap = undefined;
  }, [setSession]);
  useEffect(() => {
    if (!session) return;
    let timer: ReturnType<typeof setTimeout>;
    const checkExpiry = () => {
      clearTimeout(timer);
      const current = sessionRef.current;
      if (!current) return;
      const remaining = (current.expires_at || 0) * 1000 - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0) invalidateSession();
      else timer = setTimeout(checkExpiry, Math.min(remaining, 2147483647));
    };
    checkExpiry();
    window.addEventListener("focus", checkExpiry);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", checkExpiry);
    };
  }, [session?.user.id, session?.expires_at, invalidateSession]);
  return {
    session,
    loading,
    recovery,
    message,
    setMessage,
    sessionError,
    profileError,
    invalidateSession,
    profileReady: !!userId && profileReady === userId,
    signOut: async () => {
      signingOut.current = true;
      // Hide and unmount all account data before waiting for the network.
      setSession(null);
      setProfileReady(null);
      bootstrap = undefined;
      try {
        const { error } = await supabase!.auth.signOut({ scope: "local" });
        if (error) throw error;
        setSessionError("");
        setMessage("auth.sessionEnded");
      } catch (error) {
        setSessionError("auth.errors.session");
        throw error;
      } finally {
        signingOut.current = false;
      }
    },
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
