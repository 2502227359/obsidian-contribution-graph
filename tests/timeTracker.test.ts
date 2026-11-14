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
	it("累计活跃区间并将空闲尾部限制为五分钟", () => {
		const clock = createClock(Date.UTC(2026, 0, 1, 9));
		const spans: TimeSpan[] = [];
		const tracker = new TimeTracker((span) => spans.push(span), clock.clock);

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
		expect(spans.reduce((sum, span) => sum + span.seconds, 0)).toBe(7 * 60);
		expect(spans.reduce((sum, span) => sum + span.end - span.start, 0)).toBe(7 * 60 * 1000);
		expect(tracker.getStatus()).toBe("IDLE");
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
