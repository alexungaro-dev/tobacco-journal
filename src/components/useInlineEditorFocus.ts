import { useLayoutEffect, useRef } from "react";

export function useInlineEditorFocus(open: boolean, busy: boolean) {
  const heading = useRef<HTMLHeadingElement>(null);
  const editorHeading = useRef<HTMLHeadingElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  useLayoutEffect(() => {
    if (open && !wasOpen.current) {
      wasOpen.current = true;
      editorHeading.current?.focus();
    } else if (!open && !busy && wasOpen.current) {
      wasOpen.current = false;
      const previous = trigger.current;
      trigger.current = null;
      if (previous?.isConnected && !previous.matches(":disabled")) {
        previous.focus();
        if (document.activeElement === previous) return;
      }
      heading.current?.focus();
    }
  }, [open, busy]);

  return { heading, editorHeading, trigger };
}
