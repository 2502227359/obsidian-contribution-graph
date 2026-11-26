import { Notice, Vault } from "obsidian";
import { AI_EDIT_BRIDGE, AiEditEvent, AiEditPolicy, AiNoteEdit, formatAiEditDate, isAiNotePath, isStatisticsPath, parseAiEditEvent } from "./aiEditProtocol";
import { AiEditSpool, createAiEditSpool } from "./aiEditSpool";
import { ActiveEditorCheckResult, AiEditBridgeServer } from "./AiEditBridgeServer";
import { isFileInCollectionScope } from "./folderScope";
import { calculateAiNoteChanges } from "./aiNoteDiff";

type AiEditVault = Vault & { [AI_EDIT_BRIDGE]?: (note: AiNoteEdit) => Promise<void> };

export interface AiEditIntakeOptions {
	checkActiveEditor?: (path: string, diskContent: string) => ActiveEditorCheckResult;
	pluginVersion?: string;
	enableLiveBridge?: boolean;
}

export class AiEditIntake {
	private readonly spool?: AiEditSpool;
	private readonly bridge?: AiEditBridgeServer;
	private timer?: number;
	private draining?: Promise<void>;
	private directSave = Promise.resolve();
	private failed = false;
	private stopped = false;
	private readonly receive = (note: AiNoteEdit) => this.acceptNote(note);

	constructor(
		private readonly vault: AiEditVault,
		private readonly policy: () => AiEditPolicy,
		private readonly save: (events: readonly AiEditEvent[]) => Promise<void>,
		options: AiEditIntakeOptions = {},
	) {
		const adapter = vault.adapter as typeof vault.adapter & { getBasePath?(): string };
		const root = adapter.getBasePath?.();
		if (root && typeof require === "function") {
			try { this.spool = createAiEditSpool(root); }
			catch (error) { this.report(error); }
		}
		if (this.spool && options.enableLiveBridge !== false && typeof require === "function") {
			try {
				this.bridge = new AiEditBridgeServer({
					vault,
					spool: this.spool,
					policy,
					saveEvents: save,
					checkActiveEditor: options.checkActiveEditor,
					pluginVersion: options.pluginVersion,
				});
			} catch (error) {
				console.warn("本地 AI 写入桥接初始化跳过", error);
			}
		}
	}

	start(): void {
		this.vault[AI_EDIT_BRIDGE] = this.receive;
		this.publish();
		if (this.bridge) {
			void this.bridge.start().catch(error => console.warn("本地 AI 写入桥接启动失败，已回退为本机队列模式", error));
		}
		if (!this.spool) return;
		this.timer = window.setInterval(() => { void this.drain(); }, 1500);
		void this.drain();
	}

	stop(): Promise<void> {
		this.stopped = true;
		if (this.timer !== undefined) window.clearInterval(this.timer);
		if (this.vault[AI_EDIT_BRIDGE] === this.receive) delete this.vault[AI_EDIT_BRIDGE];
		return Promise.all([this.draining, this.directSave, this.bridge?.stop()]).then(() => undefined);
	}

	publish(): void {
		try { this.spool?.publish(this.policy()); }
		catch (error) { this.report(error); }
	}

	private async acceptNote(note: AiNoteEdit): Promise<void> {
		const policy = this.policy();
		if (this.stopped || !policy.enabled || !isAiNotePath(note.path) ||
			isStatisticsPath(note.path, policy.statisticsFolder) ||
			!isFileInCollectionScope(note.path, policy.trackedFolders, policy.trackedFiles)) return;
		let counts;
		try {
			counts = calculateAiNoteChanges(note.before, note.after, policy);
		} catch (error) {
			console.warn("AI 编辑字符统计计算失败，已跳过本次统计", error);
			return;
		}
		if (counts.addedChars + counts.deletedChars === 0) return;
		const { id, path, source, occurredAt } = note;
		const event = parseAiEditEvent({
			version: 1, id, path, source, occurredAt, date: formatAiEditDate(occurredAt),
			generation: policy.generation, ...counts,
		});
		if (!event) throw new Error("AI 编辑记录无效");
		if (!this.spool) {
			const save = this.directSave.catch(() => undefined).then(() => this.save([event]));
			this.directSave = save.catch(error => this.report(error));
			return save;
		}
		this.spool.queue(event);
		await this.drain();
	}

	private drain(): Promise<void> {
		if (this.draining) return this.draining;
		if (this.stopped || !this.spool) return Promise.resolve();
		const spool = this.spool;
		this.draining = Promise.resolve().then(async () => {
			if (this.stopped) return;
			const events = await spool.readAsync();
			if (!events.length) return;
			await this.save(events);
			spool.acknowledge(events);
			this.failed = false;
		}).catch(error => this.report(error)).finally(() => { this.draining = undefined; });
		return this.draining;
	}

	private report(error: unknown): void {
		console.error("AI 编辑统计暂无法处理", error);
		if (!this.failed) new Notice("AI 编辑统计暂无法处理，待写入的记录将保留。");
		this.failed = true;
	}
}
