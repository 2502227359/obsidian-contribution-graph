import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getTabPanelId, getTabId, resolveTabIndex } from "../src/view/tab/Tab";
import { Tab } from "../src/view/tab/Tab";

describe("编辑器 Tab 的键盘导航", () => {
	it("左右方向键在标签之间循环，Home/End 跳到首尾", () => {
		expect(resolveTabIndex(0, "ArrowRight", 3)).toBe(1);
		expect(resolveTabIndex(2, "ArrowRight", 3)).toBe(0);
		expect(resolveTabIndex(0, "ArrowLeft", 3)).toBe(2);
		expect(resolveTabIndex(1, "Home", 3)).toBe(0);
		expect(resolveTabIndex(1, "End", 3)).toBe(2);
	});

	it("没有标签或未知按键时保持当前位置，并生成成对 ID", () => {
		expect(resolveTabIndex(1, "PageDown", 3)).toBe(1);
		expect(resolveTabIndex(0, "ArrowRight", 0)).toBe(0);
		expect(getTabId(2, "editor")).toBe("contribution-graph-editor-tab-2");
		expect(getTabPanelId(2, "editor")).toBe("contribution-graph-editor-tabpanel-2");
	});

	it("静态输出保持标签与面板的可访问关联，未选面板仍挂载", () => {
		const markup = renderToStaticMarkup(
			createElement(Tab, {
				activeIndex: 1,
				tabs: [
					{ title: "内容", children: createElement("p", null, "内容") },
					{ title: "外观", children: createElement("p", null, "外观") },
				],
			})
		);
		expect(markup).toContain('role="tablist"');
		expect(markup).toContain('role="tab"');
		expect(markup).toContain(">内容</span>");
		expect(markup).toContain(">外观</span>");
		expect(markup).toContain('aria-selected="true"');
		expect(markup).toMatch(/aria-controls="contribution-graph-[^"]+-tabpanel-1"/);
		expect(markup).toContain('role="tabpanel"');
		expect(markup).toMatch(/id="contribution-graph-[^"]+-tabpanel-0"/);
		expect(markup).toContain('hidden=""');
	});

	it("同一页面的多个 Tab 实例使用不重复的关联 ID", () => {
		const markup = renderToStaticMarkup(
			createElement(
				"main",
				null,
				createElement(Tab, {
					tabs: [{ title: "内容", children: createElement("p", null, "一") }],
				}),
				createElement(Tab, {
					tabs: [{ title: "内容", children: createElement("p", null, "二") }],
				})
			)
		);
		const ids = [...markup.matchAll(/id="(contribution-graph-[^"]+)"/g)].map(
			(match) => match[1]
		);
		expect(new Set(ids).size).toBe(ids.length);
		expect(markup.match(/aria-controls="([^"]+)"/)?.[1]).toBeDefined();
	});
});
