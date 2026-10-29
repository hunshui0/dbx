// @vitest-environment happy-dom
import { createApp, defineComponent, h, nextTick, ref, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { ContextMenuItem } from "@/components/ui/CustomContextMenu.vue";
import type { ConnectionConfig, TreeNode } from "@/types/database";

vi.mock("@/lib/backend/api", async (original) => ({ ...(await original<typeof import("@/lib/backend/api")>()), listPlugins: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/common/clipboard", () => ({ copyToClipboard: vi.fn().mockResolvedValue(undefined) }));

import SidebarTreeRuntimeHost from "@/components/sidebar/SidebarTreeRuntimeHost.vue";
import { useConnectionStore } from "@/stores/connectionStore";
import { passwordViewerEnabled } from "@/lib/security/passwordViewer";
import { copyToClipboard } from "@/lib/common/clipboard";

const mountedApps: App<Element>[] = [];
const connection = { id: "pg-copy", name: "Postgres", db_type: "postgres", host: "db.example.com", port: 5432, username: "app", password: "stored-secret", database: "defaultdb", url_params: "password=query-secret&application_name=DBX" } as ConnectionConfig;
const node = (type: "connection" | "database"): TreeNode => ({ id: `${connection.id}:${type}`, type, label: type === "database" ? "reporting" : connection.name, connectionId: connection.id, ...(type === "database" ? { database: "reporting" } : {}) });
const flatten = (items: ContextMenuItem[]): ContextMenuItem[] => items.flatMap((item) => [item, ...flatten(item.children ?? [])]);

async function mountHost() {
  const pinia = createPinia();
  setActivePinia(pinia);
  useConnectionStore().connections = [connection];
  const host = ref<InstanceType<typeof SidebarTreeRuntimeHost> | null>(null);
  const app = createApp(defineComponent({ setup: () => () => h(SidebarTreeRuntimeHost, { ref: host, node: node("connection"), depth: 0 }) }));
  app.use(pinia);
  app.use(i18n);
  const container = document.createElement("div");
  document.body.appendChild(container);
  app.mount(container);
  mountedApps.push(app);
  await nextTick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
  return host.value as { buildContextMenu(node: TreeNode): ContextMenuItem[] };
}

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount();
  document.body.innerHTML = "";
  passwordViewerEnabled.value = true;
  vi.clearAllMocks();
});

describe("connection information copy menu", () => {
  it.each([true, false])("offers no password copies when password viewing is %s", async (enabled) => {
    passwordViewerEnabled.value = enabled;
    const host = await mountHost();
    for (const type of ["connection", "database"] as const) {
      const items = flatten(host.buildContextMenu(node(type)));
      const copy = items.find((item) => item.sidebarActionId === "contextMenu.copyConnectionInfo");
      expect(copy?.children?.map((item) => item.label)).toEqual(["copyConnectionUrl", "copyJdbcUrl", "copyHostPort", "copyDsn", "copyPsqlCommand"].map((key) => i18n.global.t(`contextMenu.${key}`)));
      for (const item of copy!.children!) await item.action?.();
      const calls = vi.mocked(copyToClipboard).mock.calls;
      expect(calls.length).toBe(5);
      for (const [text] of calls) {
        expect(text).not.toContain("stored-secret");
        expect(text).not.toContain("query-secret");
      }
      expect(calls[0][0]).toContain(type === "database" ? "/reporting?" : "/defaultdb?");
      vi.mocked(copyToClipboard).mockClear();
    }
  });
});
