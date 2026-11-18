import assert from "node:assert/strict";
import test from "node:test";
import {
  componentsOf,
  fromTobaccoRow,
  inspectTobaccoBackup,
  normalizeTobacco,
  tobaccoFormat,
  tobaccoPhoto,
} from "../src/data/tobaccos";

const entry = {
  id: "lot",
  brand: "  Maker ",
  name: "Mixture",
  remaining: 0,
  rating: 5,
};
test("tobacco fields normalize without losing zero quantities or custom components", () => {
  const tobacco = normalizeTobacco({
    ...entry,
    components: [" Virginia ", "virginia", "Custom leaf"],
    status: "opened",
  });
  assert.equal(tobacco.brand, "Maker");
  assert.equal(tobacco.remaining, 0);
  assert.equal(tobacco.initial, null);
  assert.deepEqual(tobacco.components, ["Virginia", "Custom leaf"]);
  assert.deepEqual(componentsOf(["", "x", "X "]), ["x"]);
  for (const invalid of [
    { brand: " " },
    { name: "" },
    { rating: 6 },
    { rating: 2.5 },
    { remaining: -1 },
    { price: Infinity },
    { date: "2026-02-30" },
    { status: "bogus" },
  ])
    assert.throws(
      () => normalizeTobacco({ ...entry, ...invalid }),
      /tobaccos.invalid/,
    );
});

test("catalogue imports reject pipe backups, ambiguous IDs and unsafe photos", () => {
  const backup = (tobaccos: unknown[]) =>
    JSON.stringify({ format: tobaccoFormat, version: 1, tobaccos });
  const result = inspectTobaccoBackup(
    backup([
      entry,
      { ...entry, id: "lot" },
      { ...entry, id: "safe" },
      { ...entry, id: "unsafe", photo: "https://image.example/test" },
    ]),
  );
  assert.equal(result[0].error, "tobaccos.duplicate");
  assert.equal(result[1].error, "tobaccos.duplicate");
  assert.equal(result[2].item?.brand, "Maker");
  assert.equal(result[3].error, "photos.format");
  assert.throws(() =>
    inspectTobaccoBackup(
      JSON.stringify({
        format: "tobacco-journal-pipes",
        version: 1,
        pipes: [],
      }),
    ),
  );
});

test("foundation rows normalize optional fields and reject another owner's reference", () => {
  const row = {
    id: "x",
    user_id: "owner",
    brand: "A",
    name: "B",
    blend_type: null,
    notes: null,
    extra: {},
    created_at: "2026-11-18",
    updated_at: "2026-11-18",
  };
  assert.equal(fromTobaccoRow(row).blend, "");
  assert.equal(tobaccoPhoto(row), undefined);
  assert.throws(
    () =>
      tobaccoPhoto({
        ...row,
        extra: {
          cataloguePhoto: {
            path: "other/tobacco-photos/" + "a".repeat(64),
            mime: "image/png",
            size: 1,
            sha256: "b".repeat(64),
          },
        },
      }),
    /photos.integrity/,
  );
});
