import { TFile, Vault } from "obsidian";
import { StatisticsFiles } from "./StatisticsRepository";

export class VaultStatisticsFiles implements StatisticsFiles {
	constructor(private readonly vault: Vault, readonly folder: string) {
		if (!folder || folder.split("/").some(part => !part || part.startsWith(".") || part.includes(":")) || folder.includes("\\")) {
			throw new Error("统计目录必须是仓库中的普通相对路径");
		}
	}

	async list(): Promise<string[]> {
		if (!await this.vault.adapter.exists(this.folder)) return [];
		return (await this.listFolder(this.folder)).map(path => path.slice(this.folder.length + 1));
	}

	read(path: string): Promise<string> {
		return this.vault.adapter.read(`${this.folder}/${path}`);
	}

	async write(path: string, data: string): Promise<void> {
		const target = `${this.folder}/${path}`;
		await this.ensureFolders(target.split("/").slice(0, -1).join("/"));
		const file = this.vault.getAbstractFileByPath(target);
		if (file && "extension" in file) await this.vault.process(file as TFile, () => data);
		else await this.vault.create(target, data);
	}

	async remove(path: string): Promise<void> {
		const file = this.vault.getAbstractFileByPath(`${this.folder}/${path}`);
		if (file) await this.vault.delete(file);
	}

	writeSync(path: string, data: string): boolean {
		return this.writeVaultFileSync(`${this.folder}/${path}`, data);
	}

	writeConfigurationSync(pluginDir: string, data: string): boolean {
		return this.writeVaultFileSync(`${pluginDir}/data.json`, data);
	}

	private writeVaultFileSync(relativePath: string, data: string): boolean {
		const adapter = this.vault.adapter as unknown as {getBasePath?: () => string};
		if (typeof adapter.getBasePath !== "function" || typeof require !== "function") return false;
		const fs: typeof import("fs") = require("fs"), path: typeof import("path") = require("path");
		const base = fs.realpathSync(adapter.getBasePath());
		const target = path.resolve(base, relativePath);
		this.assertInsideVault(base, target, path);
		let ancestor = path.dirname(target);
		while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
		this.assertInsideVault(base, fs.realpathSync(ancestor), path);
		fs.mkdirSync(path.dirname(target), {recursive: true});
		this.assertInsideVault(base, fs.realpathSync(path.dirname(target)), path);
		const temporary = `${target}.${crypto.randomUUID()}.tmp`;
		fs.writeFileSync(temporary, data, "utf8");
		const fd = fs.openSync(temporary, "r+");
		try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
		fs.renameSync(temporary, target);
		if (fs.readFileSync(target, "utf8") !== data) throw new Error("退出检查点写入校验失败");
		return true;
	}

	private assertInsideVault(base: string, target: string, path: typeof import("path")): void {
		const relative = path.relative(base, target);
		if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("退出保存路径超出仓库");
	}

	subscribe(listener: () => void): () => void {
		const matches = (path: string) => path.startsWith(`${this.folder}/记录/`) && path.endsWith(".json");
		const refs = [
			this.vault.on("create", file => { if (matches(file.path)) listener(); }),
			this.vault.on("modify", file => { if (matches(file.path)) listener(); }),
			this.vault.on("delete", file => { if (matches(file.path)) listener(); }),
			this.vault.on("rename", (file, oldPath) => { if (matches(file.path) || matches(oldPath)) listener(); }),
		];
		return () => refs.forEach(ref => this.vault.offref(ref));
	}

	private async listFolder(folder: string): Promise<string[]> {
		const listing = await this.vault.adapter.list(folder);
		const nested = await Promise.all(listing.folders.map(path => this.listFolder(path)));
		return [...listing.files, ...nested.reduce<string[]>((all, paths) => all.concat(paths), [])]
			.filter(path => path.startsWith(`${this.folder}/`));
	}

	private async ensureFolders(folder: string): Promise<void> {
		let path = "";
		for (const part of folder.split("/")) {
			path = path ? `${path}/${part}` : part;
			if (await this.vault.adapter.exists(path)) continue;
			try { await this.vault.createFolder(path); }
			catch (error) { if (!await this.vault.adapter.exists(path)) throw error; }
		}
	}
}
