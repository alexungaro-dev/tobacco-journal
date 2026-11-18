import assert from "node:assert/strict";
import test from "node:test";
import {
  canDebitCigar,
  stockFailureKey,
  cigarStockAlert,
  confirmedStock,
  readStockPreferences,
  tobaccoStockAlert,
} from "../src/data/stockAlerts";

test("cigar availability respects threshold, zero and unspecified stock", () => {
  assert.equal(cigarStockAlert(3), "low");
  assert.equal(cigarStockAlert(4), undefined);
  assert.equal(cigarStockAlert(4, 4), "low");
  assert.equal(cigarStockAlert(1, 1), "low");
  assert.equal(cigarStockAlert(0, 1), "empty");
  for (const value of [null, -1, 1.5, NaN])
    assert.equal(cigarStockAlert(value), undefined);
});

test("tobacco alerts depend only on the recorded level", () => {
  assert.equal(tobaccoStockAlert("almostEmpty"), "low");
  assert.equal(tobaccoStockAlert("empty"), "empty");
  for (const level of [null, "half", "almostFull", "full"])
    assert.equal(tobaccoStockAlert(level), undefined);
});

test("preferences and confirmed outcomes reject invalid and missing values", () => {
  const row = { stock_alerts_enabled: false, cigar_low_stock_threshold: 10 };
  assert.deepEqual(readStockPreferences(row), {
    enabled: false,
    threshold: 10,
  });
  for (const value of [0, 11, 1.5, "3"]) {
    assert.throws(() =>
      readStockPreferences({ ...row, cigar_low_stock_threshold: value }),
    );
  }
  assert.equal(confirmedStock({}), undefined);
  assert.equal(
    confirmedStock({ stockOutcome: { kind: "cigar", remaining: -1 } }),
    undefined,
  );
  assert.equal(
    confirmedStock({ stockOutcome: { kind: "tobacco", remaining: 0 } }),
    undefined,
  );
  assert.deepEqual(
    confirmedStock({ stockOutcome: { kind: "cigar", remaining: 0 } }),
    { kind: "cigar", remaining: 0 },
  );
  assert.deepEqual(
    confirmedStock({ stockOutcome: { kind: "tobacco", remainingLevel: null } }),
    { kind: "tobacco", remainingLevel: null },
  );
});

test("only a positive whole quantity offers a debit and failures remain distinguishable", () => {
  assert.equal(canDebitCigar(1), true);
  for (const value of [0, null, -1, 1.5])
    assert.equal(canDebitCigar(value), false);
  assert.equal(stockFailureKey("PT422"), "diary.stockUnavailable");
  assert.equal(stockFailureKey("40001"), "diary.stockConflict");
  assert.equal(stockFailureKey(undefined), undefined);
});
