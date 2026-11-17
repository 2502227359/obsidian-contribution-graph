import { color } from "echarts/core";

export interface ActivityColor { fill: string; text: string; stroke: string; }

const YOLO_PATH = "activity://yolo-chat";

export function activityPalette(paths: readonly string[], dark: boolean): string[] {
	return [...new Set([...new Set(paths)].map(path => activityColor(path, dark).fill))].sort();
}

export function activitySwatch(palette: readonly string[]): string {
	if (!palette.length) return "transparent";
	if (palette.length === 1) return palette[0];
	const stops=palette.map((fill,index)=>`${fill} ${index/palette.length*100}% ${(index+1)/palette.length*100}%`);
	return `linear-gradient(90deg, ${stops.join(", ")})`;
}

export function activityColor(path: string, dark: boolean): ActivityColor {
	const normalized = normalizePath(path);
	if (normalized === YOLO_PATH) {
		const fill = dark ? "hsl(166, 48%, 43%)" : "hsl(166, 48%, 75%)";
		return {fill, text: readableText(fill, dark), stroke: dark ? "hsl(166, 58%, 68%)" : "hsl(166, 54%, 39%)"};
	}
	const subject = subjectKey(normalized), base = hash(subject), variant = hash(normalized);
	const baseHue = mod(base, 360), hue = mod(baseHue + mod(variant, 17) - 8 + 360, 360);
	const saturation = 50 + mod(base, 13);
	const lightness = dark ? 38 + mod(variant, 12) : 74 + mod(variant, 13);
	const fill = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
	const stroke = `hsl(${baseHue}, ${Math.min(78, saturation + 8)}%, ${dark ? 68 : 43}%)`;
	return {fill, text: readableText(fill, dark), stroke};
}

function normalizePath(path: string): string { return path.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""); }

function subjectKey(path: string): string {
	const parts = path.split("/").filter(Boolean);
	if (!parts.length) return "activity";
	return /\.md$/i.test(parts[parts.length - 1]) ? parts.slice(0, -1).join("/") || parts[0] : parts.join("/");
}

function hash(value: string): number {
	let result = 2166136261;
	for (let index = 0; index < value.length; index++) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
	return result >>> 0;
}

function mod(value: number, divisor: number): number { return value % divisor; }

function readableText(fill: string, dark: boolean): string {
	const preferred = dark ? "#f7fbff" : "#1d2935";
	const alternate = dark ? "#1d2935" : "#f7fbff";
	if (contrastRatio(fill, preferred) >= 4.5) return preferred;
	if (contrastRatio(fill, alternate) >= 4.5) return alternate;
	return contrastRatio(fill, "#ffffff") >= 4.5 ? "#ffffff" : "#000000";
}

function contrastRatio(background: string, foreground: string): number {
	const first = luminance(color.parse(background)), second = luminance(color.parse(foreground));
	return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
}

function luminance(rgba: number[] | undefined): number {
	if (!rgba) return 0;
	const channels = rgba.slice(0, 3).map(value => value / 255).map(value => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
	return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}
