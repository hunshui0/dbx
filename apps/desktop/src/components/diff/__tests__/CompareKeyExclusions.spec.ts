// @vitest-environment happy-dom

import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/i18n";
import CompareKeyExclusions from "../CompareKeyExclusions.vue";
import { normalizeDataCompareKeyExclusionsByTable, type DataCompareKeyExclusion } from "@/lib/dataGrid/dataCompare";

const apps: App[] = [];
afterEach(() => {
  apps.splice(0).forEach((app) => app.unmount());
  document.body.textContent = "";
});

function mount(disabled = false, dataType = "VARCHAR(100)") {
  const rules = ref<DataCompareKeyExclusion[]>([]);
  const container = document.createElement("div");
  document.body.append(container);
  const app = createApp(
    defineComponent({
      setup: () => () =>
        h(CompareKeyExclusions, {
          modelValue: rules.value,
          columns: ["id"],
          columnInfo: [{ name: "id", is_primary_key: false, data_type: dataType }],
          disabled,
          "onUpdate:modelValue": (value: DataCompareKeyExclusion[]) => {
            rules.value = value;
          },
        }),
    }),
  );
  app.use(i18n).mount(container);
  apps.push(app);
  return { rules, container };
}

describe("CompareKeyExclusions", () => {
  it("keeps NULL, empty string and literal values independently selectable", async () => {
    const { container, rules } = mount();
    const setCheckbox = async (selector: string, checked: boolean) => {
      const checkbox = container.querySelector<HTMLInputElement>(selector)!;
      checkbox.checked = checked;
      checkbox.dispatchEvent(new Event("change", { bubbles: true }));
      await nextTick();
    };
    await setCheckbox("[data-exclude-null]", true);
    await setCheckbox("[data-exclude-empty]", true);
    const input = container.querySelector<HTMLTextAreaElement>("textarea")!;
    input.value = "0\r\nNULL\r\n  \r\nO'Brien\r\n0\r\n";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await nextTick();
    expect(rules.value).toEqual([{ column: "id", excludeNull: true, excludeEmptyString: true, values: ["0", "NULL", "  ", "O'Brien"] }]);
    await setCheckbox("[data-exclude-null]", false);
    expect(rules.value[0]?.excludeEmptyString).toBe(true);
    expect(rules.value[0]?.values).toContain("NULL");
  });

  it("disables empty-string exclusion for numeric keys", () => {
    const { container } = mount(false, "DECIMAL(31,0)");
    expect(container.querySelector<HTMLInputElement>("[data-exclude-empty]")?.disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>("[data-exclude-null]")?.disabled).toBe(false);
  });

  it("prevents edits while comparison is running", async () => {
    const { container, rules } = mount(true);
    const input = container.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(input.disabled).toBe(true);
    input.value = "0";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await nextTick();
    expect(rules.value).toEqual([]);
  });

  it("sanitizes stored rules and removes inactive rules without trimming data", () => {
    expect(normalizeDataCompareKeyExclusionsByTable({ users: [null, { column: " id ", excludeNull: true, values: ["0", "", "  ", "0", 1] }, { column: "unused", values: [] }], orders: "invalid" })).toEqual({
      users: [{ column: "id", excludeNull: true, excludeEmptyString: false, values: ["0", "  "] }],
    });
  });
});
