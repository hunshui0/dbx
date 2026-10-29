import type { ColumnInfo, DatabaseType, QueryResult } from "@/types/database";

export type DataCompareCellValue = QueryResult["rows"][number][number];

export type SamplingStrategy = "Random" | "ExtremeValues" | "Hybrid";
export type DataCompareMode = "full" | "sample";
export const DATA_COMPARE_AMOUNT_TOLERANCE = "0.01";

/** Exclude a row when any selected match column meets one of these conditions. */
export interface DataCompareKeyExclusion {
  column: string;
  excludeNull: boolean;
  excludeEmptyString: boolean;
  values: string[];
}

export function normalizeDataCompareKeyExclusions(value: unknown): DataCompareKeyExclusion[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || typeof entry.column !== "string" || !entry.column.trim()) return [];
    const values = Array.isArray(entry.values) ? [...new Set<string>(entry.values.filter((item: unknown): item is string => typeof item === "string" && item.length > 0))] : [];
    const rule = { column: entry.column.trim(), excludeNull: entry.excludeNull === true, excludeEmptyString: entry.excludeEmptyString === true, values };
    return rule.excludeNull || rule.excludeEmptyString || values.length ? [rule] : [];
  });
}

export function normalizeDataCompareKeyExclusionsByTable(value: unknown): Record<string, DataCompareKeyExclusion[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([table, rules]) => {
      const normalized = normalizeDataCompareKeyExclusions(rules);
      return table && normalized.length ? [[table, normalized]] : [];
    }),
  );
}

/** Keep only non-empty per-table WHERE expressions from saved configurations. */
export function normalizeDataCompareWhereConditions(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([table, condition]) => (table && typeof condition === "string" && condition.trim() ? [[table, condition.trim()]] : [])));
}

export const DEFAULT_DATA_COMPARE_SAMPLE_SIZE = 10_000;
export const MAX_DATA_COMPARE_SAMPLE_SIZE = 10_000_000;

export function normalizeDataCompareSampleSize(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_DATA_COMPARE_SAMPLE_SIZE;
  return Math.max(1, Math.min(MAX_DATA_COMPARE_SAMPLE_SIZE, Math.floor(parsed)));
}

export function dataCompareThreshold(sampleSize: unknown): DegradationThreshold {
  return {
    fullCompareMaxRows: 100_000,
    sampleMaxRows: 10_000_000,
    sampleSize: normalizeDataCompareSampleSize(sampleSize),
    extremeSampleCount: 500,
  };
}

export interface DegradationThreshold {
  fullCompareMaxRows: number;
  sampleMaxRows: number;
  sampleSize: number;
  extremeSampleCount: number;
}

export interface DataCompareChangedCell {
  column: string;
  source: DataCompareCellValue;
  target: DataCompareCellValue;
}

export interface DataCompareRow {
  key: string;
  keyValues: Record<string, DataCompareCellValue>;
  values: Record<string, DataCompareCellValue>;
}

export interface DataCompareModifiedRow {
  key: string;
  keyValues: Record<string, DataCompareCellValue>;
  sourceValues: Record<string, DataCompareCellValue>;
  targetValues: Record<string, DataCompareCellValue>;
  changes: DataCompareChangedCell[];
}

export interface DataCompareResult {
  toleranceMatches?: DataCompareToleranceMatch[];
  added: DataCompareRow[];
  removed: DataCompareRow[];
  modified: DataCompareModifiedRow[];
}

export interface DataCompareToleranceMatch {
  key: string;
  keyValues: Record<string, DataCompareCellValue>;
  sourceValues: Record<string, DataCompareCellValue>;
  targetValues: Record<string, DataCompareCellValue>;
  changes: Array<DataCompareChangedCell & { absoluteDifference: string }>;
}

/** One audit row per tolerated cell, preserving keyed source/target values as supplied. */
export function buildDataCompareToleranceWorksheets(tables: ReadonlyArray<{ sourceTable: string; keyColumns: string[]; diff: Pick<DataCompareResult, "toleranceMatches"> }>, labels: { suffix: string; field: string; source: string; target: string; difference: string; threshold: string }) {
  return tables
    .filter((table) => table.diff.toleranceMatches?.length)
    .map((table) => ({
      sheetName: `${table.sourceTable}-${labels.suffix}`,
      columns: [...table.keyColumns, labels.field, labels.source, labels.target, labels.difference, labels.threshold],
      rows: table.diff.toleranceMatches!.flatMap((row) => row.changes.map((change) => [...table.keyColumns.map((key) => row.keyValues[key] ?? null), change.column, change.source, change.target, change.absoluteDifference, DATA_COMPARE_AMOUNT_TOLERANCE])),
      autoFilter: false,
    }));
}

export interface DataCompareReportTable {
  amountToleranceEnabled?: boolean;
  sourceTable: string;
  targetTable: string;
  status: "different" | "same" | "inconclusive" | "error";
  columns: string[];
  keyColumns: string[];
  ignoredColumns?: string[];
  keyExclusions?: DataCompareKeyExclusion[];
  whereCondition?: string;
  sourceRowCount: number;
  targetRowCount: number;
  sourceTruncated: boolean;
  targetTruncated: boolean;
  rowBudget: number;
  syncEligible: boolean;
  diff: {
    toleranceMatches?: DataCompareToleranceMatch[];
    added: Array<DataCompareRow & { selected: boolean }>;
    removed: Array<DataCompareRow & { selected: boolean }>;
    modified: Array<DataCompareModifiedRow & { selected: boolean }>;
  };
  error?: string;
}

export interface DataCompareReportLabels {
  toleranceMatches?: string;
  title: string;
  overview: string;
  details: string;
  table: string;
  sourceOnlyRows: string;
  targetOnlyRows: string;
  modifiedRows: string;
  syncSql: string;
  syncSqlSelectionNote: string;
  noSyncSql: string;
  partialResult: string;
}

export interface DataCompareReportOptions {
  source: string;
  target: string;
  compareMode: DataCompareMode;
  compareModeLabel: string;
  sampleSize: number;
  generatedAt: Date;
  tables: DataCompareReportTable[];
  syncSql: string;
  labels: DataCompareReportLabels;
}

function fencedBlock(language: string, content: string): string {
  const longestBacktickRun = Math.max(0, ...(content.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return `${fence}${language}\n${content}\n${fence}`;
}

function jsonBlock(value: unknown): string {
  return fencedBlock("json", JSON.stringify(value, null, 2));
}

export function buildDataCompareReportMarkdown(options: DataCompareReportOptions): string {
  const { labels, tables } = options;
  const totals = tables.reduce(
    (summary, table) => ({
      added: summary.added + table.diff.added.length,
      removed: summary.removed + table.diff.removed.length,
      modified: summary.modified + table.diff.modified.length,
      toleranceMatchedRows: summary.toleranceMatchedRows + (table.diff.toleranceMatches?.length ?? 0),
      sameTables: summary.sameTables + Number(table.status === "same"),
      inconclusiveTables: summary.inconclusiveTables + Number(table.status === "inconclusive"),
      differentTables: summary.differentTables + Number(table.status === "different"),
      failedTables: summary.failedTables + Number(table.status === "error"),
    }),
    { added: 0, removed: 0, modified: 0, toleranceMatchedRows: 0, sameTables: 0, inconclusiveTables: 0, differentTables: 0, failedTables: 0 },
  );
  const mode = options.compareMode === "sample" ? "sample" : "full";
  const overview = {
    generatedAt: options.generatedAt.toISOString(),
    source: options.source,
    target: options.target,
    compareMode: mode,
    compareModeLabel: options.compareModeLabel,
    sampleSizePerSide: mode === "sample" ? options.sampleSize : null,
    tableCount: tables.length,
    totals,
  };
  const tableSections = tables.map((table, index) => {
    const summary = {
      sourceTable: table.sourceTable,
      targetTable: table.targetTable,
      status: table.status,
      sourceRowCount: table.sourceRowCount,
      targetRowCount: table.targetRowCount,
      rowBudget: table.rowBudget,
      sourceTruncated: table.sourceTruncated,
      targetTruncated: table.targetTruncated,
      syncEligible: table.syncEligible,
      columns: table.columns,
      keyColumns: table.keyColumns,
      ignoredColumns: table.ignoredColumns ?? [],
      keyExclusions: table.keyExclusions ?? [],
      whereCondition: table.whereCondition ?? "",
      rowScope: table.keyExclusions?.length || table.whereCondition?.trim() ? "filtered" : "unfiltered",
      addedCount: table.diff.added.length,
      removedCount: table.diff.removed.length,
      modifiedCount: table.diff.modified.length,
      amountTolerance: table.amountToleranceEnabled ? DATA_COMPARE_AMOUNT_TOLERANCE : null,
      toleranceMatchedRows: table.diff.toleranceMatches?.length ?? 0,
      ...(table.error ? { error: table.error } : {}),
    };
    return [
      `### ${labels.table} ${index + 1}`,
      "",
      jsonBlock(summary),
      table.sourceTruncated || table.targetTruncated ? `\n\n${labels.partialResult}` : "",
      "",
      `#### ${labels.sourceOnlyRows} (${table.diff.added.length})`,
      "",
      jsonBlock(table.diff.added),
      "",
      `#### ${labels.targetOnlyRows} (${table.diff.removed.length})`,
      "",
      jsonBlock(table.diff.removed),
      "",
      `#### ${labels.modifiedRows} (${table.diff.modified.length})`,
      "",
      jsonBlock(table.diff.modified),
      "",
      `#### ${labels.toleranceMatches ?? "Tolerance matches"} (${table.diff.toleranceMatches?.length ?? 0})`,
      "",
      jsonBlock(table.diff.toleranceMatches ?? []),
    ].join("\n");
  });
  const sqlSection = options.syncSql.trim() ? `${labels.syncSqlSelectionNote}\n\n${fencedBlock("sql", options.syncSql.trim())}` : labels.noSyncSql;

  return [`# ${labels.title}`, "", `## ${labels.overview}`, "", jsonBlock(overview), "", `## ${labels.details}`, "", ...(tableSections.length ? tableSections : ["_"]), "", `## ${labels.syncSql}`, "", sqlSection, ""].join("\n");
}

export interface DataComparePreparationOptions {
  tableName: string;
  schema?: string;
  columns: string[];
  keyColumns: string[];
  columnInfo?: ColumnInfo[];
  sourceRows: DataCompareCellValue[][];
  targetRows: DataCompareCellValue[][];
  databaseType?: DatabaseType;
}

export interface DataComparePreparation {
  result: DataCompareResult;
  syncStatements: string[];
  syncSql: string;
}

export interface DataCompareFromTablesOptions {
  amountToleranceEnabled?: boolean;
  sourceConnectionId: string;
  sourceDatabase: string;
  sourceSchema: string;
  sourceTable: string;
  targetConnectionId: string;
  targetDatabase: string;
  targetSchema: string;
  targetTable: string;
  columns: string[];
  keyColumns: string[];
  ignoredColumns?: string[];
  keyExclusions?: DataCompareKeyExclusion[];
  whereCondition?: string;
  /** Source-side column names aligned positionally with `columns`; needed when the two databases store identifier case differently (e.g. SQL Server vs Oracle). */
  sourceColumns?: string[];
  fetchBatchSize?: number;
  degradationThreshold?: DegradationThreshold;
  compareMode?: DataCompareMode;
  samplingStrategy?: SamplingStrategy;
  enableChecksum?: boolean;
}

export interface DataCompareMissingTargetOptions {
  sourceConnectionId: string;
  sourceDatabase: string;
  sourceSchema: string;
  sourceTable: string;
  targetConnectionId: string;
  targetDatabase: string;
  targetSchema: string;
  targetTable: string;
  keyColumns: string[];
  ignoredColumns?: string[];
  keyExclusions?: DataCompareKeyExclusion[];
  whereCondition?: string;
  fetchBatchSize?: number;
  degradationThreshold?: DegradationThreshold;
  compareMode?: DataCompareMode;
  samplingStrategy?: SamplingStrategy;
  enableChecksum?: boolean;
}

export interface DataCompareFromTablesPreparation extends DataComparePreparation {
  preSyncStatements: string[];
  sourceRowCount: number;
  targetRowCount: number;
  sourceTruncated: boolean;
  targetTruncated: boolean;
  /** Rows per side this compare was allowed to inspect; fewer than the full table when truncated or sampled. */
  rowBudget: number;
  syncEligible: boolean;
}

export interface DataCompareSyncPlanTableOptions {
  whereCondition?: string;
  tableName: string;
  schema?: string;
  columns: string[];
  keyColumns: string[];
  columnInfo?: ColumnInfo[];
  diff: DataCompareResult;
  databaseType?: DatabaseType;
  preSyncStatements?: string[];
  syncEligible: boolean;
}

export interface DataCompareSyncPlanOptions {
  tables: DataCompareSyncPlanTableOptions[];
}

export interface DataCompareSyncPlan {
  insertCount: number;
  updateCount: number;
  deleteCount: number;
  statementCount: number;
  syncStatements: string[];
  syncSql: string;
}

/** Minimal column shape a match-column picker needs, so it can be fed straight from `getColumns`. */
export type CompareKeyColumnOption = Pick<ColumnInfo, "name" | "is_primary_key"> & Partial<Pick<ColumnInfo, "data_type">>;

/**
 * Safely infers the columns to use as comparison keys for a table.
 *
 * Only primary-key columns are trusted: a primary key is unique by
 * definition, so comparing on it can never produce duplicate-key failures.
 * Composite primary keys are returned as-is.
 *
 * When no primary key exists an empty array is returned so the caller can ask
 * the user to pick matching columns explicitly. Falling back to the first
 * column would silently select an arbitrary, possibly non-unique field
 * (category, status, date, ...) and make the whole table comparison fail with
 * an unhelpful duplicate-key error.
 */
export function inferCompareKeyColumns(columns: CompareKeyColumnOption[]): string[] {
  const primaryKeys: string[] = [];
  for (const column of columns) {
    if (column.is_primary_key) primaryKeys.push(column.name);
  }
  return primaryKeys;
}

/**
 * Normalizes a match-column selection: trims entries, drops blanks and removes
 * case-insensitive duplicates while keeping the caller's order.
 *
 * Order is preserved because the backend builds each row key from `keyColumns`
 * in order; a stable order keeps diff keys identical between runs, and it lets a
 * composite primary key keep the column order the table declares.
 */
export function normalizeKeyColumns(columns: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const column of columns) {
    const name = column.trim();
    if (!name) continue;
    const lowerName = name.toLowerCase();
    if (seen.has(lowerName)) continue;
    seen.add(lowerName);
    normalized.push(name);
  }
  return normalized;
}

/**
 * Compares two match-column selections ignoring order and identifier case.
 * Used to decide whether a manual selection still equals the inferred primary
 * key, in which case it carries no override.
 */
export function sameKeyColumns(a: readonly string[], b: readonly string[]): boolean {
  const normalizedA = normalizeKeyColumns(a);
  const normalizedB = normalizeKeyColumns(b);
  if (normalizedA.length !== normalizedB.length) return false;
  const lowerB = new Set(normalizedB.map((column) => column.toLowerCase()));
  return normalizedA.every((column) => lowerB.has(column.toLowerCase()));
}

export interface CompareColumnIntersection {
  /** Target-side column names, kept in source order. */
  columns: string[];
  /** Source-side names aligned positionally with `columns`. */
  sourceColumns: string[];
}

/**
 * Intersects source and target columns case-insensitively.
 *
 * Databases store identifier case differently (SQL Server keeps the created
 * case, Oracle and Dameng store upper case, PostgreSQL lower case), so a
 * migrated table's columns only match across engines when compared without
 * case. Target names are canonical because sync SQL runs against the target.
 */
export function intersectCompareColumns(sourceColumns: (Pick<ColumnInfo, "name"> & Partial<Pick<ColumnInfo, "data_type">>)[], targetColumns: (Pick<ColumnInfo, "name"> & Partial<Pick<ColumnInfo, "data_type">>)[], ignoredColumns: string[] = []): CompareColumnIntersection {
  const ignored = new Set(normalizeKeyColumns(ignoredColumns).map((column) => column.toLowerCase()));
  const targetNamesByLowerName = new Map<string, string>();
  for (const column of targetColumns) {
    const lowerName = column.name.toLowerCase();
    if (!targetNamesByLowerName.has(lowerName)) targetNamesByLowerName.set(lowerName, column.name);
  }

  const columns: string[] = [];
  const sourceNames: string[] = [];
  const matched = new Set<string>();
  for (const column of sourceColumns) {
    const lowerName = column.name.toLowerCase();
    const targetName = targetNamesByLowerName.get(lowerName);
    if (targetName === undefined || matched.has(lowerName) || ignored.has(lowerName)) continue;
    const targetColumn = targetColumns.find((candidate) => candidate.name === targetName);
    if (isBinaryCompareType(column.data_type) || isBinaryCompareType(targetColumn?.data_type)) continue;
    matched.add(lowerName);
    columns.push(targetName);
    sourceNames.push(column.name);
  }
  return { columns, sourceColumns: sourceNames };
}

export function isBinaryCompareType(dataType: string | undefined): boolean {
  const type = dataType?.trim().toLowerCase() ?? "";
  return type.includes("blob") || type.includes("binary") || type.includes("for bit data") || type === "bit" || type.startsWith("bit(") || type === "image" || type === "bytea";
}

/**
 * Resolves a column name to the matching entry of `columns`, ignoring case.
 * Returns undefined when no column matches.
 */
export function matchColumnNameIgnoreCase(name: string, columns: string[]): string | undefined {
  const lowerName = name.toLowerCase();
  return columns.find((column) => column.toLowerCase() === lowerName);
}
