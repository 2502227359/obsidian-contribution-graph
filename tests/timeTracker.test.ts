import { describe, expect, it } from "vitest";
import { TimeSpan } from "../src/time/types";
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
		expect(removed).toEqual([{
			path: "Notes/a.md", start: Date.UTC(2026, 0, 1, 9, 2),
			end: Date.UTC(2026, 0, 1, 9, 6, 45), seconds: 285,
		}]);
		expect(tracker.getStatus()).toBe("IDLE");
		clock.advance(15000); tracker.checkpoint(); tracker.pause();
		expect(removed).toHaveLength(1);
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
