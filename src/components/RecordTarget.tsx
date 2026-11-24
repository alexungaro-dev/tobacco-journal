import { useEffect, useRef, type RefObject } from "react";
import { useTranslation } from "react-i18next";

export function useRecordTarget(
  id: string | undefined,
  ready: boolean,
  found: boolean,
  heading: RefObject<HTMLHeadingElement | null>,
) {
  const card = useRef<HTMLElement>(null);
  const previous = useRef(id);

  useEffect(() => {
    const leftDetail = previous.current !== undefined && id === undefined;
    previous.current = id;
    if (id !== undefined && ready) (card.current ?? heading.current)?.focus();
    else if (leftDetail) heading.current?.focus();
  }, [id, ready, found, heading]);

  return card;
}

export function BackToCatalogue({ href }: { href: string }) {
  const { t } = useTranslation();
  return (
    <p>
      <a className="link" href={href}>
        {t("cloud.backToCatalogue")}
      </a>
    </p>
  );
}
