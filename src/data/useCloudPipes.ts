import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pipe } from "../types";
import { CloudPipes } from "./cloudPipes";
import {
  cloudErrorKey,
  fromRow,
  type ImportPlan,
  type PipeRow,
} from "./pipeMapping";

export function useCloudPipes(
  client: SupabaseClient,
  userId: string,
  onSessionLost: () => void,
) {
  const [rows, setRows] = useState<PipeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scope = useRef<{
    service: CloudPipes;
    controller: AbortController;
  } | null>(null);
  const lock = useRef(false);
  const sessionLost = useRef(onSessionLost);
  sessionLost.current = onSessionLost;
  function report(e: unknown) {
    const key = cloudErrorKey(e);
    if (key === "cloud.errors.session") sessionLost.current();
    else setError(key);
  }
  async function load(current: NonNullable<typeof scope.current>) {
    setLoading(true);
    setRows([]);
    setError("");
    try {
      const next = await current.service.list();
      if (scope.current === current) setRows(next);
    } catch (e) {
      if (scope.current === current) report(e);
    } finally {
      if (scope.current === current) setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    const current = {
      controller,
      service: new CloudPipes(client, userId, controller.signal),
    };
    scope.current = current;
    void load(current);
    return () => {
      scope.current = null;
      controller.abort();
    };
  }, [client, userId]);
  async function perform<T>(
    action: (service: CloudPipes) => Promise<T>,
  ): Promise<T | undefined> {
    const current = scope.current;
    if (!current || lock.current || loading) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await action(current.service);
      if (scope.current === current) return result;
    } catch (e) {
      if (scope.current === current) report(e);
    } finally {
      if (scope.current === current) {
        lock.current = false;
        setBusy(false);
      }
    }
  }
  return {
    pipes: rows.map((row) => fromRow(row, userId)),
    loading,
    busy,
    error,
    reload: () => {
      if (scope.current && !lock.current && !loading) void load(scope.current);
    },
    save: async (pipe: Pipe) => {
      const result = await perform((service) =>
        service.save(
          pipe,
          rows.find((row) => row.id === pipe.id),
        ),
      );
      if (!result) return false;
      setRows((current) => [
        result,
        ...current.filter((row) => row.id !== result.id),
      ]);
      return true;
    },
    remove: async (pipe: Pipe) => {
      const row = rows.find((row) => row.id === pipe.id);
      if (!row) return false;
      const ok = await perform(async (service) => {
        await service.remove(row);
        return true;
      });
      if (!ok) return false;
      setRows((current) => current.filter((r) => r.id !== pipe.id));
      return true;
    },
    importRecords: (plan: ImportPlan, progress: (n: number) => void) =>
      perform(async (service) => {
        const result = await service.import(plan, progress);
        if (result.failures.some((f) => f.reason === "cloud.errors.session"))
          sessionLost.current();
        else if (scope.current) await load(scope.current);
        return result;
      }),
  };
}
