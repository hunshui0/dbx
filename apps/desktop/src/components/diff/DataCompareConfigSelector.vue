<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Download, Pencil, Plus, Trash2, Upload } from "@lucide/vue";
import { isTauriRuntime } from "@/lib/backend/tauriRuntime";
import type { DataCompareConfig } from "@/composables/useDataCompareConfig";

const props = defineProps<{
  configs: DataCompareConfig[];
  activeConfigId: string;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: "update:activeConfigId", id: string): void;
  (e: "create"): void;
  (e: "rename", id: string, name: string): void;
  (e: "delete", id: string): void;
  (e: "duplicate", id: string): void;
  (e: "export", config: DataCompareConfig | null): void;
  (e: "exportAll", configs: DataCompareConfig[]): void;
  (e: "import", jsonText: string): void;
}>();

const { t } = useI18n();

const renameDialogOpen = ref(false);
const renameValue = ref("");
const renamingId = ref("");

const importDialogOpen = ref(false);
const importValue = ref("");
const importError = ref("");
const fileInputRef = ref<HTMLInputElement | null>(null);

const activeConfig = computed(() => props.configs.find((config) => config.id === props.activeConfigId) ?? null);

function onSelectChange(value: unknown) {
  emit("update:activeConfigId", String(value));
}

function startRename(config: DataCompareConfig) {
  renamingId.value = config.id;
  renameValue.value = config.name;
  renameDialogOpen.value = true;
}

function confirmRename() {
  if (renamingId.value && renameValue.value.trim()) {
    emit("rename", renamingId.value, renameValue.value.trim());
  }
  renameDialogOpen.value = false;
}

function openImportDialog() {
  importError.value = "";
  importValue.value = "";
  importDialogOpen.value = true;
}

function submitImportJson(rawText: string) {
  importError.value = "";
  try {
    JSON.parse(rawText);
  } catch {
    importError.value = t("dataCompare.configImportInvalid");
    return;
  }
  emit("import", rawText);
  importDialogOpen.value = false;
  importValue.value = "";
}

async function handleChooseImportFile() {
  importError.value = "";
  if (isTauriRuntime()) {
    try {
      const [{ open }, { readTextFile }] = await Promise.all([import("@tauri-apps/plugin-dialog"), import("@tauri-apps/plugin-fs")]);
      const selected = await open({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!selected || typeof selected !== "string") return;
      const content = await readTextFile(selected);
      submitImportJson(content);
    } catch {
      importError.value = t("dataCompare.configImportInvalid");
    }
    return;
  }
  fileInputRef.value?.click();
}

async function onImportFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const content = await file.text();
    submitImportJson(content);
  } catch {
    importError.value = t("dataCompare.configImportInvalid");
  } finally {
    input.value = "";
  }
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <Select :model-value="activeConfigId" :disabled="disabled" @update:model-value="onSelectChange">
      <SelectTrigger class="h-8 min-w-[200px] text-xs" data-testid="data-compare-config-select">
        <SelectValue :placeholder="t('dataCompare.configSelect')" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem v-for="config in configs" :key="config.id" :value="config.id"> {{ config.name }} ({{ t("dataCompare.configTableCount", { count: config.selectedSourceTables.length }) }}) </SelectItem>
      </SelectContent>
    </Select>

    <Button variant="outline" size="icon" class="h-8 w-8" :disabled="disabled" :title="t('dataCompare.configNew')" :aria-label="t('dataCompare.configNew')" data-testid="data-compare-config-create" @click="emit('create')">
      <Plus class="h-4 w-4" />
    </Button>

    <Button v-if="activeConfig" variant="outline" size="icon" class="h-8 w-8" :disabled="disabled" :title="t('dataCompare.configRename')" :aria-label="t('dataCompare.configRename')" data-testid="data-compare-config-rename" @click="startRename(activeConfig)">
      <Pencil class="h-4 w-4" />
    </Button>

    <Button v-if="activeConfig" variant="outline" size="icon" class="h-8 w-8" :disabled="disabled" :title="t('dataCompare.configDuplicate')" :aria-label="t('dataCompare.configDuplicate')" data-testid="data-compare-config-duplicate" @click="emit('duplicate', activeConfig.id)">
      <Copy class="h-4 w-4" />
    </Button>

    <Button v-if="activeConfig" variant="outline" size="icon" class="h-8 w-8" :disabled="disabled" :title="t('dataCompare.configDelete')" :aria-label="t('dataCompare.configDelete')" data-testid="data-compare-config-delete" @click="emit('delete', activeConfig.id)">
      <Trash2 class="h-4 w-4" />
    </Button>

    <Button variant="outline" size="sm" class="h-8 gap-1 px-2.5 text-xs" :disabled="disabled" :title="t('dataCompare.configExport')" :aria-label="t('dataCompare.configExport')" data-testid="data-compare-config-export" @click="emit('export', activeConfig)">
      <Download class="h-3.5 w-3.5" />
      {{ t("dataCompare.configExport") }}
    </Button>

    <Button v-if="configs.length > 0" variant="outline" size="sm" class="h-8 gap-1 px-2.5 text-xs" :disabled="disabled" :title="t('dataCompare.configExportAll')" :aria-label="t('dataCompare.configExportAll')" data-testid="data-compare-config-export-all" @click="emit('exportAll', configs)">
      <Download class="h-3.5 w-3.5" />
      {{ t("dataCompare.configExportAll") }}
    </Button>

    <Button variant="outline" size="sm" class="h-8 gap-1 px-2.5 text-xs" :disabled="disabled" :title="t('dataCompare.configImport')" :aria-label="t('dataCompare.configImport')" data-testid="data-compare-config-import" @click="openImportDialog">
      <Upload class="h-3.5 w-3.5" />
      {{ t("dataCompare.configImport") }}
    </Button>

    <Dialog v-model:open="renameDialogOpen">
      <DialogContent class="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{{ t("dataCompare.configRename") }}</DialogTitle>
        </DialogHeader>
        <div class="py-4">
          <Label class="text-sm">{{ t("dataCompare.configName") }}</Label>
          <Input v-model="renameValue" class="mt-2" data-testid="data-compare-config-rename-input" autofocus @keydown.enter="confirmRename" />
        </div>
        <DialogFooter>
          <Button variant="outline" @click="renameDialogOpen = false">{{ t("common.cancel") }}</Button>
          <Button data-testid="data-compare-config-rename-save" @click="confirmRename">{{ t("common.save") }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="importDialogOpen">
      <DialogContent class="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{{ t("dataCompare.configImport") }}</DialogTitle>
        </DialogHeader>
        <div class="space-y-3 py-2">
          <div class="flex items-center gap-2">
            <input ref="fileInputRef" type="file" accept=".json,application/json" class="hidden" data-testid="data-compare-config-import-file-input" @change="onImportFileChange" />
            <Button type="button" variant="outline" size="sm" class="h-8 gap-1.5 text-xs" data-testid="data-compare-config-import-file-btn" @click="handleChooseImportFile">
              <Upload class="h-3.5 w-3.5" />
              {{ t("dataCompare.configImportSelectFile") }}
            </Button>
          </div>
          <textarea v-model="importValue" rows="8" class="w-full rounded-md border bg-background p-2.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring" :placeholder="t('dataCompare.configImportPlaceholder')" data-testid="data-compare-config-import-input" />
          <p v-if="importError" class="text-xs text-destructive" data-testid="data-compare-config-import-error">{{ importError }}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" @click="importDialogOpen = false">{{ t("common.cancel") }}</Button>
          <Button :disabled="!importValue.trim()" data-testid="data-compare-config-import-confirm" @click="submitImportJson(importValue)">{{ t("dataCompare.configImportAction") }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
