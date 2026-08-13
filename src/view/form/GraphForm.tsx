import { useEffect, useRef, useState } from "react";
import { CodeBlockProcessor } from "src/processor/codeBlockProcessor";
import {
	CellStyleRule,
	GraphDensity,
	SavedGraphTheme,
} from "src/types";
import { Choose } from "../choose/Choose";
import { CellRuleItem } from "./CellRuleFormItem";
import { THEMES } from "./GraphTheme";
import {
	applyColorsToCellRules,
	generateSequentialPalette,
} from "./themePalette";
import { Locals } from "src/i18/messages";
import { App, Notice } from "obsidian";

import {
	cellShapes,
	titleAlignChooseOptions,
	graphOptions,
	startOfWeekOptions,
	dateTypeOptions,
} from "./options";
import { DataSourceFormItem } from "./DataSourceFormItem";
import { DateRangeType, YamlGraphConfig } from "src/processor/types";
import { Tab } from "../tab/Tab";
import NumberInput from "../number-input";
import { ColorPicker } from "./ColorPicker";
import { About } from "../about";
import { EditActivityService } from "src/activity/EditActivityService";
import {
	createDefaultGoalHeatScale,
	DEFAULT_RULES,
} from "src/constants";
import { GoalHeatScaleFormItem } from "./GoalHeatScaleFormItem";
import {
	applyColorsToGoalHeatScale,
} from "./goalHeatScaleForm";
import {
	DEFAULT_GRAPH_APPEARANCE,
	GRAPH_DENSITY_PRESETS,
	normalizeGraphAppearance,
	parsePixelValue,
} from "src/render/graphAppearance";

export function GraphForm(props: {
	yamlConfig: YamlGraphConfig;
	onSubmit: (yamlGraphConfig: YamlGraphConfig) => void;
	app: App;
	activityService: EditActivityService;
}): JSX.Element {
	const { yamlConfig } = props;
	const local = Locals.get();
	const previewContainerRef = useRef<HTMLDivElement>(null);
	const previewProcessorRef = useRef<CodeBlockProcessor | null>(null);

	const [formData, setFormData] = useState(yamlConfig);
	const [cellRules, setCellRules] = useState<CellStyleRule[]>(
		yamlConfig.cellStyleRules || []
	);
	const [customThemes, setCustomThemes] = useState<SavedGraphTheme[]>(
		props.activityService.getGraphThemes()
	);
	const [selectedThemeId, setSelectedThemeId] = useState("custom");
	const [themeName, setThemeName] = useState("");
	const [paletteBaseColor, setPaletteBaseColor] = useState("#216e39");
	const [dimensionsLinked, setDimensionsLinked] = useState(
		!yamlConfig.cellStyle?.minWidth ||
			yamlConfig.cellStyle?.minWidth === yamlConfig.cellStyle?.minHeight
	);
	const appearance = normalizeGraphAppearance(formData.appearance);

	const handleInputChange = (
		e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>
	) => {
		const { name, value } = e.target;
		changeFormData(name, value);
	};

	const handleThemeChanged = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const { value } = e.target;
		setSelectedThemeId(value);
		const savedTheme = customThemes.find((theme) => theme.id === value);
		if (savedTheme) {
			applySavedTheme(savedTheme);
			setThemeName(savedTheme.name);
			return;
		}
		const theme = THEMES.find((t) => t.id === value);
		if (theme?.colors.length) {
			applyColors(theme.colors);
		}
	};

	const applyColors = (colors: string[]) => {
		if (formData.dataSource?.type === "EDIT_ACTIVITY") {
			changeFormData(
				"heatScale",
				applyColorsToGoalHeatScale(formData.heatScale, colors)
			);
			return;
		}
		const nextRules = applyColorsToCellRules(cellRules, colors);
		setCellRules(nextRules);
		changeFormData("cellStyleRules", nextRules);
	};

	const applySavedTheme = (theme: SavedGraphTheme) => {
		applyColors(theme.colors);
		setFormData((previous) => ({
			...previous,
			appearance: {
				density: theme.density,
				cellGap: theme.cellGap,
				...(theme.emptyCellColor
					? { emptyCellColor: theme.emptyCellColor }
					: {}),
				highlightToday: theme.highlightToday,
				highlightWeekends: theme.highlightWeekends,
			},
			cellStyle: {
				...previous.cellStyle,
				...(theme.cellWidth
					? { minWidth: `${theme.cellWidth}px` }
					: { minWidth: undefined }),
				...(theme.cellHeight
					? { minHeight: `${theme.cellHeight}px` }
					: { minHeight: undefined }),
				borderRadius: theme.cellShape,
			},
			mainContainerStyle: {
				...previous.mainContainerStyle,
				backgroundColor: theme.backgroundColor,
			},
			enableMainContainerShadow: theme.enableShadow,
		}));
	};

	const handleCellShapeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const { value } = e.target;
		setSelectedThemeId("custom");
		changeFormData("cellStyle", {
			...formData.cellStyle,
			borderRadius: value,
		});
	};

	const getDefaultCellShape = (): string => {
		if (formData.cellStyle && formData.cellStyle.borderRadius) {
			return (
				cellShapes.find(
					(p) => p.value == formData.cellStyle?.borderRadius
				)?.value || ""
			);
		}
		return "";
	};

	const changeFormData = (name: string, value: any) => {
		setFormData((prevData) => ({ ...prevData, [name]: value }));
	};

	const getCellDimension = (key: "width" | "height"): number => {
		const customValue = parsePixelValue(
			key === "width"
				? formData.cellStyle?.minWidth
				: formData.cellStyle?.minHeight
		);
		if (customValue !== undefined) {
			return customValue;
		}
		if (appearance.density !== "CUSTOM") {
			return GRAPH_DENSITY_PRESETS[appearance.density][key];
		}
		return 10;
	};

	const handleDensityChange = (density: GraphDensity) => {
		setSelectedThemeId("custom");
		if (density === "CUSTOM") {
			setFormData((previous) => ({
				...previous,
				appearance: { ...appearance, density },
				cellStyle: {
					...previous.cellStyle,
					minWidth: `${getCellDimension("width")}px`,
					minHeight: `${getCellDimension("height")}px`,
				},
			}));
			return;
		}
		const preset = GRAPH_DENSITY_PRESETS[density];
		setFormData((previous) => ({
			...previous,
			appearance: { ...appearance, density, cellGap: preset.gap },
			cellStyle: {
				...previous.cellStyle,
				minWidth: undefined,
				minHeight: undefined,
			},
		}));
	};

	const updateCellDimension = (
		key: "width" | "height",
		value: number
	) => {
		setSelectedThemeId("custom");
		const width = key === "width" ? value : getCellDimension("width");
		const height = key === "height" ? value : getCellDimension("height");
		setFormData((previous) => ({
			...previous,
			appearance: { ...appearance, density: "CUSTOM" },
			cellStyle: {
				...previous.cellStyle,
				minWidth: `${dimensionsLinked ? value : width}px`,
				minHeight: `${dimensionsLinked ? value : height}px`,
			},
		}));
	};

	const addCellRule = () => {
		const newRule = {
			id: new Date().getTime(),
			min: 1,
			max: 2,
			color: "#63aa82",
			text: "",
		};
		setCellRules([...cellRules, newRule]);
	};

	const onSubmit = () => {
		props.onSubmit({ ...formData, cellStyleRules: cellRules });
	};

	const onPreview = () => {
		if (previewContainerRef.current) {
			previewProcessorRef.current?.dispose();
			previewContainerRef.current.empty();
			const processor = new CodeBlockProcessor(props.activityService);
			previewProcessorRef.current = processor;
			// copy new instance
			const copiedFormData = JSON.parse(JSON.stringify(formData));
			copiedFormData.cellStyleRules = cellRules;
			processor.renderFromYaml(
				copiedFormData,
				previewContainerRef.current!,
				props.app
			);
		}
	};

	useEffect(() => {
		const timer = window.setTimeout(onPreview, 250);
		return () => window.clearTimeout(timer);
	}, [formData, cellRules]);

	useEffect(
		() => () => {
			previewProcessorRef.current?.dispose();
		},
		[]
	);

	const restoreStyleDefaults = () => {
		const defaults = new YamlGraphConfig();
		setSelectedThemeId("default");
		setThemeName("");
		setPaletteBaseColor("#216e39");
		setDimensionsLinked(true);
		setCellRules(DEFAULT_RULES.map((rule) => ({ ...rule })));
		setFormData((previous) => ({
			...previous,
			titleStyle: { ...defaults.titleStyle },
			fillTheScreen: false,
			mainContainerStyle: {},
			enableMainContainerShadow: false,
			showCellRuleIndicators: true,
			cellStyle: {},
			cellStyleRules: DEFAULT_RULES.map((rule) => ({ ...rule })),
			appearance: { ...DEFAULT_GRAPH_APPEARANCE },
			...(previous.dataSource?.type === "EDIT_ACTIVITY"
				? { heatScale: createDefaultGoalHeatScale(previous.heatScale?.goal) }
				: {}),
		}));
	};

	const currentColors = (): string[] => {
		const colors =
			formData.dataSource?.type === "EDIT_ACTIVITY"
				? [...(formData.heatScale?.levels || [])]
						.sort((a, b) => a.minRatio - b.minRatio)
						.map((level) => level.color)
				: [...cellRules]
						.sort((a, b) => a.min - b.min)
						.map((rule) => rule.color);
		const defaults = DEFAULT_RULES.map((rule) => rule.color);
		return defaults.map((fallback, index) => colors[index] || fallback);
	};

	const saveCurrentTheme = async () => {
		const name = themeName.trim();
		if (!name) {
			new Notice(local.form_theme_name_required);
			return;
		}
		const existing = customThemes.find(
			(theme) => theme.id === selectedThemeId
		);
		try {
			const theme = await props.activityService.saveGraphTheme({
				id: existing?.id || `custom-${Date.now()}`,
				name,
				colors: currentColors(),
				density: appearance.density,
				cellWidth:
					appearance.density === "CUSTOM"
						? getCellDimension("width")
						: undefined,
				cellHeight:
					appearance.density === "CUSTOM"
						? getCellDimension("height")
						: undefined,
				cellGap: appearance.cellGap,
				cellShape: formData.cellStyle?.borderRadius,
				emptyCellColor: appearance.emptyCellColor,
				highlightToday: appearance.highlightToday,
				highlightWeekends: appearance.highlightWeekends,
				backgroundColor: formData.mainContainerStyle?.backgroundColor,
				enableShadow: formData.enableMainContainerShadow === true,
			});
			setCustomThemes(props.activityService.getGraphThemes());
			setSelectedThemeId(theme.id);
			new Notice(local.form_theme_saved);
		} catch {
			new Notice(local.form_theme_save_failed);
		}
	};

	const deleteSelectedTheme = async () => {
		const selected = customThemes.find(
			(theme) => theme.id === selectedThemeId
		);
		if (!selected) {
			return;
		}
		if (!window.confirm(local.form_confirm_delete_theme)) {
			return;
		}
		await props.activityService.deleteGraphTheme(selected.id);
		setCustomThemes(props.activityService.getGraphThemes());
		setSelectedThemeId("custom");
		setThemeName("");
		new Notice(local.form_theme_deleted);
	};

	const getTitleFontSize = () => {
		if (formData.titleStyle && formData.titleStyle.fontSize) {
			const fontSize = formData.titleStyle.fontSize;
			return parseInt(fontSize.replace(/[^0-9]/, ""));
		}
		return 16;
	};

	return (
		<>
			<Tab
				activeIndex={0}
				tabs={[
					{
						title: local.form_basic_settings,
						children: (
							<div className="contribution-graph-modal-form">
								<div className="form-group">
									<div className="form-item">
										<span className="label">
											{local.form_title}
										</span>
										<div className="form-content">
											<input
												name="title"
												type="text"
												defaultValue={formData.title}
												placeholder={
													local.form_title_placeholder
												}
												onChange={handleInputChange}
												style={{
													...formData.titleStyle,
													fontSize: "inherits",
													fontWeight:
														formData.titleStyle
															?.fontWeight ||
														"normal",
													// @ts-ignore
													textAlign:
														formData.titleStyle
															?.textAlign ||
														"left",
												}}
											/>

											<Choose
												options={
													titleAlignChooseOptions
												}
												defaultValue={
													formData.titleStyle
														?.textAlign || "left"
												}
												onChoose={(option) => {
													changeFormData(
														"titleStyle",
														{
															...formData.titleStyle,
															textAlign:
																option.value,
														}
													);
												}}
											/>
										</div>
									</div>

									<div className="form-item">
										<span className="label">
											{local.form_graph_type}
										</span>
										<div className="form-content">
											<select
												name="graphType"
												defaultValue={
													formData.graphType ||
													graphOptions.find(
														(p) => p.selected
													)?.value
												}
												onChange={handleInputChange}
											>
												{graphOptions.map((option) => (
													<option
														value={option.value}
														key={option.value}
													>
														{option.label}
													</option>
												))}
											</select>
										</div>
									</div>

									<div className="form-item">
										<span className="label">
											{local.form_date_range}
										</span>
										<div className="form-content">
											<select
												defaultValue={
													formData.dateRangeType ||
													"LATEST_DAYS"
												}
												onChange={(e) => {
													changeFormData(
														"dateRangeType",
														e.target
															.value as DateRangeType
													);
													if (
														e.target.type !=
														"FIXED_DATE_RANGE"
													) {
														changeFormData(
															"fromDate",
															undefined
														);
														changeFormData(
															"toDate",
															undefined
														);
													} else {
														changeFormData(
															"dateRangeValue",
															undefined
														);
													}
												}}
											>
												{dateTypeOptions.map(
													(option) => (
														<option
															value={option.value}
															key={option.value}
														>
															{option.label}
														</option>
													)
												)}
											</select>
										</div>
									</div>

									<div className="form-item">
										<span className="label"></span>
										<div className="form-content">
											{formData.dateRangeType !=
											"FIXED_DATE_RANGE" ? (
												<>
													<input
														type="number"
														defaultValue={
															formData.dateRangeValue
														}
														min={1}
														placeholder={
															local.form_date_range_input_placeholder
														}
														onChange={(e) =>
															changeFormData(
																"dateRangeValue",
																parseInt(
																	e.target
																		.value
																)
															)
														}
													/>
												</>
											) : (
												<>
													<input
														id="fromDate"
														name="fromDate"
														type="date"
														defaultValue={
															formData.fromDate
														}
														placeholder="from date, such as 2023-01-01"
														onChange={
															handleInputChange
														}
													/>
													&nbsp;-&nbsp;
													<input
														id="toDate"
														name="toDate"
														type="date"
														defaultValue={
															formData.toDate
														}
														placeholder="to date, such as 2023-12-31"
														onChange={
															handleInputChange
														}
													/>
												</>
											)}
										</div>
									</div>

									<DataSourceFormItem
										dataSource={formData.dataSource}
										onChange={(newDataSource) => {
											changeFormData(
												"dataSource",
												newDataSource
											);
											if (
												newDataSource.type ===
												"EDIT_ACTIVITY"
											) {
												changeFormData(
													"heatScale",
													formData.heatScale ||
														createDefaultGoalHeatScale()
												);
											} else if (
												formData.heatScale?.type ===
												"GOAL"
											) {
												changeFormData(
													"heatScale",
													undefined
												);
											}
										}}
										app={props.app}
										collectionFolders={props.activityService.getSettings().trackedFolders}
									/>
									{formData.dataSource?.type ===
										"EDIT_ACTIVITY" && (
										<div className="form-item contribution-graph-goal-setting">
											<span className="label">
												{local.form_daily_goal}
											</span>
											<div className="form-vertical-content">
												<input
													type="number"
													min={1}
													defaultValue={
														formData.heatScale
															?.goal || 1000
													}
													onChange={(event) => {
														const goal = Math.max(
															1,
															parseInt(
																event.target
																	.value
															) || 1
														);
														changeFormData(
															"heatScale",
															{
																...(formData.heatScale ||
																	createDefaultGoalHeatScale()),
																goal,
															}
														);
													}}
												/>
												<span className="form-description">
													{
														local.form_daily_goal_description
													}
												</span>
												<span
													className={`activity-tracking-state ${
														props.activityService.getSettings()
															.trackingEnabled
															? "is-enabled"
															: "is-disabled"
													}`}
												>
													{props.activityService.getSettings()
														.trackingEnabled
														? local.form_activity_tracking_enabled
														: local.form_activity_tracking_disabled}
												</span>
											</div>
										</div>
									)}
								</div>
							</div>
						),
					},
					{
						title: local.form_style_settings,
						children: (
							<div className="contribution-graph-modal-form">
								<div className="form-group">
									<div className="style-section-heading">
										<span>{local.form_quick_style}</span>
										<small>{local.form_auto_preview}</small>
									</div>
									<div className="form-item">
										<span className="label">
											{local.form_title_font_size_label}
										</span>
										<div className="form-content">
											<NumberInput
												defaultValue={getTitleFontSize()}
												onChange={(value) => {
													changeFormData(
														"titleStyle",
														{
															...formData.titleStyle,
															fontSize:
																value + "px",
														}
													);
												}}
												min={1}
												max={128}
											/>
										</div>
									</div>
									<div className="form-item">
										<span className="label">
											{local.form_fill_the_screen_label}
										</span>
										<div className="form-content">
											<input
												type="checkbox"
												className="checkbox"
												checked={
													formData.fillTheScreen
												}
												onChange={() =>
													changeFormData(
														"fillTheScreen",
														!formData.fillTheScreen
													)
												}
											/>
										</div>
									</div>
									{formData.graphType ==
									"month-track" ? null : (
										<div className="form-item">
											<span className="label">
												{local.form_start_of_week}
											</span>
											<div className="form-content">
												<select
													id="startOfWeek"
													name="startOfWeek"
													defaultValue={
														formData.startOfWeek !=
														undefined
															? formData.startOfWeek
															: startOfWeekOptions.find(
																	(p) =>
																		p.selected
															  )?.value
													}
													onChange={handleInputChange}
												>
													{startOfWeekOptions.map(
														(option) => (
															<option
																value={
																	option.value
																}
																key={
																	option.value
																}
															>
																{option.label}
															</option>
														)
													)}
												</select>
											</div>
										</div>
									)}

									<div className="form-item">
										<span className="label">
											{local.form_main_container_bg_color}
										</span>
										<div className="form-content">
											<ColorPicker
												color={
													formData.mainContainerStyle
														?.backgroundColor
												}
												onChange={(color) => {
													setSelectedThemeId("custom");
													changeFormData(
														"mainContainerStyle",
														{
															...formData.mainContainerStyle,
															backgroundColor:
																color,
														}
													);
												}}
												onReset={(color) => {
													setSelectedThemeId("custom");
													changeFormData(
														"mainContainerStyle",
														{
															...formData.mainContainerStyle,
															backgroundColor:
																color,
														}
													);
												}}
											/>
										</div>
									</div>

									<div className="form-item">
										<span className="label">
											{
												local.form_enable_main_container_shadow
											}
										</span>
										<div className="form-content">
											<input
												name="enableMainContainerShadow"
												type="checkbox"
												className="checkbox"
												checked={
													formData.enableMainContainerShadow
												}
												onChange={(e) => {
													setSelectedThemeId("custom");
													if (e.target.checked) {
														changeFormData(
															"enableMainContainerShadow",
															true
														);
													} else {
														changeFormData(
															"enableMainContainerShadow",
															false
														);
													}
												}}
											/>
										</div>
									</div>

									<div className="form-item">
										<span className="label">
											{local.form_show_cell_indicators}
										</span>
										<div className="form-content">
											<input
												name="showCellRuleIndicators"
												type="checkbox"
												className="checkbox"
												checked={
													formData.showCellRuleIndicators
												}
												onChange={() =>
													changeFormData(
														"showCellRuleIndicators",
														!formData.showCellRuleIndicators
													)
												}
											/>
										</div>
									</div>
									<div className="form-item">
										<span className="label">{local.form_density}</span>
										<div className="form-content">
											<select
												value={appearance.density}
												onChange={(event) =>
													handleDensityChange(
														event.target.value as GraphDensity
													)
												}
											>
												<option value="COMPACT">{local.form_density_compact}</option>
												<option value="BALANCED">{local.form_density_balanced}</option>
												<option value="TOUCH">{local.form_density_touch}</option>
												<option value="CUSTOM">{local.form_density_custom}</option>
											</select>
											<label className="inline-checkbox-label">
												<input
													type="checkbox"
													checked={dimensionsLinked}
													onChange={(event) =>
														setDimensionsLinked(event.target.checked)
													}
												/>
												{local.form_link_cell_dimensions}
											</label>
										</div>
									</div>
									<div className="form-item">
										<span className="label">
											{local.form_cell_shape}
										</span>
										<div className="form-content">
											<select
												name="cellShape"
												value={getDefaultCellShape()}
												onChange={handleCellShapeChange}
											>
												{cellShapes.map((option) => (
													<option
														value={option.value}
														key={option.label}
													>
														{option.label}
													</option>
												))}
											</select>
										</div>
									</div>
									<div className="form-item">
										<span className="label">
											{local.form_cell_min_width}
										</span>
										<div className="form-content">
											<input
												type="range"
												min={4}
												max={64}
												value={getCellDimension("width")}
												onChange={(event) =>
													updateCellDimension("width", Number(event.target.value))
												}
											/>
											<span className="input-range-value-label">
												{getCellDimension("width")}px
											</span>
										</div>
									</div>
									<div className="form-item">
										<span className="label">
											{local.form_cell_min_height}
										</span>
										<div className="form-content">
											<input
												type="range"
												min={4}
												max={64}
												value={getCellDimension("height")}
												onChange={(event) =>
													updateCellDimension("height", Number(event.target.value))
												}
											/>
											<span className="input-range-value-label">
												{getCellDimension("height")}px
											</span>
										</div>
									</div>
									<div className="form-item">
										<span className="label">{local.form_cell_gap}</span>
										<div className="form-content">
											<input
												type="range"
												min={0}
												max={8}
												value={appearance.cellGap}
												onChange={(event) => {
													setSelectedThemeId("custom");
													changeFormData("appearance", {
														...appearance,
														cellGap: Number(event.target.value),
													});
												}}
											/>
											<span className="input-range-value-label">
												{appearance.cellGap}px
											</span>
										</div>
									</div>
									<div className="form-item">
										<span className="label">{local.form_empty_cell_color}</span>
										<div className="form-content">
											<ColorPicker
												color={appearance.emptyCellColor}
												ariaLabel={local.form_empty_cell_color}
												onChange={(color) => {
													setSelectedThemeId("custom");
													changeFormData("appearance", {
														...appearance,
														emptyCellColor: color,
													});
												}}
												onReset={() => {
													setSelectedThemeId("custom");
													changeFormData("appearance", {
														...appearance,
														emptyCellColor: undefined,
													});
												}}
											/>
										</div>
									</div>
									<div className="form-item">
										<span className="label">{local.form_highlight_today}</span>
										<div className="form-content">
											<input
												type="checkbox"
												className="checkbox"
												checked={appearance.highlightToday}
												onChange={(event) => {
													setSelectedThemeId("custom");
													changeFormData("appearance", {
														...appearance,
														highlightToday: event.target.checked,
													});
												}}
											/>
										</div>
									</div>
									<div className="form-item">
										<span className="label">{local.form_highlight_weekends}</span>
										<div className="form-content">
											<input
												type="checkbox"
												className="checkbox"
												checked={appearance.highlightWeekends}
												onChange={(event) => {
													setSelectedThemeId("custom");
													changeFormData("appearance", {
														...appearance,
														highlightWeekends: event.target.checked,
													});
												}}
											/>
										</div>
									</div>
									<div className="form-item">
										<span className="label">
											{local.form_theme}
										</span>
										<div className="form-vertical-content contribution-graph-theme-manager">
											<select
												name="theme"
												value={selectedThemeId}
												onChange={handleThemeChanged}
											>
												{THEMES.map((option) => (
													<option
														value={option.id}
														key={option.id}
													>
														{option.name}
													</option>
												))}
												{customThemes.map((theme) => (
													<option
														value={theme.id}
														key={theme.id}
													>
														★ {theme.name}
													</option>
												))}
											</select>
											<div className="theme-palette-generator">
												<span>{local.form_palette_base_color}</span>
												<ColorPicker
													color={paletteBaseColor}
													ariaLabel={local.form_palette_base_color}
													onChange={(color) =>
														color && setPaletteBaseColor(color)
													}
												/>
												<button
													type="button"
													onClick={() => {
														applyColors(
															generateSequentialPalette(
																paletteBaseColor
															)
														);
														setSelectedThemeId("custom");
													}}
												>
													{local.form_generate_palette}
												</button>
											</div>
											<div className="custom-theme-actions">
												<input
													type="text"
													maxLength={64}
													value={themeName}
													placeholder={local.form_custom_theme_name}
													onChange={(event) =>
														setThemeName(event.target.value)
													}
												/>
												<button type="button" onClick={() => void saveCurrentTheme()}>
													{local.form_save_custom_theme}
												</button>
												{customThemes.some((theme) => theme.id === selectedThemeId) && (
													<button
														type="button"
														className="mod-warning"
														onClick={() => void deleteSelectedTheme()}
													>
														{local.form_delete_custom_theme}
													</button>
												)}
											</div>
										</div>
									</div>
									<div className="form-item">
										<span className="label">
											{formData.dataSource?.type ===
											"EDIT_ACTIVITY"
												? local.form_goal_heat_levels
												: local.form_cell_style_rules}
										</span>
										<div className="form-vertical-content">
											{formData.dataSource?.type ===
											"EDIT_ACTIVITY" ? (
												<GoalHeatScaleFormItem
													heatScale={
														formData.heatScale
													}
													onChange={(heatScale) => {
														setSelectedThemeId("custom");
														changeFormData("heatScale", heatScale);
													}}
												/>
											) : (
												<>
													{cellRules.map((rule) => {
														return (
															<CellRuleItem
																rule={rule}
																key={rule.id}
																onChange={(
																	newRule
																) => {
																	const newRules =
																		cellRules.map(
																			(
																				r
																			) =>
																				r.id ==
																				newRule.id
																					? newRule
																					: r
																		);
																		setCellRules(
																			newRules
																		);
																		setSelectedThemeId("custom");
																}}
																onRemove={(
																	id: string
																) => {
																	const newRules =
																		cellRules.filter(
																			(
																				r
																			) =>
																				r.id !=
																				id
																		);
																	setCellRules(
																		newRules
																	);
																}}
															/>
														);
													})}
													<button
														onClick={() =>
															addCellRule()
														}
														className="list-add-button"
													>
														+
													</button>
												</>
											)}
										</div>
									</div>
								</div>
							</div>
						),
					},
					{
						title: local.form_about,
						children: <About />,
					},
				]}
			></Tab>
			<div className="contribution-graph-modal-form">
				<div
					className="preview-container"
					ref={previewContainerRef}
				></div>
				<div className="form-item">
					<div className="form-content contribution-graph-form-actions">
						<button className="button" onClick={restoreStyleDefaults}>
							{local.form_restore_style_defaults}
						</button>
						<button className="button" onClick={onPreview}>
							{local.form_button_preview}
						</button>
						<button className="button" onClick={onSubmit}>
							{local.form_button_save}
						</button>
					</div>
				</div>
			</div>
		</>
	);
}

export class SelectOption<T> {
	label: string;
	value: T;
	selected?: boolean;

	constructor(label: string, value: T, selected?: boolean) {
		this.label = label;
		this.value = value;
		this.selected = selected;
	}
}
