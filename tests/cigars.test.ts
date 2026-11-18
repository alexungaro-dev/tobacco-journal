import test from "node:test";
import assert from "node:assert/strict";
import {
  fromCigarRow,
  inspectCigarBackup,
  normalizeCigar,
  vitolas,
} from "../src/data/cigars";

const cigar = {
  id: "one",
  brand: " Maker ",
  name: "Reserva",
  vitola: "Formato libero",
};
const backup = (cigars: unknown[]) =>
  JSON.stringify({ format: "tobacco-journal-cigars", version: 1, cigars });

test("cigar validation preserves optional values and enforces integral pieces and humidity bounds", () => {
  const normalized = normalizeCigar({
    ...cigar,
    initial: 8,
    remaining: 0,
    humidity: 64.5,
    rating: 5,
    ringGauge: 44.5,
  });
  assert.equal(normalized.brand, "Maker");
  assert.equal(normalized.vitola, "Formato libero");
  assert.equal(normalized.initial, 8);
  assert.equal(normalized.remaining, 0);
  assert.equal(normalized.humidity, 64.5);
  assert.equal(normalized.rating, 5);
  assert.equal(normalized.ringGauge, 44.5);
  assert.equal(normalizeCigar(cigar).humidity, null);
  assert.equal(normalizeCigar(cigar).remaining, null);
  for (const fields of [
    { brand: "" },
    { name: " " },
    { remaining: 1.5 },
    { initial: -1 },
    { remaining: Number.MAX_SAFE_INTEGER + 1 },
    { humidity: 100.01 },
    { humidity: -1 },
    { humidity: "65" },
    { rating: 0 },
    { rating: 2.5 },
    { length: 0 },
    { date: "2026-02-30" },
  ])
    assert.throws(
      () => normalizeCigar({ ...cigar, ...fields }),
      /cigars.invalid/,
    );
  for (const value of ["Robusto", "Half Corona", "Toscano"])
    assert.ok(vitolas.includes(value));
});

test("cigar backups reject duplicate IDs, unsafe photos and other catalogue formats", () => {
  const items = inspectCigarBackup(
    backup([
      cigar,
      { ...cigar, brand: "Different" },
      { ...cigar, id: "unique", humidity: 0, remaining: 3, photo: null },
      { ...cigar, id: "unsafe", photo: "https://example.test/personal" },
    ]),
  );
  assert.equal(items[0].error, "cigars.duplicate");
  assert.equal(items[1].error, "cigars.duplicate");
  assert.equal(items[2].item?.humidity, 0);
  assert.equal(items[2].item?.photo, null);
  assert.equal(items[3].error, "photos.format");
  for (const table of ["pipes", "tobaccos"]) {
    assert.throws(
      () =>
        inspectCigarBackup(
          JSON.stringify({
            format: "tobacco-journal-" + table,
            version: 1,
            [table]: [],
          }),
        ),
      /cigars.invalid/,
    );
  }
});

test("foundation cigar rows with empty extra keep identity and optional defaults", () => {
  const parsed = fromCigarRow({
    id: "same",
    user_id: "owner",
    brand: "A",
    name: "B",
    vitola: "Toscano",
    notes: null,
    extra: {},
    created_at: "2026-11-18",
    updated_at: "2026-11-18",
  });
  assert.equal(parsed.vitola, "Toscano");
  assert.equal(parsed.notes, "");
  assert.equal(parsed.humidity, null);
  assert.equal(parsed.rating, null);
});
