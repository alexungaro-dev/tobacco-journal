import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { configuration, supabase, callbackUrl } from "../auth/client";
import { authErrorKey } from "../auth/config";
import { useAuthContext } from "../auth/AuthContext";

type Mode = "login" | "signup" | "forgot";
export function Account({
  onStockSettings,
}: {
  onStockSettings?: () => void;
}) {
  const { t } = useTranslation();
  const auth = useAuthContext();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const details = useRef<HTMLDetailsElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if ((auth.recovery || auth.message || auth.sessionError) && details.current)
      details.current.open = true;
    if (auth.recovery) passwordField.current?.focus();
  }, [auth.recovery, auth.message, auth.sessionError]);
  const previousUser = useRef<string | undefined>(undefined);
  useEffect(() => {
    const next = auth.session?.user.id;
    if (previousUser.current && previousUser.current !== next) {
      setEmail("");
      setPassword("");
      setConfirmation("");
      setError("");
    }
    previousUser.current = next;
  }, [auth.session?.user.id]);
  const reset = auth.recovery;
  function switchMode(next: Mode) {
    setMode(next);
    setPassword("");
    setConfirmation("");
    setError("");
    auth.setMessage("");
  }
  async function run(action: () => Promise<void>) {
    if (busy || !supabase) return;
    setBusy(true);
    setError("");
    auth.setMessage("");
    try {
      await action();
    } catch (e) {
      setError(authErrorKey(e));
    } finally {
      setBusy(false);
      setPassword("");
      setConfirmation("");
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const client = supabase;
    if ((reset || mode === "signup") && password.length < 12) {
      setError("auth.errors.password");
      return;
    }
    if ((reset || mode === "signup") && password !== confirmation) {
      setError("auth.errors.mismatch");
      return;
    }
    await run(async () => {
      if (reset) {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        auth.finishRecovery();
        auth.setMessage("auth.passwordSaved");
      } else if (mode === "login") {
        const { error } = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
        auth.setMessage("auth.signedIn");
      } else if (mode === "signup") {
        const { error } = await client.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: callbackUrl() },
        });
        if (error) throw error;
        auth.setMessage("auth.checkEmail");
        setMode("login");
      } else {
        const { error } = await client.auth.resetPasswordForEmail(
          email.trim(),
          { redirectTo: callbackUrl(true) },
        );
        if (error) throw error;
        auth.setMessage("auth.resetSent");
      }
    });
  }
  return (
    <details className="account" ref={details}>
      <summary>
        {t("auth.account")}
        {auth.session ? ` · ${t("auth.connected")}` : ""}
      </summary>
      <div className="accountbody">
        <p className="accountnote">{t("auth.localNotice")}</p>
        {configuration.status !== "configured" ? (
          <p role="status">
            {t(
              configuration.status === "missing"
                ? "auth.unavailable"
                : "auth.badConfig",
            )}
          </p>
        ) : auth.loading ? (
          <p role="status">{t("auth.loading")}</p>
        ) : (
          <>
            {auth.sessionError && (
              <div className="notice" role="alert">
                <p>{t(auth.sessionError)}</p>
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={auth.retrySession}
                >
                  {t("auth.retry")}
                </button>
                {!auth.session && (
                  <button
                    className="btn secondary"
                    disabled={busy}
                    onClick={() => void run(() => auth.signOut())}
                  >
                    {t("auth.logout")}
                  </button>
                )}
              </div>
            )}
            {auth.message && <p role="status">{t(auth.message)}</p>}
            {error && (
              <p className="formerror" role="alert">
                {t(error)}
              </p>
            )}
            {auth.session && (
              <div className="accountsession">
                <p>
                  {t("auth.signedAs", {
                    email: auth.session.user.email || t("auth.account"),
                  })}
                </p>
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await auth.signOut();
                      auth.finishRecovery();
                      setMode("login");
                      auth.setMessage("auth.sessionEnded");
                    })
                  }
                >
                  {t("auth.logout")}
                </button>
                {onStockSettings && (
                  <button
                    className="link"
                    type="button"
                    aria-controls="stock-alert-preferences"
                    onClick={onStockSettings}
                  >
                    {t("stockAlerts.openSettings")}
                  </button>
                )}
              </div>
            )}
            {auth.profileError && (
              <div className="notice" role="alert">
                <p>{t("auth.errors.profile")}</p>
                <button
                  className="btn secondary"
                  disabled={busy}
                  onClick={auth.retryProfile}
                >
                  {t("auth.retryProfile")}
                </button>
              </div>
            )}
            {(!auth.session || reset) && !auth.sessionError && (
              <>
                <h2>{t(reset ? "auth.resetTitle" : `auth.${mode}Title`)}</h2>
                <form
                  onSubmit={(e) => void submit(e)}
                  aria-label={t("auth.form")}
                >
                  <fieldset disabled={busy}>
                    {!reset && (
                      <div className="field">
                        <label htmlFor="auth-email">{t("auth.email")}</label>
                        <input
                          ref={emailField}
                          id="auth-email"
                          type="email"
                          autoComplete="email"
                          required
                          maxLength={254}
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                        />
                      </div>
                    )}
                    {(reset || mode !== "forgot") && (
                      <div className="field">
                        <label htmlFor="auth-password">
                          {t(reset ? "auth.newPassword" : "auth.password")}
                        </label>
                        <input
                          ref={passwordField}
                          id="auth-password"
                          type="password"
                          required
                          minLength={
                            reset || mode === "signup" ? 12 : undefined
                          }
                          autoComplete={
                            reset || mode === "signup"
                              ? "new-password"
                              : "current-password"
                          }
                          aria-describedby={
                            reset || mode === "signup"
                              ? "auth-password-help"
                              : undefined
                          }
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                        />
                      </div>
                    )}
                    {(reset || mode === "signup") && (
                      <>
                        <p id="auth-password-help" className="accountnote">
                          {t("auth.passwordHelp")}
                        </p>
                        <div className="field">
                          <label htmlFor="auth-confirm">
                            {t("auth.confirmPassword")}
                          </label>
                          <input
                            id="auth-confirm"
                            type="password"
                            autoComplete="new-password"
                            required
                            minLength={12}
                            value={confirmation}
                            onChange={(e) => setConfirmation(e.target.value)}
                          />
                        </div>
                      </>
                    )}
                    <button className="btn" type="submit">
                      {t(
                        busy
                          ? "auth.wait"
                          : reset
                            ? "auth.savePassword"
                            : `auth.${mode}`,
                      )}
                    </button>
                  </fieldset>
                </form>
                {!reset && (
                  <div className="accountlinks">
                    {(["login", "signup", "forgot"] as const)
                      .filter((next) => next !== mode)
                      .map((next) => (
                        <button
                          key={next}
                          className="link"
                          disabled={busy}
                          onClick={() => switchMode(next)}
                        >
                          {t(`auth.${next}`)}
                        </button>
                      ))}
                    {mode === "login" && (
                      <button
                        className="link"
                        disabled={busy}
                        onClick={() => {
                          if (!emailField.current?.reportValidity()) return;
                          void run(async () => {
                            const { error } = await supabase!.auth.resend({
                              type: "signup",
                              email: email.trim(),
                              options: { emailRedirectTo: callbackUrl() },
                            });
                            if (error) throw error;
                            auth.setMessage("auth.checkEmail");
                          });
                        }}
                      >
                        {t("auth.resend")}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </details>
  );
}
