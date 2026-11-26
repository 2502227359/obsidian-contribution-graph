/**
 * 统一的 1.75px 细线矢量图标（贴近 SF Symbols / Lucide 质感），
 * 不依赖 Obsidian DOM 扩展，便于单元测试与多窗口文档复用。
 */

export type UiIconName =
	| "chevron-left"
	| "chevron-right"
	| "chevron-down"
	| "close"
	| "refresh"
	| "expand"
	| "zoom-in"
	| "zoom-out"
	| "calendar"
	| "sliders"
	| "plus"
	| "minus";

const ICON_PATHS: Record<UiIconName, string> = {
	"chevron-left": '<path d="m15 18-6-6 6-6"/>',
	"chevron-right": '<path d="m9 18 6-6-6-6"/>',
	"chevron-down": '<path d="m6 9 6 6 6-6"/>',
	close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
	refresh:
		'<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
	expand:
		'<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
	"zoom-in":
		'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/><path d="M11 8v6"/><path d="M8 11h6"/>',
	"zoom-out":
		'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/><path d="M8 11h6"/>',
	calendar:
		'<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
	sliders:
		'<path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M2 14h4"/><path d="M10 8h4"/><path d="M18 16h4"/>',
	plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
	minus: '<path d="M5 12h14"/>',
};

const SVG_NS = "http://www.w3.org/2000/svg";

export function createUiIcon(
	doc: Document,
	name: UiIconName,
	size = 15
): SVGSVGElement {
	const svg = doc.createElementNS(SVG_NS, "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("width", String(size));
	svg.setAttribute("height", String(size));
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "currentColor");
	svg.setAttribute("stroke-width", "1.85");
	svg.setAttribute("stroke-linecap", "round");
	svg.setAttribute("stroke-linejoin", "round");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("class", `cg-ui-icon cg-ui-icon-${name}`);
	svg.innerHTML = ICON_PATHS[name];
	return svg;
}

export function setUiIcon(
	el: HTMLElement,
	name: UiIconName,
	size = 15
): void {
	el.replaceChildren(createUiIcon(el.ownerDocument, name, size));
}
