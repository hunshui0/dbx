import { describe, expect, it } from "vitest";
import { buildDataCompareReportMarkdown, type DataCompareReportLabels, type DataCompareReportTable } from "../dataCompare";

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
    expect(report).toContain('"note": "new|row"');
    expect(report).toContain('"targetValues": {');
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
