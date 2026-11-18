import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Pipe } from "../types";
import { CloudPipes } from "./cloudPipes";
import {
  legacyBlob,
  photoState,
  type PhotoEdit,
  type PhotoRef,
} from "./pipePhotos";
import { createBackup, PHOTO_STATE } from "./storage";
import {
  CloudError,
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
  const [warning, setWarning] = useState("");
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
  const readPhoto = useCallback(async (id: string, ref: PhotoRef) => {
    const current = scope.current;
    if (!current) throw Error();
    try {
      return await current.service.photos.read(id, ref);
    } catch (error) {
      if (
        scope.current === current &&
        cloudErrorKey(error) === "cloud.errors.session"
      )
        sessionLost.current();
      throw error;
    }
  }, []);

  function remember(row: PipeRow) {
    setRows((current) =>
      current.some((existing) => existing.id === row.id)
        ? current.map((existing) => (existing.id === row.id ? row : existing))
        : [row, ...current],
    );
  }

  async function retire(
    service: CloudPipes,
    row: PipeRow,
    ref: PhotoRef,
    cascaded = false,
  ) {
    try {
      await service.photos.retire(row.id, ref, cascaded);
    } catch (error) {
      if (scope.current?.service === service) {
        if (cloudErrorKey(error) === "cloud.errors.session")
          sessionLost.current();
        else setWarning("photos.cleanup");
      }
    }
  }

  function getPhoto(row: PipeRow) {
    try {
      return { ref: photoState(row), damaged: false };
    } catch {
      return { ref: undefined, damaged: true };
    }
  }

  const byId = new Map(rows.map((row) => [row.id, row]));
  const pending = rows.filter(
    (row) =>
      !!row.legacy_payload.photo &&
      !Object.hasOwn(row.legacy_payload, PHOTO_STATE),
  );
  return {
    pipes: rows.map((row) => fromRow(row, userId)),
    loading,
    busy,
    error,
    warning,
    readPhoto,
    pending: pending.length,
    photo: (id: string) => {
      const row = byId.get(id);
      return row ? getPhoto(row) : { ref: undefined, damaged: false };
    },
    exportBackup: () =>
      perform(async (service) => {
        const pipes: Pipe[] = [];
        for (const row of rows)
          pipes.push(
            await service.photos.backup(fromRow(row, userId), photoState(row)),
          );
        return createBackup(pipes);
      }),
    migratePhotos: () =>
      perform(async (service) => {
        const result = {
          verified: 0,
          failures: [] as { label: string; reason: string }[],
          unattempted: 0,
        };
        for (const [index, candidate] of pending.entries()) {
          try {
            const row = await service.get(candidate.id);
            if (scope.current?.service !== service) return result;
            if (!row) throw new CloudError("cloud.errors.conflict");
            remember(row);
            // Refresh the server revision before staging. A previously committed
            // migration or a manual photo from another tab takes precedence.
            if (photoState(row) !== undefined || !row.legacy_payload.photo)
              continue;
            const pipe = fromRow(row, userId);
            const ref = await service.photos.stage(
              row,
              legacyBlob(pipe.photo!),
              "legacy",
            );
            const next = await service.attachLegacy(row, ref);
            if (scope.current?.service !== service) return result;
            remember(next);
            result.verified++;
          } catch (error) {
            if (scope.current?.service !== service) return result;
            const reason = cloudErrorKey(error);
            result.failures.push({ label: candidate.id, reason });
            if (
              reason === "cloud.errors.session" ||
              reason === "cloud.errors.network"
            ) {
              if (reason === "cloud.errors.session") sessionLost.current();
              result.unattempted = pending.length - index - 1;
              break;
            }
          }
        }
        return result;
      }),
    reload: () => {
      if (scope.current && !lock.current && !loading) void load(scope.current);
    },
    save: async (pipe: Pipe, edit: PhotoEdit) => {
      const result = await perform(async (service) => {
        setWarning("");
        let row = byId.get(pipe.id);
        const original = row && getPhoto(row).ref;
        if (!row && edit) {
          // The foreign key requires a confirmed pipe before a photo can be attached.
          row = await service.save(pipe, undefined, undefined, true);
          if (scope.current?.service !== service) return;
          remember(row);
          setWarning("photos.pipeCreated");
        }
        const photo = edit ? await service.photos.stage(row!, edit) : edit;
        const next = await service.save(pipe, row, photo);
        if (scope.current?.service !== service) return;
        setWarning("");
        remember(next);
        if (photo !== undefined && original && original.path !== photo?.path)
          await retire(service, next, original);
        return true;
      });
      return result === true;
    },
    remove: async (pipe: Pipe) => {
      const row = byId.get(pipe.id);
      if (!row) return false;
      return (
        (await perform(async (service) => {
          setWarning("");
          await service.remove(row);
          if (scope.current?.service !== service) return false;
          setRows((current) => current.filter((entry) => entry.id !== pipe.id));
          const ref = getPhoto(row).ref;
          if (ref) await retire(service, row, ref, true);
          return true;
        })) === true
      );
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
