import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { cigarRow, cloudMock, OWNER_A, OWNER_B, PHOTO } from "./cloudMock";

export async function photoCatalogueFixture(page: Page) {
  const bytes = Buffer.from(PHOTO.split(",")[1], "base64");
  const mime = "image/png";
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const fixtures = [
    ...Array.from({ length: 8 }, (_, index) =>
      cigarRow(OWNER_A, "photo-" + index, "Riserva " + index),
    ),
    cigarRow(OWNER_B, "other-photo", "Other private cigar"),
  ].map((row, index) => {
    const path = row.user_id + "/cigar-photos/" + (index + 1).toString(16).repeat(64);
    row.extra.cataloguePhoto = { path, mime, size: bytes.length, sha256 };
    return { row, path };
  });
  const api = await cloudMock(page, [], [], fixtures.map(({ row }) => row));
  for (const { row, path } of fixtures) {
    api.objects.set(path, { bytes, type: mime });
    api.media.push({
      user_id: row.user_id,
      cigar_id: row.id,
      bucket_id: "journal-photos",
      object_path: path,
      mime_type: mime,
      size_bytes: bytes.length,
    });
  }
  return {
    api,
    fixtures,
    downloads: () => api.requests.filter(({ method, path }) =>
      method === "GET" && path.startsWith("/storage/v1/object/"),
    ),
    metadata: () => api.requests.filter(({ method, path }) =>
      method === "GET" && path.startsWith("/rest/v1/media?"),
    ),
  };
}
