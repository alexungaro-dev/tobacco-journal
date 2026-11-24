import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { configuration, supabase, callbackUrl } from "../auth/client";
import { authErrorKey } from "../auth/config";
import { useAuthContext } from "../auth/AuthContext";

type Mode = "login" | "signup" | "forgot";
export function Account({
  signingOut,
  onLogout,
}: {
  signingOut: boolean;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const auth = useAuthContext();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  const reset = auth.recovery;
  const busy = submitting || signingOut;
  const hasForm =
    configuration.status === "configured" && !auth.loading && !auth.sessionError;

  useEffect(() => {
    if (reset && hasForm) passwordField.current?.focus();
    else heading.current?.focus();
  }, [reset, hasForm, mode]);
  function switchMode(next: Mode) {
    setMode(next);
    setPassword("");
    setConfirmation("");
    setError("");
    auth.setMessage("");
  }
  async function run(action: () => Promise<void>) {
    if (busy || !supabase) return;
    setSubmitting(true);
    setError("");
    auth.setMessage("");
    try {
      await action();
    } catch (e) {
      setError(authErrorKey(e));
    } finally {
      setSubmitting(false);
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
    <section className="account auth-screen" aria-labelledby="auth-title">
      <h1 id="auth-title" ref={heading} tabIndex={-1}>
        {t(reset ? "auth.resetTitle" : `auth.${mode}Title`)}
      </h1>
      {!reset && <p className="accountnote">{t("auth.loginIntro")}</p>}
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
                  onClick={onLogout}
                >
                  {t("auth.logout")}
                </button>
              )}
            </div>
          )}
          {signingOut && <p role="status">{t("auth.wait")}</p>}
          {auth.message && <p role="status">{t(auth.message)}</p>}
          {error && (
            <p className="formerror" role="alert">
              {t(error)}
            </p>
          )}
          {reset && auth.session && (
            <button className="link" type="button" disabled={busy} onClick={onLogout}>
              {t("auth.logout")}
            </button>
          )}
          {hasForm && (
            <>
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
    </section>
  );
}
