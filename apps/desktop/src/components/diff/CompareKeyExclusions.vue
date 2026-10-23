<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { normalizeDataCompareKeyExclusions, type CompareKeyColumnOption, type DataCompareKeyExclusion } from "@/lib/dataGrid/dataCompare";

const props = defineProps<{ modelValue: DataCompareKeyExclusion[]; columns: string[]; columnInfo: CompareKeyColumnOption[]; disabled?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: DataCompareKeyExclusion[]] }>();
const { t } = useI18n();
const rows = computed(() => props.columns.map((column) => ({ column, rule: props.modelValue.find((rule) => rule.column.toLowerCase() === column.toLowerCase()) ?? { column, excludeNull: false, excludeEmptyString: false, values: [] } })));

function isCharacterColumn(column: string): boolean {
  const dataType = props.columnInfo.find((info) => info.name.toLowerCase() === column.toLowerCase())?.data_type ?? "";
  return /char|text|clob|string|graphic|^(enum|set)\b/i.test(dataType);
}

function update(column: string, patch: Partial<DataCompareKeyExclusion>) {
  if (props.disabled) return;
  const rules = rows.value.map((row) => (row.column === column ? { ...row.rule, ...patch, column } : row.rule));
  emit("update:modelValue", normalizeDataCompareKeyExclusions(rules));
}
</script>

<template>
  <details v-if="columns.length" class="rounded-md border px-2 py-1.5" data-key-exclusions>
    <summary class="cursor-pointer text-xs font-medium">
      {{ t("dataCompare.keyExclusions") }}<span v-if="modelValue.length" class="ml-1 text-muted-foreground">({{ modelValue.length }})</span>
    </summary>
    <p class="mt-1 text-[11px] text-muted-foreground">{{ t("dataCompare.keyExclusionsHint") }}</p>
    <div v-for="row in rows" :key="row.column" class="mt-2 space-y-1" :data-key-exclusion-column="row.column">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span class="break-all font-mono">{{ row.column }}</span>
        <label class="inline-flex items-center gap-1"><input type="checkbox" :checked="row.rule.excludeNull" :disabled="disabled" data-exclude-null @change="update(row.column, { excludeNull: ($event.target as HTMLInputElement).checked })" />{{ t("dataCompare.excludeNull") }}</label>
        <label class="inline-flex items-center gap-1"
          ><input type="checkbox" :checked="row.rule.excludeEmptyString" :disabled="disabled || !isCharacterColumn(row.column)" data-exclude-empty @change="update(row.column, { excludeEmptyString: ($event.target as HTMLInputElement).checked })" />{{ t("dataCompare.excludeEmptyString") }}</label
        >
      </div>
      <label class="block text-[11px] text-muted-foreground">
        {{ t("dataCompare.excludedValues") }}
        <textarea
          :value="row.rule.values.join('\n')"
          :disabled="disabled"
          :aria-label="`${row.column}: ${t('dataCompare.excludedValues')}`"
          :placeholder="t('dataCompare.excludedValuesPlaceholder')"
          rows="2"
          class="mt-1 w-full resize-y rounded-md border border-input bg-transparent px-2 py-1 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          data-excluded-values
          @change="update(row.column, { values: ($event.target as HTMLTextAreaElement).value.split(/\r?\n/).filter((value) => value.length > 0) })"
        />
      </label>
    </div>
  </details>
</template>
