// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";

const CONFIG_KEY = "dbx-data-compare-configs";

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    sourceConnectionId: "src",
    sourceDatabase: "app",
    sourceSchema: "public",
    selectedSourceTables: ["users", "orders"],
    targetConnectionId: "dst",
    targetDatabase: "app_copy",
    targetSchema: "public",
    targetTable: "users",
    detailPreviewLimit: "100",
    compareMode: "full" as const,
    sampleSize: 10_000,
    keyColumnsByTable: { users: ["user_id"] },
    ...overrides,
  };
}

describe("useDataCompareConfig", () => {
  it("persists NULL-empty equivalence separately from amount tolerance and defaults it off", async () => {
    const { useDataCompareConfig } = await import("../useDataCompareConfig");
    const state = useDataCompareConfig();
    expect(state.createConfig("Strict nulls", snapshot()).nullEqualsEmpty).toBe(false);
    const created = state.createConfig("Null equivalence", snapshot({ nullEqualsEmpty: true, amountToleranceEnabled: false }));
    expect(state.duplicateConfig(created.id)?.nullEqualsEmpty).toBe(true);
    vi.resetModules();
    const { useDataCompareConfig: restore } = await import("../useDataCompareConfig");
    expect(restore().configs.value.find((config) => config.id === created.id)?.nullEqualsEmpty).toBe(true);
    restore().updateConfig(created.id, { nullEqualsEmpty: false });
    expect(restore().configs.value.find((config) => config.id === created.id)?.nullEqualsEmpty).toBe(false);
  });
  it("defaults tolerance off and preserves an enabled choice through save, reload and disable", async () => {
    localStorage.clear();
    vi.resetModules();
    const { useDataCompareConfig } = await import("../useDataCompareConfig");
    const state = useDataCompareConfig();
    expect(state.createConfig("Strict", snapshot()).amountToleranceEnabled).toBe(false);
    const enabled = state.createConfig("Tolerance", snapshot({ amountToleranceEnabled: true }));
    expect(state.duplicateConfig(enabled.id)?.amountToleranceEnabled).toBe(true);
    vi.resetModules();
    const { useDataCompareConfig: restore } = await import("../useDataCompareConfig");
    expect(restore().configs.value.find((config) => config.id === enabled.id)?.amountToleranceEnabled).toBe(true);
    restore().updateConfig(enabled.id, { amountToleranceEnabled: false });
    expect(JSON.parse(localStorage.getItem(CONFIG_KEY)!).find((config: { id: string }) => config.id === enabled.id).amountToleranceEnabled).toBe(false);
  });

  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("creates a config and persists the whole selection", async () => {
    const { useDataCompareConfig } = await import("../useDataCompareConfig");
    const state = useDataCompareConfig();

    const created = state.createConfig("Nightly", snapshot());

    expect(state.activeConfigId.value).toBe(created.id);
    expect(state.activeConfig.value?.name).toBe("Nightly");
    const stored = JSON.parse(localStorage.getItem(CONFIG_KEY) ?? "[]") as Array<Record<string, unknown>>;
    expect(stored).toHaveLength(1);
    expect(stored[0]!.selectedSourceTables).toEqual(["users", "orders"]);
    expect(stored[0]!.compareMode).toBe("full");
    expect(stored[0]!.sampleSize).toBe(10_000);
    expect(stored[0]!.keyColumnsByTable).toEqual({ users: ["user_id"] });
  });

  it("persists and restores a custom sample mode and row count", async () => {
    const { useDataCompareConfig } = await import("../useDataCompareConfig");
    const state = useDataCompareConfig();
    state.createConfig("Sample", snapshot({ compareMode: "sample", sampleSize: 4321 }));

    vi.resetModules();
    const { useDataCompareConfig: createRestoredState } = await import("../useDataCompareConfig");
    const restored = createRestoredState();
    expect(restored.configs.value[0]).toMatchObject({ compareMode: "sample", sampleSize: 4321 });
  });

  it("keeps config names unique instead of silently overwriting", async () => {
    const { useDataCompareConfig } = await import("../useDataCompareConfig");
    const state = useDataCompareConfig();

    state.createConfig("Same", snapshot());
    state.createConfig("Same", snapshot());

    expect(state.configs.value.map((config) => config.name)).toEqual(["Same (1)", "Same"]);
    state.renameConfig(state.configs.value[1]!.id, "Same (1)");
    expect(state.configs.value.map((config) => config.name)).toEqual(["Same (1)", "Same (1) (1)"]);
  });

  it("persists per-table ignored fields and clones them independently", async () => {
    const { useDataCompareConfig } = await import("../useDataCompareConfig");
    const state = useDataCompareConfig();
    const created = state.createConfig("Per table", { ...snapshot(), ignoredColumnsByTable: { users: ["email"], orders: [] } });
    const copy = state.duplicateConfig(created.id)!;
    copy.ignoredColumnsByTable!.users!.push("name");
    expect(created.ignoredColumnsByTable).toEqual({ users: ["email"], orders: [] });
    state.updateConfig(created.id, { ignoredColumnsByTable: { users: ["name"] } });
    vi.resetModules();
    const { useDataCompareConfig: restore } = await import("../useDataCompareConfig");
    expect(restore().configs.value.find((config) => config.id === created.id)?.ignoredColumnsByTable).toEqual({ users: ["name"] });
  });

  it("drops the active selection when the active config is deleted", async () => {
    const { useDataCompareConfig } = await import("../useDataCompareConfig");
    const state = useDataCompareConfig();
    const created = state.createConfig("One", snapshot());

    state.deleteConfig(created.id);

    expect(state.configs.value).toHaveLength(0);
    expect(state.activeConfigId.value).toBe("");
    expect(state.activeConfig.value).toBeNull();
  });

  it("persists per-table key exclusions without sharing rule values", async () => {
    const { useDataCompareConfig } = await import("../useDataCompareConfig");
    const state = useDataCompareConfig();
    const rules = { users: [{ column: "user_id", excludeNull: true, excludeEmptyString: false, values: ["0", "  "] }] };
    const config = state.createConfig("Filtered", { ...snapshot(), keyExclusionsByTable: rules });
    rules.users[0]!.values.push("changed");
    const copy = state.duplicateConfig(config.id)!;
    copy.keyExclusionsByTable!.users![0]!.values.push("copy");
    expect(config.keyExclusionsByTable!.users![0]!.values).toEqual(["0", "  "]);
    state.updateConfig(config.id, { keyExclusionsByTable: { users: [{ column: "user_id", excludeNull: false, excludeEmptyString: false, values: ["-1"] }] } });
    vi.resetModules();
    const { useDataCompareConfig: restore } = await import("../useDataCompareConfig");
    expect(restore().configs.value.find((item) => item.id === config.id)?.keyExclusionsByTable).toEqual({ users: [{ column: "user_id", excludeNull: false, excludeEmptyString: false, values: ["-1"] }] });
    const restored = restore();
    restored.updateConfig(config.id, { keyExclusionsByTable: {} });
    expect(restored.configs.value.find((item) => item.id === config.id)?.keyExclusionsByTable).toEqual({});
  });

  it("duplicates a config under a new id without sharing mutable arrays", async () => {
    const { useDataCompareConfig } = await import("../useDataCompareConfig");
    const state = useDataCompareConfig();
    const created = state.createConfig("Base", snapshot());

    const copy = state.duplicateConfig(created.id);

    expect(copy?.id).not.toBe(created.id);
    expect(copy?.name).toBe("Base (1)");
    expect(state.activeConfigId.value).toBe(copy?.id);
    copy!.selectedSourceTables.push("logs");
    expect(created.selectedSourceTables).toEqual(["users", "orders"]);
  });

  it("updates a config in place and bumps updatedAt", async () => {
    const { useDataCompareConfig } = await import("../useDataCompareConfig");
    const state = useDataCompareConfig();
    const created = state.createConfig("One", snapshot());
    created.updatedAt = 1;

    state.updateConfig(created.id, { selectedSourceTables: ["logs"], keyColumnsByTable: {} });

    const updated = state.configs.value.find((config) => config.id === created.id);
    expect(updated?.selectedSourceTables).toEqual(["logs"]);
    expect(updated?.keyColumnsByTable).toEqual({});
    expect(updated?.updatedAt).toBeGreaterThan(1);
  });

  it("sanitizes stored configs and preserves an explicitly cleared match-column list", async () => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify([{ name: "Valid", id: "a", selectedSourceTables: ["t", 5], keyColumnsByTable: { t: [], u: "bad" } }, { id: "no-name", name: "" }, "not-an-object"]));

    const { useDataCompareConfig } = await import("../useDataCompareConfig");
    const state = useDataCompareConfig();

    expect(state.configs.value).toHaveLength(1);
    expect(state.configs.value[0]!.selectedSourceTables).toEqual(["t"]);
    expect(state.configs.value[0]!.keyColumnsByTable).toEqual({ t: [] });
    expect(state.configs.value[0]!.detailPreviewLimit).toBe("");
    expect(state.configs.value[0]!.compareMode).toBe("full");
    expect(state.configs.value[0]!.sampleSize).toBe(10_000);
  });

  it("recovers from unreadable stored JSON", async () => {
    localStorage.setItem(CONFIG_KEY, "{not json");

    const { useDataCompareConfig } = await import("../useDataCompareConfig");
    const state = useDataCompareConfig();

    expect(state.configs.value).toEqual([]);
    expect(state.activeConfig.value).toBeNull();
  });
});

describe("per-table comparison search conditions", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it("saves, restores, duplicates and clears independent per-table expressions", async () => {
    const { useDataCompareConfig } = await import("../useDataCompareConfig");
    const state = useDataCompareConfig();
    const conditions = { users: " ID > 10 ", orders: "STATE = 'A'", logs: "  " };
    const created = state.createConfig("Filtered", snapshot({ whereConditionsByTable: conditions }));
    const copy = state.duplicateConfig(created.id)!;
    conditions.users = "ID > 999";
    copy.whereConditionsByTable!.users = "ID < 0";
    expect(created.whereConditionsByTable).toEqual({ users: "ID > 10", orders: "STATE = 'A'" });
    vi.resetModules();
    const { useDataCompareConfig: restore } = await import("../useDataCompareConfig");
    const restored = restore();
    expect(restored.configs.value.find((item) => item.id === created.id)?.whereConditionsByTable).toEqual({ users: "ID > 10", orders: "STATE = 'A'" });
    restored.updateConfig(created.id, { whereConditionsByTable: {} });
    expect(restored.configs.value.find((item) => item.id === created.id)?.whereConditionsByTable).toEqual({});
  });

  it("loads old configurations without adding a filter", async () => {
    localStorage.setItem(CONFIG_KEY, JSON.stringify([{ ...snapshot(), id: "old", name: "Old" }]));
    const { useDataCompareConfig } = await import("../useDataCompareConfig");
    expect(useDataCompareConfig().configs.value[0]?.whereConditionsByTable).toEqual({});
  });
});
