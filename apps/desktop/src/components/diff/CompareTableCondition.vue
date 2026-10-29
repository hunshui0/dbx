<script setup lang="ts">
import { useId } from "vue";
import { useI18n } from "vue-i18n";
import { Label } from "@/components/ui/label";

const condition = defineModel<string>({ default: "" });
defineProps<{ table: string; disabled?: boolean }>();
const { t } = useI18n();
const id = useId();
</script>

<template>
  <div class="space-y-1 py-1" :data-where-condition-table="table">
    <Label :for="id" class="text-xs font-medium">{{ t("dataCompare.whereCondition") }}</Label>
    <div class="flex overflow-hidden rounded-md border bg-background focus-within:ring-1 focus-within:ring-ring">
      <span class="select-none border-r bg-muted/30 px-2 py-2 font-mono text-[11px] text-muted-foreground" aria-hidden="true">WHERE</span>
      <textarea
        :id="id"
        v-model="condition"
        :disabled="disabled"
        :aria-describedby="`${id}-hint`"
        :placeholder="t('dataCompare.whereConditionPlaceholder')"
        spellcheck="false"
        rows="2"
        class="min-h-16 min-w-0 flex-1 resize-y bg-transparent px-2 py-1.5 font-mono text-xs leading-5 outline-none disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
    <p :id="`${id}-hint`" class="text-[11px] text-muted-foreground">{{ t("dataCompare.whereConditionHint") }}</p>
  </div>
</template>
