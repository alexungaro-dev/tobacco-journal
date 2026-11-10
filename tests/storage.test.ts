import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createBackup,
  loadPipes,
  parseBackup,
  PIPES_KEY,
  savePipes,
} from "../src/data/storage";
import it from "../src/locales/it.json";
import en from "../src/locales/en.json";
const legacy = [
  {
    id: "old-1",
    brand: "Peterson",
    model: "999",
    shape: "Bent",
    material: "Radica",
    filter: "9",
    status: "stored",
    date: "2025-05-10",
    price: 125.5,
    notes: "Ricordo personale",
    photo: "data:image/png;base64,aGVsbG8=",
    createdAt: "2025-01-01",
    custom: { preserve: true },
  },
];
function memory(raw: string | null) {
  let writes = 0;
  return {
    getItem: (key: string) => {
      assert.equal(key, PIPES_KEY);
      return raw;
    },
    setItem: (key: string, v: string) => {
      assert.equal(key, PIPES_KEY);
      raw = v;
      writes++;
    },
    get raw() {
      return raw;
    },
    get writes() {
      return writes;
    },
  };
}
test("legacy data loads losslessly without writes and round-trips through backups", () => {
  const store = memory(JSON.stringify(legacy));
  assert.deepEqual(loadPipes(store), { pipes: legacy, error: null });
  assert.equal(store.writes, 0);
  const restored = parseBackup(createBackup(legacy));
  savePipes(store, restored);
  assert.deepEqual(JSON.parse(store.raw!), legacy);
  assert.equal(store.writes, 1);
});
test("missing optional fields and unknown enum values remain intact", () => {
  const p = [
    { id: "1", brand: "A", model: "B", status: "personal", filter: "custom" },
  ];
  assert.deepEqual(loadPipes(memory(JSON.stringify(p))).pipes, p);
});
test("malformed, non-array, unsafe photo and duplicate IDs never overwrite originals", () => {
  for (const raw of [
    "{",
    "null",
    "{}",
    JSON.stringify([{ id: "1" }]),
    JSON.stringify([...legacy, ...legacy]),
    JSON.stringify([{ ...legacy[0], photo: "https://unsafe.example/image" }]),
  ]) {
    const store = memory(raw);
    assert.equal(loadPipes(store).error, "storageRead");
    assert.equal(store.raw, raw);
    assert.equal(store.writes, 0);
  }
});
test("empty storage is a valid empty collection", () =>
  assert.deepEqual(loadPipes(memory(null)), { pipes: [], error: null }));
test("invalid backups and versions are rejected", () => {
  for (const raw of [
    "null",
    "{}",
    JSON.stringify({
      format: "tobacco-journal-pipes",
      version: 2,
      pipes: legacy,
    }),
    JSON.stringify({
      format: "tobacco-journal-pipes",
      version: 1,
      pipes: [...legacy, ...legacy],
    }),
  ])
    assert.throws(() => parseBackup(raw));
});
test("storage access and quota failures are surfaced", () => {
  assert.equal(
    loadPipes({
      getItem() {
        throw Error();
      },
      setItem() {},
    }).error,
    "storageRead",
  );
  assert.throws(() =>
    savePipes(
      {
        getItem() {
          return null;
        },
        setItem() {
          throw Error("quota");
        },
      },
      legacy,
    ),
  );
});
function keys(obj: object, prefix = ""): string[] {
  return Object.entries(obj)
    .flatMap(([k, v]) =>
      typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    )
    .sort();
}
test("all IT/EN dictionary keys and interpolation parameters match", () => {
  assert.deepEqual(keys(it), keys(en));
  function placeholders(o: object): string[] {
    return Object.entries(o)
      .flatMap(([k, v]) =>
        typeof v === "object"
          ? placeholders(v)
          : [k + ":" + (String(v).match(/{{[^}]+}}/g) || []).sort().join(",")],
      )
      .sort();
  }
  assert.deepEqual(placeholders(it), placeholders(en));
});
