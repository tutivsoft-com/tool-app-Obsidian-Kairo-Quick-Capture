import { Menu, Notice, Plugin, TAbstractFile, TFile, TFolder } from "obsidian";

/** Snapshot eligible files recursively, preserving selection order and processing overlaps once. */
export function selectedFiles(entries: readonly TAbstractFile[], accepts: (file: TFile) => boolean): TFile[] {
  const files = new Map<string, TFile>();
  const folders = new Set<string>();
  const visit = (entry: TAbstractFile): void => {
    if (entry instanceof TFile) { if (accepts(entry) && !files.has(entry.path)) files.set(entry.path, entry); }
    else if (entry instanceof TFolder && !folders.has(entry.path)) {
      folders.add(entry.path);
      for (const child of [...entry.children]) visit(child);
    }
  };
  for (const entry of entries) visit(entry);
  return [...files.values()];
}
export const markdownFile = (file: TFile): boolean => file.extension.toLowerCase() === "md";

/** Add missing folder/multi-selection actions while retaining existing single-file menus. */
export function registerSelectionAction(plugin: Plugin, config: {
  name: string; icon: string; accepts: (file: TFile) => boolean;
  run: (files: TFile[]) => Promise<unknown> | unknown; folders?: boolean; multiple?: boolean;
}): void {
  const add = (menu: Menu, entries: TAbstractFile[]): void => {
    const files = selectedFiles(entries, config.accepts);
    if (!files.length) return;
    menu.addItem(item => item.setTitle(`${config.name} (${files.length} file${files.length === 1 ? "" : "s"})`)
      .setIcon(config.icon).onClick(async () => {
        try { await config.run(files); }
        catch { new Notice(`${config.name}: operation failed. Check the status and try again.`); }
      }));
  };
  if (config.folders) plugin.registerEvent(plugin.app.workspace.on("file-menu", (menu, entry) => {
    if (entry instanceof TFolder) add(menu, [entry]);
  }));
  if (config.multiple !== false) plugin.registerEvent(plugin.app.workspace.on("files-menu", add));
}
