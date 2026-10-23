import { describe, expect, it } from "vitest";
import { DEFAULT_DATA_COMPARE_SAMPLE_SIZE, MAX_DATA_COMPARE_SAMPLE_SIZE, dataCompareThreshold, inferCompareKeyColumns, intersectCompareColumns, matchColumnNameIgnoreCase, normalizeDataCompareSampleSize, normalizeKeyColumns, sameKeyColumns } from "../dataCompare";

describe("dataCompareThreshold", () => {
  it("keeps a sample count while leaving mode selection to the compare request", () => {
    expect(dataCompareThreshold(DEFAULT_DATA_COMPARE_SAMPLE_SIZE)).toEqual({
      fullCompareMaxRows: 100_000,
      sampleMaxRows: 10_000_000,
      sampleSize: DEFAULT_DATA_COMPARE_SAMPLE_SIZE,
      extremeSampleCount: 500,
    });
  });

  it("uses the requested sample size", () => {
    expect(dataCompareThreshold(4321).sampleSize).toBe(4321);
  });

  it("clamps sample sizes to a positive supported integer", () => {
    expect(normalizeDataCompareSampleSize(0)).toBe(1);
    expect(normalizeDataCompareSampleSize(4321.9)).toBe(4321);
    expect(normalizeDataCompareSampleSize(MAX_DATA_COMPARE_SAMPLE_SIZE + 1)).toBe(MAX_DATA_COMPARE_SAMPLE_SIZE);
  });
});

describe("inferCompareKeyColumns", () => {
  it("returns all primary-key columns when a primary key exists", () => {
    expect(
      inferCompareKeyColumns([
        { name: "id", is_primary_key: true },
        { name: "name", is_primary_key: false },
      ]),
    ).toEqual(["id"]);
  });

  it("returns a composite primary key as-is", () => {
    expect(
      inferCompareKeyColumns([
        { name: "tenant_id", is_primary_key: true },
        { name: "user_id", is_primary_key: true },
        { name: "name", is_primary_key: false },
      ]),
    ).toEqual(["tenant_id", "user_id"]);
  });

  it("returns an empty array instead of falling back to the first column when there is no primary key", () => {
    expect(
      inferCompareKeyColumns([
        { name: "category", is_primary_key: false },
        { name: "name", is_primary_key: false },
      ]),
    ).toEqual([]);
  });

  it("returns an empty array for an empty column list", () => {
    expect(inferCompareKeyColumns([])).toEqual([]);
  });
});

describe("intersectCompareColumns", () => {
  it("matches lower-case source columns against upper-case target columns", () => {
    const intersection = intersectCompareColumns([{ name: "snid" }, { name: "username" }, { name: "amount" }], [{ name: "SNID" }, { name: "USERNAME" }, { name: "AMOUNT" }]);
    expect(intersection.columns).toEqual(["SNID", "USERNAME", "AMOUNT"]);
    expect(intersection.sourceColumns).toEqual(["snid", "username", "amount"]);
  });

  it("keeps source order and omits columns missing on either side", () => {
    const intersection = intersectCompareColumns([{ name: "Amount" }, { name: "snid" }, { name: "extra" }], [{ name: "SNID" }, { name: "AMOUNT" }]);
    expect(intersection.columns).toEqual(["AMOUNT", "SNID"]);
    expect(intersection.sourceColumns).toEqual(["Amount", "snid"]);
  });

  it("returns an empty intersection when no column names match ignoring case", () => {
    const intersection = intersectCompareColumns([{ name: "snid" }], [{ name: "id" }]);
    expect(intersection.columns).toEqual([]);
    expect(intersection.sourceColumns).toEqual([]);
  });

  it("deduplicates duplicated source columns", () => {
    const intersection = intersectCompareColumns([{ name: "snid" }, { name: "SNID" }], [{ name: "SNID" }]);
    expect(intersection.columns).toEqual(["SNID"]);
    expect(intersection.sourceColumns).toEqual(["snid"]);
  });

  it("excludes binary columns on either side", () => {
    const intersection = intersectCompareColumns(
      [
        { name: "id", data_type: "INTEGER" },
        { name: "payload", data_type: "BLOB" },
        { name: "flags", data_type: "CHAR FOR BIT DATA" },
      ],
      [
        { name: "ID", data_type: "int" },
        { name: "PAYLOAD", data_type: "longblob" },
        { name: "FLAGS", data_type: "varbinary(8)" },
      ],
    );
    expect(intersection.columns).toEqual(["ID"]);
    expect(intersection.sourceColumns).toEqual(["id"]);
  });
});

describe("matchColumnNameIgnoreCase", () => {
  it("resolves a name to the canonical entry ignoring case", () => {
    expect(matchColumnNameIgnoreCase("SNID", ["snid", "name"])).toBe("snid");
    expect(matchColumnNameIgnoreCase("Name", ["SNID", "NAME"])).toBe("NAME");
  });

  it("returns undefined when no column matches", () => {
    expect(matchColumnNameIgnoreCase("missing", ["snid"])).toBeUndefined();
  });
});

describe("normalizeKeyColumns", () => {
  it("keeps the given order so a composite key stays stable", () => {
    expect(normalizeKeyColumns(["tenant_id", "order_id"])).toEqual(["tenant_id", "order_id"]);
  });

  it("trims names and drops blanks", () => {
    expect(normalizeKeyColumns([" id ", "", "  ", "name"])).toEqual(["id", "name"]);
  });

  it("drops case-insensitive duplicates but keeps the first spelling", () => {
    expect(normalizeKeyColumns(["ID", "id", "Id"])).toEqual(["ID"]);
  });

  it("returns an empty array for an empty selection", () => {
    expect(normalizeKeyColumns([])).toEqual([]);
  });
});

describe("sameKeyColumns", () => {
  it("ignores order and identifier case", () => {
    expect(sameKeyColumns(["tenant_id", "order_id"], ["ORDER_ID", "TENANT_ID"])).toBe(true);
  });

  it("detects different selections and different lengths", () => {
    expect(sameKeyColumns(["id"], ["ID", "name"])).toBe(false);
    expect(sameKeyColumns(["id"], ["name"])).toBe(false);
  });

  it("treats two empty selections as equal", () => {
    expect(sameKeyColumns([], [])).toBe(true);
  });
});
