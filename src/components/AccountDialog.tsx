import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function AccountDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element) return;
    element.showModal();
    heading.current?.focus();
    return () => element.close();
  }, []);
  return (
    <dialog
      className="dialog profile-dialog"
      ref={dialog}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={id} ref={heading} tabIndex={-1}>{title}</h2>
      {children}
      <div className="actions">
        <button className="btn secondary" type="button" onClick={onClose}>{t("auth.close")}</button>
      </div>
    </dialog>
  );
}
