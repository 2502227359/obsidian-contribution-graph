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

export const THEMES = [
	{
		id: "custom",
		name: Locals.get().form_theme_placeholder,
		description: "",
		colors: [],
		rules: [],
	},
	{
		id: "default",
		name: "default",
		description: "",
		colors: DEFAULT_RULES.map((rule) => rule.color),
		rules: DEFAULT_RULES,
	},
	{
		id: "ocean",
		name: "Ocean",
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
		name: "Halloween",
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
		name: "Lovely",
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
		name: "Wine",
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
		name: "Colorblind Blue",
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
		name: "Colorblind Gold",
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
