import { describe, expect, it } from "vitest";
import { axisDuration, detailDuration, observeThemeChanges, timeAxisOptions } from "../src/view/weeklyReviewChartStyle";

describe("周回顾图表时长展示", () => {
	it("按完整的小时、分钟和秒数显示坐标轴刻度", () => {
		expect(axisDuration(0)).toBe("0");
		expect(axisDuration(30)).toBe("30秒");
		expect(axisDuration(1800)).toBe("30分");
		expect(axisDuration(3600)).toBe("1小时");
		expect(axisDuration(5400)).toBe("1小时30分");
	});

	it("正文明细保留跨小时的分钟", () => {
		expect(detailDuration(3660)).toBe("1小时 1分钟");
	});

	it("为零值和小秒数生成不截断的标尺", () => {
		for (const seconds of [0, 0.5, 8]) {
			const option = timeAxisOptions(seconds);
			expect(option.min).toBe(0);
			expect(option.max).toBeGreaterThanOrEqual(seconds);
			expect(option.interval).toBeGreaterThan(0);
		}
		expect(timeAxisOptions(0.5).axisLabel.formatter(0.5)).not.toBe("0");
	});

	it("跨天时仍使用整齐的刻度并覆盖最大值", () => {
		const option = timeAxisOptions(3 * 24 * 60 * 60 + 3600);
		expect(option.max).toBeGreaterThanOrEqual(3 * 24 * 60 * 60 + 3600);
		expect(option.interval).toBeGreaterThan(0);
		expect(option.axisLabel.formatter(option.interval)).not.toMatch(/\.\d/);
	});
});

describe("主题变化监听防误触发", () => {
	function createFakeDom() {
		let callback: MutationCallback | undefined;
		const classes = new Set<string>(["theme-light"]);
		const vars: Record<string, string> = {
			"--text-normal": "#222",
			"--text-muted": "#666",
			"--background-modifier-border": "#ddd",
			"--background-primary": "#fff",
		};
		let fontFamily = "LXGW WenKai";
		let computedStyleCalls = 0;

		class FakeElement {
			isConnected = true;
			classList = {
				contains: (token: string) => classes.has(token),
				[Symbol.iterator]: () => classes.values(),
			};
		}

		class FakeMutationObserver {
			disconnected = false;
			constructor(cb: MutationCallback) {
				callback = cb;
			}
			observe(): void { /* noop */ }
			disconnect(): void { this.disconnected = true; }
		}

		const body = new FakeElement();
		const documentElement = new FakeElement();
		const el = new FakeElement();
		const prevElement = (globalThis as { Element?: unknown }).Element;
		(globalThis as { Element?: unknown }).Element = FakeElement;

		const owner = {
			body,
			documentElement,
			defaultView: {
				MutationObserver: FakeMutationObserver,
				getComputedStyle: () => {
					computedStyleCalls++;
					return {
						getPropertyValue: (name: string) => vars[name] || "",
						get fontFamily() { return fontFamily; },
					};
				},
			},
		} as unknown as Document;

		return {
			owner,
			el: el as unknown as HTMLElement,
			body,
			classes,
			vars,
			setFont: (font: string) => { fontFamily = font; },
			getComputedStyleCalls: () => computedStyleCalls,
			emit: (records: Partial<MutationRecord>[]) => {
				callback?.(records as MutationRecord[], {} as MutationObserver);
			},
			restore: () => { (globalThis as { Element?: unknown }).Element = prevElement; },
		};
	}

	it("过滤 is-grabbing 等瞬时交互 class 且不触发重绘与样式重算", () => {
		const dom = createFakeDom();
		try {
			let repaints = 0;
			const observer = observeThemeChanges(dom.owner, dom.el, () => { repaints++; });
			expect(observer).toBeDefined();
			const callsAfterInit = dom.getComputedStyleCalls();

			// 模拟图谱按住左键拖拽给 body 增删 is-grabbing
			dom.classes.add("is-grabbing");
			dom.emit([{ attributeName: "class", target: dom.body as unknown as Node, oldValue: "theme-light" }]);
			dom.classes.delete("is-grabbing");
			dom.emit([{ attributeName: "class", target: dom.body as unknown as Node, oldValue: "theme-light is-grabbing" }]);

			expect(repaints).toBe(0);
			expect(dom.getComputedStyleCalls()).toBe(callsAfterInit);

			// 非瞬时但未改变主题签名的普通 class 也不触发重绘
			dom.classes.add("some-unrelated-flag");
			dom.emit([{ attributeName: "class", target: dom.body as unknown as Node, oldValue: "theme-light" }]);
			expect(repaints).toBe(0);

			// 真实暗色主题切换必须触发重绘
			dom.classes.delete("theme-light");
			dom.classes.add("theme-dark");
			dom.emit([{ attributeName: "class", target: dom.body as unknown as Node, oldValue: "theme-light some-unrelated-flag" }]);
			expect(repaints).toBe(1);

			// 主题配色变量变更必须触发重绘
			dom.vars["--background-primary"] = "#111";
			dom.emit([{ attributeName: "style", target: dom.body as unknown as Node, oldValue: "" }]);
			expect(repaints).toBe(2);

			// 字体变更必须触发重绘
			dom.setFont("Inter");
			dom.emit([{ attributeName: "style", target: dom.body as unknown as Node, oldValue: "" }]);
			expect(repaints).toBe(3);

			observer?.disconnect();
		} finally {
			dom.restore();
		}
	});
});
