import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useTranslation } from "react-i18next";

export type AccountPanel = "account" | "preferences";

export function AccountMenu({
  trigger,
  preferencesReady,
  onPanel,
  onLogout,
}: {
  trigger: RefObject<HTMLButtonElement | null>;
  preferencesReady: boolean;
  onPanel: (panel: AccountPanel) => void;
  onLogout: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button:enabled") ?? []);
    if (!items.length) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const forward = event.key === "ArrowDown";
    const index =
      event.key === "Home" || (current === -1 && forward) ? 0
      : event.key === "End" || current === -1 ? items.length - 1
      : (current + (forward ? 1 : -1) + items.length) % items.length;
    items[index]?.focus();
  }

  return (
    <div
      className="profile-menu"
      ref={root}
      onKeyDown={keyboard}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        className="profile-trigger"
        type="button"
        aria-label={t("auth.menu")}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="12" cy="8" r="3.25" />
          <path d="M5 20v-1.5a4.5 4.5 0 0 1 4.5-4.5h5a4.5 4.5 0 0 1 4.5 4.5V20" />
        </svg>
      </button>
      <div id={id} className="profile-popover" ref={menu} hidden={!open}>
        <button type="button" onClick={() => { setOpen(false); onPanel("account"); }}>
          {t("auth.account")}
        </button>
        <button type="button" disabled={!preferencesReady} onClick={() => { setOpen(false); onPanel("preferences"); }}>
          {t("auth.preferences")}
        </button>
        <button type="button" onClick={() => { setOpen(false); onLogout(); }}>
          {t("auth.logout")}
        </button>
      </div>
    </div>
  );
}
