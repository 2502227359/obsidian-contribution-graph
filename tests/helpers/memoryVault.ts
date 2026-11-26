import { vi } from "vitest";
import type { StatisticsRecord } from "../../src/activity/StatisticsRepository";

export function persistedStatistics(contents: Iterable<string>): StatisticsRecord[] {
	const latest = new Map<string, StatisticsRecord>();
	for (const content of contents) {
		const value = JSON.parse(content);
		for (const record of (value.records ?? [value]) as StatisticsRecord[]) {
			if (record.kind !== "statistics") continue;
			if ((latest.get(record.id)?.revision ?? 0) < record.revision) latest.set(record.id, record);
		}
	}
	return [...latest.values()];
}

export function memoryVault(files = new Map<string, string>(), initialData: unknown = null) {
	const folders = new Set<string>();
	const listeners = new Map<string, Set<(...args: any[]) => void>>();
	const emit = (name: string, ...args: any[]) => listeners.get(name)?.forEach(listener => listener(...args));
	const file = (path: string) => ({ path, extension: path.split(".").pop() });
	const allFolders = () => {
		const result = new Set(folders);
		for (const path of files.keys()) {
			const parts = path.split("/");
			for (let i = 1; i < parts.length; i++) result.add(parts.slice(0, i).join("/"));
		}
		return result;
	};
	const vault = {
		adapter: {
			exists: vi.fn(async (path: string) => allFolders().has(path) || files.has(path)),
			read: vi.fn(async (path: string) => files.get(path) ?? JSON.stringify(initialData)),
			write: vi.fn(async (path: string, content: string) => { files.set(path, content); emit("modify", file(path)); }),
			list: vi.fn(async (path: string) => ({
				files: [...files.keys()].filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/")),
				folders: [...allFolders()].filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes("/")),
			})),
		},
		getAbstractFileByPath: (path: string) => files.has(path) ? file(path) : null,
		createFolder: async (path: string) => { folders.add(path); },
		delete: async (item: { path: string }) => { files.delete(item.path); emit("delete", item); },
		create: async (path: string, content: string) => { await vault.adapter.write(path, content); return file(path); },
		process: async (item: { path: string }, change: (value: string) => string) => {
			await vault.adapter.write(item.path, change(await vault.adapter.read(item.path)));
			return files.get(item.path)!;
		},
		on: (name: string, listener: (...args: any[]) => void) => {
			if (!listeners.has(name)) listeners.set(name, new Set());
			listeners.get(name)!.add(listener); return { name, listener };
		},
		offref: (ref: { name: string; listener: (...args: any[]) => void }) => { listeners.get(ref.name)?.delete(ref.listener); },
	};
	return vault;
}
