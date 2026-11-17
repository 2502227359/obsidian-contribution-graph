import type { ActivityTimelineBlock, ActivityTimelineDay } from "../time/activityTimelineTypes";

export interface ActivityTimelineDetailsActions {
	onSelect(id: string): void;
	onClear(): void;
	onPrevious(): void;
	onNext(): void;
	onHourly?(): void;
	onOpen(path: string, event: MouseEvent | KeyboardEvent): void;
	fileExists(path: string): boolean;
}

export interface ActivityTimelineDetailsContext {
	day: ActivityTimelineDay;
	blocks: readonly ActivityTimelineBlock[];
	selectedId?: string;
}

export class ActivityTimelineDetails {
	readonly el: HTMLElement;
	private readonly owner: Document;

	constructor(owner: Document) {
		this.owner = owner;
		this.el = owner.createElement("section");
		this.el.className = "cg-activity-timeline-details";
		this.el.setAttribute("aria-live", "polite");
	}

	render(context: ActivityTimelineDetailsContext, actions: ActivityTimelineDetailsActions): void {
		this.el.replaceChildren();
		const {day, blocks, selectedId} = context;
		if(day.precision!=="DETAILED"||day.warnings.length)this.renderPrecision(day, actions);
		const selected = blocks.find(block => block.id === selectedId);
		this.el.hidden=day.precision==="DETAILED"&&!selected&&!day.warnings.length;
		if (!selected) {
			return;
		}
		this.renderSelected(selected, blocks, actions);
	}

	dispose(): void { this.el.replaceChildren(); }

	private renderPrecision(day: ActivityTimelineDay, actions: ActivityTimelineDetailsActions): void {
		const line = this.owner.createElement("div");
		line.className = "cg-activity-timeline-precision";
		line.appendChild(this.owner.createElement("strong")).textContent = precisionLabel(day.precision);
		const amount = day.totalSeconds > 0 ? durationLabel(day.totalSeconds) : "暂无已记录时长";
		line.appendChild(this.owner.createElement("span")).textContent = ` · ${amount}`;
		if ((day.precision === "SUMMARY_ONLY" || day.precision === "MIXED") && actions.onHourly) this.addAction(line, "查看小时汇总", actions.onHourly, "hourly");
		if (day.precision === "MIXED" && day.unlocatedSeconds) line.appendChild(this.owner.createElement("span")).textContent = ` · ${durationLabel(day.unlocatedSeconds)}仅有汇总`;
		if (day.precision === "INCONSISTENT") line.appendChild(this.owner.createElement("span")).textContent = " · 已保留可核对部分";
		this.el.appendChild(line);
		for (const warning of day.warnings.slice(0, 2)) this.addHint(warning);
	}

	private renderSelected(selected: ActivityTimelineBlock, blocks: readonly ActivityTimelineBlock[], actions: ActivityTimelineDetailsActions): void {
		const card = this.owner.createElement("div");
		card.className = "cg-activity-timeline-detail-card";
		const heading = card.createDiv({cls: "cg-activity-timeline-detail-heading"});
		heading.createEl("strong", {text: blockLabel(selected)});
		if (selected.activity) heading.createSpan({cls: "cg-activity-timeline-detail-kind", text: "独立活动"});
		if (selected.provisional) heading.createSpan({cls: "cg-activity-timeline-detail-kind", text: "含暂计尾段"});
		if (!selected.activity) card.createDiv({cls: "cg-activity-timeline-detail-path", text: selected.path});
		card.createDiv({cls: "cg-activity-timeline-detail-time", text: `${minuteLabel(selected.startMinute)}–${minuteLabel(selected.endMinute)} · ${durationLabel(selected.seconds)}`});
		const sources=[...new Set(blocks.map(block=>block.sourceId))].sort();
		if(sources.length>1)card.createDiv({cls:"cg-activity-timeline-detail-kind",text:`来源 ${sources.indexOf(selected.sourceId)+1} · ${offsetLabel(selected.offsetMinutes)}`});
		this.renderActions(card, selected, blocks, actions);
		this.renderRelated(card, selected, blocks, actions);
		this.el.appendChild(card);
	}

	private renderActions(parent: HTMLElement, selected: ActivityTimelineBlock, blocks: readonly ActivityTimelineBlock[], actions: ActivityTimelineDetailsActions): void {
		const controls = parent.createDiv({cls: "cg-activity-timeline-detail-actions", attr: {role: "group", "aria-label": "片段操作"}});
		this.addButton(controls, "上一段", actions.onPrevious, "previous", !previousBlock(blocks, selected.id));
		this.addButton(controls, "下一段", actions.onNext, "next", !nextBlock(blocks, selected.id));
		if (!selected.activity) {
			const exists = actions.fileExists(selected.path);
			this.addButton(controls, exists ? "打开笔记" : "文件已不存在", event => actions.onOpen(selected.path, event), "open", !exists);
		}
		this.addButton(controls, "清除选择", actions.onClear, "clear", false);
	}

	private renderRelated(parent: HTMLElement, selected: ActivityTimelineBlock, blocks: readonly ActivityTimelineBlock[], actions: ActivityTimelineDetailsActions): void {
		const related = blocks.filter(block => block.path === selected.path && block.id !== selected.id).sort(compareBlocks);
		if (!related.length) return;
		const section = parent.createDiv({cls: "cg-activity-timeline-related"});
		section.createDiv({cls: "cg-activity-timeline-related-label", text: selected.activity ? "本日其他活动片段" : "本日同篇片段"});
		for (const block of related) {
			const button = section.createEl("button", {cls: "cg-activity-timeline-related-item", attr: {type: "button"}});
			button.textContent = `${minuteLabel(block.startMinute)}–${minuteLabel(block.endMinute)} · ${durationLabel(block.seconds)}`;
			button.dataset.timelineSegment = block.id;
			button.onclick = () => actions.onSelect(block.id);
		}
	}

	private addButton(parent: HTMLElement, text: string, action: (event: MouseEvent | KeyboardEvent) => void, id: string, disabled: boolean): void {
		const button = parent.createEl("button", {text, attr: {type: "button", "aria-label": text}});
		button.dataset.timelineAction = id;
		button.disabled = disabled;
		button.onclick = event => action(event);
	}

	private addAction(parent: HTMLElement, text: string, action: () => void, id: string): void {
		const button = parent.createEl("button", {text, attr: {type: "button"}});
		button.dataset.timelineAction = id;
		button.onclick = action;
	}

	private addHint(text: string): void { this.el.createDiv({cls: "cg-activity-timeline-hint", text}); }
}

function precisionLabel(precision: ActivityTimelineDay["precision"]): string {
	return {EMPTY: "暂无片段", SUMMARY_ONLY: "只有小时汇总", MIXED: "片段与汇总并存", DETAILED: "片段明细", INCONSISTENT: "明细需要核对"}[precision];
}

function blockLabel(block: ActivityTimelineBlock): string { return block.activity ? "YOLO 对话活动" : (block.path.split("/").pop() || block.path).replace(/\.md$/i, ""); }

function previousBlock(blocks: readonly ActivityTimelineBlock[], id: string): ActivityTimelineBlock | undefined { const sorted = sortedBlocks(blocks), index = sorted.findIndex(block => block.id === id); return index > 0 ? sorted[index - 1] : undefined; }

function nextBlock(blocks: readonly ActivityTimelineBlock[], id: string): ActivityTimelineBlock | undefined { const sorted = sortedBlocks(blocks); const index = sorted.findIndex(block => block.id === id); return index >= 0 && index < sorted.length - 1 ? sorted[index + 1] : undefined; }

function sortedBlocks(blocks: readonly ActivityTimelineBlock[]): ActivityTimelineBlock[] { return [...blocks].sort(compareBlocks); }

function compareBlocks(left: ActivityTimelineBlock, right: ActivityTimelineBlock): number { return left.startMinute - right.startMinute || left.endMinute - right.endMinute || left.start - right.start || left.end - right.end || left.id.localeCompare(right.id); }

function minuteLabel(minutes: number): string { if (!Number.isFinite(minutes)) return "时间未知"; const total = Math.max(0, Math.round(minutes * 60)); if (total >= 86400) return "24:00:00"; return `${String(Math.floor(total / 3600)).padStart(2, "0")}:${String(Math.floor(total % 3600 / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`; }

function offsetLabel(offset:number):string {return `UTC${offset>=0?"+":"−"}${String(Math.floor(Math.abs(offset)/60)).padStart(2,"0")}:${String(Math.abs(offset)%60).padStart(2,"0")}`;}

function durationLabel(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return "0秒";
	if (seconds < 1) return "少于1秒";
	const value = Math.floor(seconds), hours = Math.floor(value / 3600), minutes = Math.floor(value % 3600 / 60), rest = value % 60;
	return [hours ? `${hours}小时` : "", minutes ? `${minutes}分` : "", rest ? `${rest}秒` : ""].filter(Boolean).join("") || "少于1分";
}
