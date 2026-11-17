import { describe, expect, it } from "vitest";
import { IdleTimeDiscard, TimeSpan } from "../src/time/types";
import { TimeTracker } from "../src/time/timeTracker";

function createClock(start = 0) {

	let wall = start;
	let monotonic = start;
	return {
		clock: {
			wall: () => wall,
			monotonic: () => monotonic,
		},
		advance(milliseconds: number) {
			wall += milliseconds;
			monotonic += milliseconds;
		},
		setWall(value: number) {
			wall = value;
		},
	};
}

describe("活跃时长会话", () => {
	it("到期结果区分已撤回二百八十五秒与未计十五秒，重复检查不重报", () => {
		const clock = createClock(1000), discarded: IdleTimeDiscard[] = [];
		const tracker = new TimeTracker(() => undefined, clock.clock, 5, result => discarded.push(result));
		tracker.activity("甲.md");
		for (let i = 0; i < 20; i++) { clock.advance(15000); tracker.checkpoint(); }
		tracker.pause(); tracker.checkpoint();
		expect(discarded).toEqual([{ path: "甲.md", start: 1000, detectedAt: 301000,
			recordedSeconds: 285, unrecordedSeconds: 15, reason: "idle" }]);
	});
	it("没有已计尾段时仍报告未计区间，中断回撤保留中断原因", () => {
		const clock = createClock(0), discarded: IdleTimeDiscard[] = [];
		const tracker = new TimeTracker(() => undefined, clock.clock, 1, result => discarded.push(result));
		tracker.activity("甲.md"); clock.advance(60000); tracker.checkpoint();
		expect(discarded[0]).toMatchObject({ recordedSeconds: 0, unrecordedSeconds: 60, reason: "idle" });
		tracker.activity("甲.md"); clock.advance(15000); tracker.checkpoint();
		clock.advance(120000); tracker.checkpoint();
		expect(discarded[1]).toMatchObject({ recordedSeconds: 15, unrecordedSeconds: 120, reason: "interrupted" });
		expect(tracker.getSnapshot().interrupted).toBe(true);
	});
	it("读取快照只展示已计暂计量和单调时钟余量，不充当活动或心跳", () => {
		const clock = createClock(1000);
		const spans: TimeSpan[] = [];
		const tracker = new TimeTracker(span => spans.push(span), clock.clock);
		tracker.activity("甲.md"); clock.advance(15000); tracker.checkpoint();
		clock.advance(10000);
		expect(tracker.getSnapshot()).toMatchObject({
			status: "ACTIVE", path: "甲.md", pendingSeconds: 15,
			pendingStart: 1000, pendingEnd: 16000, remainingMs: 275000,
		});
		clock.setWall(999999);
		expect(tracker.getSnapshot().remainingMs).toBe(275000);
		expect(spans).toHaveLength(1);
		clock.setWall(26000); clock.advance(51000);
		tracker.getSnapshot(); tracker.checkpoint();
		expect(tracker.getSnapshot().interrupted).toBe(true);
		expect(spans).toHaveLength(1);
	});
	it("墙钟前跳三十秒时丢弃未确认的区间", () => {
		const clock = createClock(0);
		const spans: TimeSpan[] = [];
		const tracker = new TimeTracker(span => spans.push(span), clock.clock);
		tracker.activity("甲.md"); clock.advance(15000); tracker.checkpoint();
		clock.setWall(45000); clock.advance(15000); tracker.checkpoint();
		expect(spans.reduce((sum, span) => sum + span.seconds, 0)).toBe(15);
		expect(tracker.getStatus()).toBe("IDLE");
	});
	it("满五分钟后撤回空闲尾段，保留此前活跃时长且只撤回一次", () => {
		const clock = createClock(Date.UTC(2026, 0, 1, 9));
		const spans: TimeSpan[] = [];
		const removed: TimeSpan[] = [];
		const tracker = new TimeTracker((span, operation) => {
			(operation === "remove" ? removed : spans).push(span);
		}, clock.clock);

		tracker.activity("Notes/a.md");
		for (let index = 0; index < 8; index++) {
			clock.advance(15 * 1000);
			tracker.checkpoint();
		}
		tracker.activity("Notes/a.md");
		for (let index = 0; index < 20; index++) {
			clock.advance(15 * 1000);
			tracker.checkpoint();
		}

		expect(spans.length).toBeGreaterThan(1);
		expect(spans.every((span) => span.path === "Notes/a.md")).toBe(true);
		expect(spans.reduce((sum, span) => sum + span.seconds, 0) - removed.reduce((sum, span) => sum + span.seconds, 0)).toBe(2 * 60);
		expect(removed[0]).toMatchObject({
			path: "Notes/a.md", start: Date.UTC(2026, 0, 1, 9, 2),
			end: Date.UTC(2026, 0, 1, 9, 6, 45), seconds: 285,
			continuityId: expect.any(String),
		});
		expect(removed[0].continuityId).toBe(spans[spans.length - 1].continuityId);
		expect(tracker.getStatus()).toBe("IDLE");
		clock.advance(15000); tracker.checkpoint(); tracker.pause();
		expect(removed).toHaveLength(1);
	});

	it("同一会话的增量和回撤共用连续身份，切换会话时更换身份", () => {
		const clock = createClock(0);
		const events: Array<{ span: TimeSpan; operation: "add" | "remove" }> = [];
		const tracker = new TimeTracker((span, operation) => events.push({ span, operation }), clock.clock, 1);
		tracker.activity("a.md");
		clock.advance(15000);
		tracker.checkpoint();
		const first = tracker.getSnapshot().continuityId;
		clock.advance(60000);
		tracker.checkpoint();
		tracker.activity("b.md");
		const second = tracker.getSnapshot().continuityId;
		expect(first).toEqual(expect.any(String));
		expect(second).toEqual(expect.any(String));
		expect(second).not.toBe(first);
		expect(events.every(({ span }) => span.continuityId === first)).toBe(true);
	});

	it.each(["checkpoint", "activity", "pause"] as const)("%s 在到期后的首次调用也会撤回，重新操作不补计", entry => {
		const clock = createClock(0);
		let seconds = 0;
		const tracker = new TimeTracker((span, operation) => {
			seconds += operation === "remove" ? -span.seconds : span.seconds;
		}, clock.clock);
		tracker.activity("甲.md");
		for (let i = 0; i < 19; i++) { clock.advance(15000); tracker.checkpoint(); }
		expect(seconds).toBe(285);
		clock.advance(16000);
		if (entry === "activity") tracker.activity("甲.md"); else tracker[entry]();
		expect(seconds).toBe(0);
		tracker.activity("甲.md"); clock.advance(15000); tracker.pause();
		expect(seconds).toBe(15);
	});

	it("阈值前一毫秒恢复操作则保留该间隔", () => {
		const clock = createClock(0);
		let seconds = 0;
		const tracker = new TimeTracker((span, operation) => {
			seconds += operation === "remove" ? -span.seconds : span.seconds;
		}, clock.clock);
		tracker.activity("甲.md");
		for (let i = 0; i < 19; i++) { clock.advance(15000); tracker.checkpoint(); }
		clock.advance(14999); tracker.activity("甲.md");
		expect(seconds).toBeCloseTo(299.999);
		expect(tracker.getStatus()).toBe("ACTIVE");
	});

	it.each(["checkpoint", "activity", "pause"] as const)("%s 在长心跳中断后到达阈值也撤回已计尾段", entry => {
		const clock = createClock(0);
		let seconds = 0;
		const tracker = new TimeTracker((span, operation) => {
			seconds += operation === "remove" ? -span.seconds : span.seconds;
		}, clock.clock);
		tracker.activity("甲.md");
		for (let i = 0; i < 19; i++) { clock.advance(15000); tracker.checkpoint(); }
		clock.advance(120000);
		if (entry === "activity") tracker.activity("甲.md"); else tracker[entry]();
		expect(seconds).toBe(0);
	});

	it("切换笔记时拆分计时会话", () => {
		const clock = createClock(Date.UTC(2026, 0, 1, 9));
		const spans: TimeSpan[] = [];
		const tracker = new TimeTracker((span) => spans.push(span), clock.clock);

		tracker.activity("a.md");
		clock.advance(60 * 1000);
		tracker.activity("b.md");
		clock.advance(30 * 1000);
		tracker.pause();

		expect(spans.map((span) => [span.path, span.seconds])).toEqual([
			["a.md", 60],
			["b.md", 30],
		]);
	});

	it("不计入疑似休眠的检查点间隔", () => {
		const clock = createClock(Date.UTC(2026, 0, 1, 9));
		const spans: TimeSpan[] = [];
		const tracker = new TimeTracker((span) => spans.push(span), clock.clock);

		tracker.activity("a.md");
		clock.advance(15 * 1000);
		tracker.checkpoint();
		clock.advance(2 * 60 * 1000);
		tracker.checkpoint();

		expect(spans.reduce((sum, span) => sum + span.seconds, 0)).toBe(15);
		expect(tracker.getStatus()).toBe("IDLE");
	});

	it("先按旧阈值结算再修改并暂停", () => {
		const clock = createClock(Date.UTC(2026, 0, 1, 9));
		const spans: TimeSpan[] = [];
		const tracker = new TimeTracker((span) => spans.push(span), clock.clock);

		tracker.activity("a.md");
		clock.advance(30 * 1000);
		tracker.setIdleTimeout(1);

		expect(spans[0].seconds).toBe(30);
		expect(tracker.getStatus()).toBe("IDLE");
		expect(() => tracker.setIdleTimeout(0)).toThrow(RangeError);
	});

	it("首个唤醒事件到达时不补计休眠间隔", () => {
		const clock = createClock(Date.UTC(2026, 0, 1, 9));
		const spans: TimeSpan[] = [];
		const tracker = new TimeTracker((span) => spans.push(span), clock.clock);

		tracker.activity("a.md");
		clock.advance(15 * 1000);
		tracker.checkpoint();
		clock.advance(2 * 60 * 1000);
		tracker.activity("a.md");

		expect(spans.reduce((sum, span) => sum + span.seconds, 0)).toBe(15);
	});

	it("暂停时不计入长时间间隔", () => {
		const clock = createClock(Date.UTC(2026, 0, 1, 9));
		const spans: TimeSpan[] = [];
		const tracker = new TimeTracker((span) => spans.push(span), clock.clock);

		tracker.activity("a.md");
		clock.advance(15 * 1000);
		tracker.checkpoint();
		clock.advance(2 * 60 * 1000);
		tracker.pause();

		expect(spans.reduce((sum, span) => sum + span.seconds, 0)).toBe(15);
	});
});
