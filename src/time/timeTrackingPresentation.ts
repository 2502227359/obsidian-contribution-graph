import { TimeStatusReason, TimeTrackingSnapshot } from "./types";

const STATUS_TEXT: Record<TimeStatusReason, string> = {
	DISABLED: "时长：未启用",
	MANUAL: "时长：手动暂停",
	BACKGROUND: "时长：后台暂停",
	MODAL: "时长：弹窗暂停",
	NO_MARKDOWN: "时长：当前页面不计时",
	OUT_OF_SCOPE: "时长：范围外",
	OUTSIDE_EDITOR: "时长：等待正文操作",
	INTERRUPTED: "时长：计时已中断",
	IDLE: "时长：空闲暂停",
	ACTIVE: "时长：计时中",
};

function formatDuration(seconds: number): string {
	const totalSeconds = Number.isFinite(seconds)
		? Math.max(0, Math.floor(seconds))
		: 0;
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const remainder = totalSeconds % 60;
	const parts: string[] = [];
	if (hours > 0) parts.push(`${hours}小时`);
	if (minutes > 0 || hours > 0) parts.push(`${minutes}分`);
	if (remainder > 0 || parts.length === 0) parts.push(`${remainder}秒`);
	return parts.join("");
}

function formatTimestamp(timestamp: number): string {
	const date = new Date(timestamp);
	if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) return "未知时间";
	const pad = (value: number): string => String(value).padStart(2, "0");
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
		date.getDate()
	)} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatRemaining(remainingMs: number): string | undefined {
	if (!Number.isFinite(remainingMs) || remainingMs <= 0) return undefined;
	const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
	return `距离空闲阈值：约${minutes}分钟`;
}

function getDiscardDescription(discard: NonNullable<TimeTrackingSnapshot["lastDiscard"]>): string[] {
	const reason = discard.reason === "idle" ? "空闲" : "中断";
	const lines = [
		`最近一次${reason}回撤笔记：${discard.path}`,
		`空闲开始：${formatTimestamp(discard.start)}，检测于：${formatTimestamp(
			discard.detectedAt
		)}`,
	];
	if (discard.recordedSeconds > 0) {
		lines.push(`已撤回本次${reason}暂计：${formatDuration(discard.recordedSeconds)}`);
		if (discard.unrecordedSeconds > 0) {
			lines.push(`另有${formatDuration(discard.unrecordedSeconds)}未曾计入`);
		}
	} else {
		const prefix = discard.reason === "idle" ? "空闲已暂停" : "计时已中断";
		lines.push(`${prefix}，该段未计入：${formatDuration(discard.unrecordedSeconds)}`);
	}
	return lines;
}

function getTimeTrackingActionDescription(snapshot: TimeTrackingSnapshot): string[] {
	if (!snapshot.enabled) {
		return ["请先在设置中开启全局时长统计；本按钮不会隐式开启。"];
	}
	if (snapshot.manualPaused || snapshot.reason === "MANUAL") {
		return [
			"仅暂停本次时长采集，字数统计仍按原开关运行",
			"插件重载或应用重开后临时暂停会解除",
			"单击恢复本次时长统计",
		];
	}
	return ["单击暂停本次时长统计"];
}

export function getTimeTrackingStatusText(
	snapshot: TimeTrackingSnapshot
): string {
	return STATUS_TEXT[snapshot.reason];
}

export function getTimeTrackingDescription(
	snapshot: TimeTrackingSnapshot
): string {
	const lines = [
		getTimeTrackingStatusText(snapshot).replace("时长：", "时长统计："),
	];
	if (snapshot.path) lines.push(`当前笔记：${snapshot.path}`);
	lines.push(`今日累计：${formatDuration(snapshot.todaySeconds)}，按当前全局采集范围，多端汇总`);
	if (snapshot.todayPendingSeconds > 0) {
		lines.push(
			`其中本机今日暂计：${formatDuration(
				snapshot.todayPendingSeconds
			)}，已含在今日累计中`
		);
		lines.push("本机暂计仅表示当前运行，不能把其余累计量视为全部已确认。");
	}

	const remaining = formatRemaining(snapshot.remainingMs);
	if (remaining) {
		lines.push(remaining);
	} else if (snapshot.reason === "ACTIVE") {
		lines.push("已到空闲阈值，等待计时检查");
	}

	if (snapshot.lastDiscard) lines.push(...getDiscardDescription(snapshot.lastDiscard));
	lines.push(...getTimeTrackingActionDescription(snapshot));
	return lines.join("\n");
}
