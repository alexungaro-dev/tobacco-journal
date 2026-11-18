import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PhotoRef } from "../data/pipePhotos";

export interface PrivatePhoto {
  ref: PhotoRef | null | undefined;
  damaged: boolean;
  read: (id: string, ref: PhotoRef) => Promise<Blob>;
}

export function usePhotoPreview(blob: Blob | undefined) {
  const [preview, setPreview] = useState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setPreview({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return preview?.blob === blob ? preview?.url : undefined;
}

export function PipePhoto({
  id,
  legacy,
  photo,
  alt,
  editor = false,
}: {
  id: string;
  legacy?: string | null;
  photo: PrivatePhoto;
  alt: string;
  editor?: boolean;
}) {
  const { t } = useTranslation();
  const ref = photo.ref;
  const path = ref?.path;
  const { read } = photo;
  const [loaded, setLoaded] = useState<{ path: string; url?: string }>();
  useEffect(() => {
    if (!ref || !path) return;
    let active = true;
    let url: string | undefined;
    void read(id, ref)
      .then((blob) => {
        if (!active) return;
        url = URL.createObjectURL(blob);
        setLoaded({ path, url });
      })
      .catch(() => {
        if (active) setLoaded({ path });
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, path, read, ref]);

  const current = loaded?.path === path ? loaded : undefined;
  const supported =
    legacy && /^data:image\/(png|jpeg|webp);base64,/.test(legacy);
  const failed = photo.damaged || !!(ref && current && !current.url);
  const fallback =
    supported && (ref === undefined || failed) ? legacy : undefined;
  const unsupported = ref === undefined && !!legacy && !supported;
  const source = current?.url || fallback;
  return (
    <>
      {source ? (
        <img
          className={editor ? "preview" : undefined}
          src={source}
          alt={alt}
        />
      ) : (
        !editor && (
          <span className="silhouette" aria-hidden="true">
            ♧
          </span>
        )
      )}
      {(failed || unsupported) && (
        <span className="photostatus" role="status">
          {t(
            fallback
              ? "photos.fallback"
              : unsupported
                ? "photos.format"
                : "photos.read",
          )}
        </span>
      )}
    </>
  );
}
