import test from "node:test";
import assert from "node:assert/strict";
import {
  legacyBlob,
  PHOTO_LIMIT,
  photoState,
  validatePhoto,
} from "../src/data/pipePhotos";
import { PHOTO_STATE } from "../src/data/storage";
import { toRow, fromRow, type PipeRow } from "../src/data/pipeMapping";

const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNoEFEBAAHQALnTUbepAAAAAElFTkSuQmCC";
const user = "11111111-1111-1111-1111-111111111111";
const pipe = { id: "legacy", brand: "Peterson", model: "999", photo: png };

test("photo validation accepts the exact byte limit and enforces type, signatures and decoding", async () => {
  const pngBytes = await legacyBlob(png).arrayBuffer();
  const padded = new Uint8Array(PHOTO_LIMIT);
  padded.set(new Uint8Array(pngBytes));
  const decode = async () => {};
  const atLimit = await validatePhoto(
    new Blob([padded], { type: "image/png" }),
    decode,
  );
  assert.equal(atLimit.size, PHOTO_LIMIT);
  assert.match(atLimit.sha256, /^[a-f0-9]{64}$/);
  await assert.rejects(
    validatePhoto(new Blob([padded, "x"], { type: "image/png" }), decode),
    /photos.size/,
  );
  await assert.rejects(
    validatePhoto(new Blob([], { type: "image/png" }), decode),
    /photos.size/,
  );
  await assert.rejects(
    validatePhoto(new Blob([pngBytes], { type: "image/gif" }), decode),
    /photos.format/,
  );
  await assert.rejects(
    validatePhoto(new Blob([pngBytes], { type: "image/webp" }), decode),
    /photos.format/,
  );
  await assert.rejects(
    validatePhoto(legacyBlob(png), async () => {
      throw Error();
    }),
    /photos.format/,
  );
  assert.throws(
    () => legacyBlob("data:image/svg+xml;base64,AAAA"),
    /photos.format/,
  );
});

test("private references are owner-scoped and stay out of exported and imported pipe data", () => {
  const updatedAt = "2026-11-18T00:00:00Z";
  const row: PipeRow = {
    ...toRow(pipe, user),
    created_at: updatedAt,
    updated_at: updatedAt,
  };
  const ref = {
    path: `${user}/pipe-photos/${"a".repeat(64)}`,
    mime: "image/png",
    size: 70,
    sha256: "b".repeat(64),
  };
  assert.equal(photoState(row), undefined);
  row.legacy_payload[PHOTO_STATE] = ref;
  assert.deepEqual(photoState(row), ref);
  assert.equal(fromRow(row, user).photo, png);
  assert.equal(Object.hasOwn(fromRow(row, user), PHOTO_STATE), false);
  assert.throws(
    () => toRow({ ...pipe, [PHOTO_STATE]: ref }, user),
    /photos.reserved/,
  );
  assert.throws(
    () => photoState({ ...row, user_id: "different-owner" }),
    /photos.integrity/,
  );
  row.legacy_payload[PHOTO_STATE] = null;
  assert.equal(photoState(row), null);
  assert.equal(fromRow(row, user).photo, png);
});
