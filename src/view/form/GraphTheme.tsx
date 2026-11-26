import { DEFAULT_RULES } from "src/constants";
import { Locals } from "src/i18/messages";
import { CellStyleRule } from "src/types";

export interface Theme {
	id: string;
	name: string;
	description?: string;
	colors: string[];
	rules: CellStyleRule[];
}

export const THEMES: Theme[] = [
	{
		id: "custom",
		name: Locals.get().form_theme_placeholder,
		description: "",
		colors: [],
		rules: [],
	},
	{
		id: "default",
		name: "默认蓝",
		description: "",
		colors: DEFAULT_RULES.map((rule) => rule.color),
		rules: DEFAULT_RULES,
	},
	{
		id: "ocean",
		name: "深海青",
		description: "",
		colors: ["#8dd1e2", "#63a1be", "#376d93", "#012f60"],
		rules: buildPureColorTheme(
			"Ocean",
			"#8dd1e2",
			"#63a1be",
			"#376d93",
			"#012f60"
		),
	},
	{
		id: "halloween",
		name: "暖橘金",
		description: "",
		colors: ["#fdd577", "#faaa53", "#f07c44", "#d94e49"],
		rules: buildPureColorTheme(
			"Halloween",
			"#fdd577",
			"#faaa53",
			"#f07c44",
			"#d94e49"
		),
	},
	{
		id: "lovely",
		name: "樱花粉",
		description: "",
		colors: ["#fedcdc", "#fdb8bf", "#f892a9", "#ec6a97"],
		rules: buildPureColorTheme(
			"Lovely",
			"#fedcdc",
			"#fdb8bf",
			"#f892a9",
			"#ec6a97"
		),
	},
	{
		id: "wine",
		name: "勃艮第",
		description: "",
		colors: ["#d8b0b3", "#c78089", "#ac4c61", "#830738"],
		rules: buildPureColorTheme(
			"Wine",
			"#d8b0b3",
			"#c78089",
			"#ac4c61",
			"#830738"
		),
	},
	{
		id: "colorblind-blue",
		name: "色觉友好 · 蓝",
		description: "",
		colors: ["#dbe9f4", "#91bad6", "#477da7", "#153b5b"],
		rules: buildPureColorTheme(
			"ColorblindBlue",
			"#dbe9f4",
			"#91bad6",
			"#477da7",
			"#153b5b"
		),
	},
	{
		id: "colorblind-gold",
		name: "色觉友好 · 金",
		description: "",
		colors: ["#fff0c2", "#e5bd62", "#a87921", "#5c3b00"],
		rules: buildPureColorTheme(
			"ColorblindGold",
			"#fff0c2",
			"#e5bd62",
			"#a87921",
			"#5c3b00"
		),
	},
];

export function buildPureColorTheme(
	themeName: string,
	a: string,
	b: string,
	c: string,
	d: string
) {
	return [
		{
			id: `${themeName}_a`,
			color: a,
			min: 1,
			max: 2,
		},
		{
			id: `${themeName}_b`,
			color: b,
			min: 2,
			max: 3,
		},
		{
			id: `${themeName}_c`,
			color: c,
			min: 3,
			max: 5,
		},
		{
			id: `${themeName}_d`,
			color: d,
			min: 5,
			max: 9999,
		},
	];
}
