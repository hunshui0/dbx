import { describe, expect, it } from "vitest";
import { buildDataCompareReportMarkdown, buildDataCompareToleranceWorksheets, buildDataCompareDifferenceWorksheets, buildDataCompareNullEmptyWorksheets, type DataCompareReportLabels, type DataCompareReportTable } from "../dataCompare";

const labels: DataCompareReportLabels = {
  title: "Report",
  overview: "Overview",
  details: "Differences",
  table: "Table",
  sourceOnlyRows: "Source-only rows",
  targetOnlyRows: "Target-only rows",
  modifiedRows: "Modified rows",
  syncSql: "Sync SQL",
  syncSqlSelectionNote: "SQL reflects selected differences.",
  noSyncSql: "No SQL generated.",
  partialResult: "Only inspected rows are represented.",
};

const table: DataCompareReportTable = {
  sourceTable: "orders",
  targetTable: "ORDERS",
  status: "different",
  columns: ["id", "note", "amount"],
  keyColumns: ["id"],
  keyExclusions: [{ column: "id", excludeNull: true, excludeEmptyString: false, values: ["0"] }],
  sourceRowCount: 20,
  targetRowCount: 18,
  sourceTruncated: true,
  targetTruncated: false,
  rowBudget: 10,
  syncEligible: false,
  diff: {
    added: [{ key: "1", keyValues: { id: 1 }, values: { id: 1, note: "new|row", amount: null }, selected: false }],
    removed: [{ key: "2", keyValues: { id: 2 }, values: { id: 2, note: "old", amount: 8 }, selected: true }],
    modified: [
      {
        key: "3",
        keyValues: { id: 3 },
        sourceValues: { id: 3, note: "source" },
        targetValues: { id: 3, note: "target" },
        changes: [{ column: "note", source: "source", target: "target" }],
        selected: true,
      },
    ],
  },
};

describe("buildDataCompareReportMarkdown", () => {
  it("omits completely identical tables from detail sections while keeping overview totals", () => {
    const same = { ...table, sourceTable: "UNCHANGED_TABLE", targetTable: "UNCHANGED_TABLE", status: "same" as const, sourceRowCount: 2, targetRowCount: 2, sourceTruncated: false, targetTruncated: false, diff: { added: [], removed: [], modified: [] } };
    const report = buildDataCompareReportMarkdown({ source: "DB2", target: "TiDB", compareMode: "full", compareModeLabel: "Full", sampleSize: 100, generatedAt: new Date(), tables: [same, table], syncSql: "", labels });
    expect(report).not.toContain("UNCHANGED_TABLE");
    expect(report).toContain('"tableCount": 2');
    expect(report).toContain('"sameTables": 1');
  });
  it("exports only changed fields and composite unique values, never equal cell snapshots", () => {
    const row = { key: "composite", keyValues: { id: "0001", trn_date: "20261015" }, sourceValues: { note: "UNCHANGED_SENTINEL", amount: "100" }, targetValues: { note: "UNCHANGED_SENTINEL", amount: "101" }, changes: [{ column: "amount", source: "100", target: "101" }], selected: true };
    const current = { ...table, keyColumns: ["id", "trn_date"], columns: ["id", "trn_date", "note", "amount"], diff: { added: [], removed: [], modified: [row] } };
    const sheets = buildDataCompareDifferenceWorksheets([current], { kind: "Kind", field: "Field", source: "Source", target: "Target", added: "Added", removed: "Removed", modified: "Modified", rowPresence: "Row", present: "Present", absent: "Absent" });
    expect(sheets[0]!.columns).toEqual(["Kind", "id", "trn_date", "Field", "Source", "Target"]);
    expect(sheets[0]!.rows).toEqual([["Modified", "0001", "20261015", "amount", "100", "101"]]);
    const report = buildDataCompareReportMarkdown({ source: "DB2", target: "TiDB", compareMode: "full", compareModeLabel: "Full", sampleSize: 100, generatedAt: new Date(), tables: [current], syncSql: "", labels });
    expect(report).not.toContain("UNCHANGED_SENTINEL");
    expect(report).not.toContain('"sourceValues"');
    expect(report).toContain('"id": "0001"');
    expect(report).toContain('"column": "amount"');
    expect(report).toContain('"target": "101"');
  });

  it("distinguishes NULL, empty strings and a whole missing row in exports", () => {
    const current = { ...table, columns: ["id", "note"], nullEqualsEmpty: true, diff: { added: [], removed: [], modified: [], nullEmptyMatches: [{ key: "1", keyValues: { id: 1 }, changes: [{ column: "note", source: null, target: "" }] }] } };
    const sheets = buildDataCompareNullEmptyWorksheets([current], { suffix: "NullEmpty", field: "Field", source: "Source", target: "Target", rule: "Rule", ruleValue: "NULL=empty" });
    expect(sheets[0]!.rows).toEqual([[1, "note", "NULL", '""', "NULL=empty"]]);
    const keyOnly = { ...table, columns: ["id"], diff: { added: [{ key: "1", keyValues: { id: 1 }, values: { id: 1 } }], removed: [], modified: [] } };
    const absent = buildDataCompareDifferenceWorksheets([keyOnly], { kind: "Kind", field: "Field", source: "Source", target: "Target", added: "Added", removed: "Removed", modified: "Modified", rowPresence: "Row", present: "Present", absent: "Absent" });
    expect(absent[0]!.rows).toEqual([["Added", 1, "Row", "Present", "Absent"]]);
  });
  it("exports all tolerance cases, including otherwise identical tables and mixed rows", () => {
    const matches = [
      { key: "acct", keyValues: { id: "0001" }, sourceValues: { amount: "99999999999999999999.99" }, targetValues: { amount: "99999999999999999999.98" }, changes: [{ column: "amount", source: "99999999999999999999.99", target: "99999999999999999999.98", absoluteDifference: "0.01" }] },
    ];
    const tables = [
      { ...table, status: "same" as const, amountToleranceEnabled: true, diff: { added: [], removed: [], modified: [], toleranceMatches: matches } },
      { ...table, amountToleranceEnabled: true, diff: { ...table.diff, toleranceMatches: matches } },
    ];
    const sheets = buildDataCompareToleranceWorksheets(tables, { suffix: "Tolerance", field: "Field", source: "Source", target: "Target", difference: "Difference", threshold: "Threshold" });
    expect(sheets).toHaveLength(2);
    expect(sheets[0]!.columns).toEqual(["id", "Field", "Source", "Target", "Difference", "Threshold"]);
    expect(sheets[0]!.rows[0]).toEqual(["0001", "amount", "99999999999999999999.99", "99999999999999999999.98", "0.01", "0.01"]);
    const report = buildDataCompareReportMarkdown({ source: "DB2", target: "TiDB", compareMode: "full", compareModeLabel: "Full", sampleSize: 10000, generatedAt: new Date("2026-10-29T00:00:00Z"), tables, syncSql: "", labels });
    expect(report).toContain('"amountTolerance": "0.01"');
    expect(report).toContain('"toleranceMatchedRows": 2');
    expect(report).toContain('"absoluteDifference": "0.01"');
    expect(report).toContain('"id": "0001"');
    expect(report).toContain("99999999999999999999.98");
  });
  it("keeps incomplete equality out of the identical table count", () => {
    const report = buildDataCompareReportMarkdown({
      source: "DB2",
      target: "TiDB",
      compareMode: "sample",
      compareModeLabel: "Sample",
      sampleSize: 10000,
      generatedAt: new Date("2026-10-29T00:00:00Z"),
      tables: [{ ...table, status: "inconclusive", sourceRowCount: 178193, targetRowCount: 178193, diff: { added: [], removed: [], modified: [] } }],
      syncSql: "",
      labels,
    });
    expect(report).toContain('"inconclusiveTables": 1');
    expect(report).toContain('"sameTables": 0');
    expect(report).toContain('"status": "inconclusive"');
  });
  it("records the SQL predicate and marks otherwise unfiltered rows as filtered", () => {
    const report = buildDataCompareReportMarkdown({
      source: "DB2",
      target: "TiDB",
      compareMode: "full",
      compareModeLabel: "Full",
      sampleSize: 100,
      generatedAt: new Date("2026-10-29T00:00:00Z"),
      tables: [{ ...table, keyExclusions: [], whereCondition: "STATUS = 'A'" }],
      syncSql: "",
      labels,
    });
    expect(report).toContain('"whereCondition": "STATUS = \'A\'"');
    expect(report).toContain('"rowScope": "filtered"');
  });

  it("includes comparison metadata, every diff category, and partial-result details", () => {
    const report = buildDataCompareReportMarkdown({
      source: "DB2 / SALES",
      target: "TiDB / SALES",
      compareMode: "sample",
      compareModeLabel: "Sample compare",
      sampleSize: 10,
      generatedAt: new Date("2026-10-22T12:34:56.000Z"),
      tables: [table],
      syncSql: "",
      labels,
    });

    expect(report).toContain('"compareMode": "sample"');
    expect(report).toContain('"compareModeLabel": "Sample compare"');
    expect(report).toContain('"sampleSizePerSide": 10');
    expect(report).toContain('"sourceTable": "orders"');
    expect(report).toContain('"keyExclusions": [');
    expect(report).toContain('"excludeNull": true');
    expect(report).toContain('"rowBudget": 10');
    expect(report).toContain("Only inspected rows are represented.");
    expect(report).toContain('"source": "new|row"');
    expect(report).not.toContain('"targetValues": {');
    expect(report).not.toContain('"sourceValues": {');
    expect(report).toContain('"selected": false');
    expect(report).toContain("No SQL generated.");
  });

  it("uses fences longer than backtick runs in row values and SQL", () => {
    const backtickTable = {
      ...table,
      sourceTruncated: false,
      targetTruncated: false,
      diff: {
        ...table.diff,
        added: [{ ...table.diff.added[0]!, values: { ...table.diff.added[0]!.values, note: "contains ``` in value" } }],
      },
    };
    const report = buildDataCompareReportMarkdown({
      source: "source",
      target: "target",
      compareMode: "full",
      compareModeLabel: "Full compare",
      sampleSize: 100,
      generatedAt: new Date("2026-10-22T12:34:56.000Z"),
      tables: [backtickTable],
      syncSql: "UPDATE t SET note = '```' WHERE id = 1;",
      labels,
    });

    expect(report).toContain("````json\n");
    expect(report).toContain("````sql\nUPDATE t SET note = '```' WHERE id = 1;\n````");
  });
});
