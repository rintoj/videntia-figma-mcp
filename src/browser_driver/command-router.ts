import type { CdpAdapter, BrowserTab } from "./cdp-adapter.js";

export interface CommandMessage {
  id: string;
  command: string;
  params?: any;
}

/**
 * Maps browser commands to CDP adapter calls.
 * Implements the same command interface as the Chrome extension's background.js
 */
export function createCommandRouter(adapter: CdpAdapter) {
  const tabGroups = new Map<string, Set<number>>(); // groupId -> Set<tabId>

  async function handle(msg: CommandMessage): Promise<any> {
    const { command, params } = msg;

    console.log(`[router] Handling command: ${command}`);

    try {
      switch (command) {
        // Tab management
        case "list_tabs":
          return { tabs: await adapter.tabs.list() };

        case "create_tab":
          return await adapter.tabs.create(params?.url || "about:blank");

        case "close_tab":
          await adapter.tabs.close(params.tabId);
          return { success: true };

        case "get_tab":
          return await adapter.tabs.get(params.tabId);

        case "query_tabs":
          return { tabs: await adapter.tabs.query(params?.filter || {}) };

        // Tab groups
        case "close_group":
          if (params?.groupId) {
            const tabs = tabGroups.get(params.groupId);
            if (tabs) {
              for (const tabId of tabs) {
                await adapter.tabs.close(tabId);
              }
              tabGroups.delete(params.groupId);
            }
          }
          return { success: true };

        // Screenshots
        case "get_page_screenshot":
          return await adapter.screenshot(params.tabId, params?.fullPage);

        // Page interactions
        case "click":
          return await adapter.scripting.executeScript(
            params.tabId,
            `
            (async () => {
              const el = document.elementFromPoint(${params.x || 0}, ${params.y || 0});
              if (el) el.click();
              return { success: true };
            })()
            `,
          );

        case "hover":
          return await adapter.scripting.executeScript(
            params.tabId,
            `
            (async () => {
              const el = document.elementFromPoint(${params.x || 0}, ${params.y || 0});
              if (el) {
                const event = new MouseEvent('mouseover', { bubbles: true });
                el.dispatchEvent(event);
              }
              return { success: true };
            })()
            `,
          );

        case "type_text":
          return await adapter.scripting.executeScript(
            params.tabId,
            `
            (async () => {
              const el = document.activeElement;
              if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
                el.value = ${JSON.stringify(params.text || "")};
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }
              return { success: true };
            })()
            `,
          );

        case "press_key":
          return await adapter.scripting.executeScript(
            params.tabId,
            `
            (async () => {
              const key = ${JSON.stringify(params.key || "")};
              const event = new KeyboardEvent('keydown', { key, bubbles: true });
              document.activeElement?.dispatchEvent(event);
              return { success: true };
            })()
            `,
          );

        case "scroll":
          return await adapter.scripting.executeScript(
            params.tabId,
            `
            window.scrollBy(${params.x || 0}, ${params.y || 0});
            { success: true }
            `,
          );

        // Page navigation
        case "navigate":
          const tab = await adapter.tabs.create(params.url);
          return tab;

        case "evaluate_js":
          return await adapter.scripting.executeScript(params.tabId, params.code || "");

        case "get_computed_styles":
          return await adapter.scripting.executeScript(
            params.tabId,
            `
            (async () => {
              const selector = ${JSON.stringify(params.selector || "")};
              const el = document.querySelector(selector);
              if (!el) return null;
              return window.getComputedStyle(el);
            })()
            `,
          );

        case "get_dom_nodes":
          return await adapter.scripting.executeScript(
            params.tabId,
            `
            (async () => {
              const selector = ${JSON.stringify(params.selector || "body")};
              const elements = document.querySelectorAll(selector);
              return Array.from(elements).map(el => ({
                tagName: el.tagName,
                id: el.id,
                className: el.className,
                text: el.textContent?.substring(0, 100),
              }));
            })()
            `,
          );

        // Storage
        case "clear_storage":
          return await adapter.scripting.executeScript(
            params.tabId,
            `
            (async () => {
              localStorage.clear();
              sessionStorage.clear();
              return { success: true };
            })()
            `,
          );

        // Viewport/Emulation
        case "set_viewport":
          // Note: This is limited in CDP; it's a placeholder
          return { success: true, warning: "Viewport control limited in CDP mode" };

        case "emulate":
          // Note: This is limited in CDP; it's a placeholder
          return { success: true, warning: "Emulation limited in CDP mode" };

        // Not yet implemented but return success for compatibility
        case "get_page_info":
          return { title: "", url: "" };

        case "get_ax_tree":
          return { tree: [] };

        case "read_console":
          return { messages: [] };

        case "read_network":
          return { requests: [] };

        case "inject_figma_overlay":
          return { success: true };

        case "clear_figma_overlay":
          return { success: true };

        case "capture_mhtml":
          return { mhtml: "" };

        default:
          console.warn(`[router] Unknown command: ${command}`);
          return { error: `Unknown command: ${command}` };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[router] Command failed: ${errorMsg}`);
      return { error: errorMsg };
    }
  }

  return { handle };
}
