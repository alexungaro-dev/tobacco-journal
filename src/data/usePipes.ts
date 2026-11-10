import { useState } from "react";
import type { Pipe } from "../types";
import { loadPipes, savePipes } from "./storage";
export function usePipes() {
  const [initial] = useState(() =>
    loadPipes({
      getItem: (key) => window.localStorage.getItem(key),
      setItem: (key, value) => window.localStorage.setItem(key, value),
    }),
  );
  const [blocked, setBlocked] = useState(!!initial.error);
  const [pipes, setPipes] = useState(initial.pipes);
  const [error, setError] = useState<string | null>(initial.error);
  function commit(next: Pipe[], recovery = false) {
    if (blocked && !recovery) return false;
    try {
      savePipes(window.localStorage, next);
      setPipes(next);
      setError(null);
      setBlocked(false);
      return true;
    } catch {
      setError("storageWrite");
      return false;
    }
  }
  return { pipes, error, blocked, commit };
}
