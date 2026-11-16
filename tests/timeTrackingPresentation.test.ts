import { describe, expect, it } from "vitest";
import {
	getTimeTrackingDescription,
	getTimeTrackingStatusText,
} from "../src/time/timeTrackingPresentation";
import { TimeTrackingSnapshot } from "../src/time/types";

function createSnapshot(
	override: Partial<TimeTrackingSnapshot> = {}
): TimeTrackingSnapshot {
	return {
		reason: "ACTIVE",
		path: "临床医学/内科学/心律失常.md",
		manualPaused: false,
		enabled: true,
		todaySeconds: 37 * 60,
		todayPendingSeconds: 2 * 60 + 10,
		remainingMs: 3 * 60 * 1000,
		...override,
	};
}

describe("时长状态展示", () => {
	it("为每一种状态原因生成稳定的短状态", () => {
		const reasons: Array<[TimeTrackingSnapshot["reason"], string]> = [
			["DISABLED", "时长：未启用"],
			["MANUAL", "时长：手动暂停"],
			["BACKGROUND", "时长：后台暂停"],
			["MODAL", "时长：弹窗暂停"],
			["NO_MARKDOWN", "时长：当前页面不计时"],
			["OUT_OF_SCOPE", "时长：范围外"],
			["OUTSIDE_EDITOR", "时长：等待正文操作"],
			["INTERRUPTED", "时长：计时已中断"],
			["IDLE", "时长：空闲暂停"],
			["ACTIVE", "时长：计时中"],
		];

		for (const [reason, expected] of reasons) {
			expect(getTimeTrackingStatusText(createSnapshot({ reason }))).toBe(
				expected
			);
		}
	});

	it("说明本机暂计、多端总量、约数余量和真实空闲回撤", () => {
		const description = getTimeTrackingDescription(
			createSnapshot({
				todaySeconds: 3661,
				todayPendingSeconds: 130,
				remainingMs: 121000,
				lastDiscard: {
					path: "临床医学/内科学/心律失常.md",
					start: 1000,
					detectedAt: 301000,
					recordedSeconds: 285,
					unrecordedSeconds: 15,
					reason: "idle",
				},
			})
		);

		expect(description).toContain("当前笔记：临床医学/内科学/心律失常.md");
		expect(description).toContain(
			"今日累计：1小时1分1秒，按当前全局采集范围，多端汇总"
		);
		expect(description).toContain(
			"其中本机今日暂计：2分10秒，已含在今日累计中"
		);
		expect(description).toContain("距离空闲阈值：约3分钟");
		expect(description).toContain("已撤回本次空闲暂计：4分45秒");
		expect(description).toContain("另有15秒未曾计入");
	});

	it("手动暂停说明不影响字数统计，阈值到达时不提前宣布回撤", () => {
		const description = getTimeTrackingDescription(
			createSnapshot({ reason: "MANUAL", manualPaused: true, remainingMs: 120000 })
		);

		expect(description).toContain("仅暂停本次时长采集，字数统计仍按原开关运行");
		expect(description).toContain("插件重载或应用重开后临时暂停会解除");
		expect(description).toContain("距离空闲阈值：约2分钟");

		const thresholdDescription = getTimeTrackingDescription(
			createSnapshot({ reason: "ACTIVE", remainingMs: 0 })
		);
		expect(thresholdDescription).toContain("已到空闲阈值，等待计时检查");
	});

	it("没有暂计或回撤时不虚构相关数据", () => {
		const description = getTimeTrackingDescription(
			createSnapshot({
				path: undefined,
				todayPendingSeconds: 0,
				lastDiscard: {
					path: "甲.md",
					start: 0,
					detectedAt: 60_000,
					recordedSeconds: 0,
					unrecordedSeconds: 60,
					reason: "idle",
				},
			})
		);

		expect(description).not.toContain("本机今日暂计：0秒");
		expect(description).toContain("空闲已暂停，该段未计入：1分");
		expect(description).not.toContain("已撤回本次空闲暂计");
	});
});
