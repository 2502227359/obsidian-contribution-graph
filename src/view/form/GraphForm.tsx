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
	TIME_HOURLY_RULES,
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
	onCancel?: () => void;
	newGraph?: boolean;
	app: App;
	activityService: EditActivityService;
}): JSX.Element {
	const { yamlConfig } = props;
	const local = Locals.get();
	const previewContainerRef = useRef<HTMLDivElement>(null);
	const previewProcessorRef = useRef<CodeBlockProcessor | null>(null);
	const dateRangeTouched=useRef(false);

	const [formData, setFormData] = useState(() => ({ ...yamlConfig,
		...(yamlConfig.dataSource?.type === "TIME_ACTIVITY" && !["hourly","timeline"].includes(yamlConfig.graphType)
			? { heatScale: yamlConfig.heatScale || createDefaultGoalHeatScale(60) } : {}),
	}));
	const [cellRules, setCellRules] = useState<CellStyleRule[]>(
		yamlConfig.cellStyleRules || (yamlConfig.graphType === "hourly" ? TIME_HOURLY_RULES : [])
	);
	const [customThemes, setCustomThemes] = useState<SavedGraphTheme[]>(
		props.activityService.getGraphThemes()
	);
	const [selectedThemeId, setSelectedThemeId] = useState("custom");
	const [themeName, setThemeName] = useState("");
	const [paletteBaseColor, setPaletteBaseColor] = useState("#0a6cdb");
	const [dimensionsLinked, setDimensionsLinked] = useState(
		!yamlConfig.cellStyle?.minWidth ||
			yamlConfig.cellStyle?.minWidth === yamlConfig.cellStyle?.minHeight
	);
	const isTimeSource = formData.dataSource?.type === "TIME_ACTIVITY";
	const isGoalSource = formData.dataSource?.type === "EDIT_ACTIVITY" || (isTimeSource && !["hourly","timeline"].includes(formData.graphType));
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
		if (isGoalSource) {
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
		if(["dateRangeType","dateRangeValue","fromDate","toDate"].includes(name))dateRangeTouched.current=true;
		setFormData((prevData) => ({ ...prevData, [name]: value }));
	};

	const changeGraphType = (graphType: string) => {
		if(graphType==="timeline"){
			const useDefault=props.newGraph&&!dateRangeTouched.current;dateRangeTouched.current=true;
			setFormData(previous=>({...previous,graphType,dataSource:{type:"TIME_ACTIVITY",folders:previous.dataSource?.folders||[]},
				title:props.newGraph&&["Contributions","Contribution Graph"].includes(previous.title||"")?"学习时间轴":previous.title,
				timelineDepth:previous.timelineDepth||1,...(useDefault?{dateRangeType:"LATEST_DAYS",dateRangeValue:30,fromDate:undefined,toDate:undefined}:{}),
				heatScale:previous.dataSource?.type==="TIME_ACTIVITY"?previous.heatScale:undefined}));
			return;
		}
		const hourly = graphType === "hourly";
		const rules = hourly ? TIME_HOURLY_RULES : DEFAULT_RULES;
		const resetRules = hourly || formData.graphType === "hourly";
		if (resetRules) setCellRules(rules.map(rule => ({ ...rule })));
		setFormData(previous => ({ ...previous, graphType,
			...(resetRules ? { cellStyleRules: rules.map(rule => ({ ...rule })) } : {}),
			...(hourly ? { dataSource: { type: "TIME_ACTIVITY", folders: previous.dataSource?.folders || [] },
				dateRangeType: "LATEST_DAYS", dateRangeValue: 28, fromDate: undefined, toDate: undefined, heatScale: undefined,
				cellStyleRules: rules.map(rule => ({ ...rule })) }
				: previous.dataSource?.type === "TIME_ACTIVITY" ? { heatScale: previous.heatScale || createDefaultGoalHeatScale(60) } : {}),
		}));
	};

	const changeDataSource = (dataSource: YamlGraphConfig["dataSource"]) => {
		const time = dataSource.type === "TIME_ACTIVITY";
		const sourceChanged = dataSource.type !== formData.dataSource?.type;
		const leavingHourly = !time && ["hourly","timeline"].includes(formData.graphType);
		if (leavingHourly) setCellRules(DEFAULT_RULES.map(rule => ({ ...rule })));
		setFormData(previous => ({ ...previous, dataSource,
			...(leavingHourly ? { cellStyleRules: DEFAULT_RULES.map(rule => ({ ...rule })) } : {}),
			graphType: !time && ["hourly","timeline"].includes(previous.graphType) ? "default" : previous.graphType,
			heatScale: !sourceChanged ? previous.heatScale
				: time && !["hourly","timeline"].includes(previous.graphType) ? createDefaultGoalHeatScale(60)
				: dataSource.type === "EDIT_ACTIVITY" ? createDefaultGoalHeatScale() : undefined,
		}));
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
		setPaletteBaseColor("#0a6cdb");
		setDimensionsLinked(true);
		const rules = formData.graphType === "hourly" ? TIME_HOURLY_RULES : DEFAULT_RULES;
		setCellRules(rules.map((rule) => ({ ...rule })));
		setFormData((previous) => ({
			...previous,
			titleStyle: { ...defaults.titleStyle },
			fillTheScreen: false,
			mainContainerStyle: {},
			enableMainContainerShadow: false,
			showCellRuleIndicators: true,
			cellStyle: {},
			cellStyleRules: rules.map((rule) => ({ ...rule })),
			appearance: { ...DEFAULT_GRAPH_APPEARANCE },
			...((previous.dataSource?.type === "EDIT_ACTIVITY" || (previous.dataSource?.type === "TIME_ACTIVITY" && previous.graphType !== "hourly" && previous.graphType !== "timeline"))
				? { heatScale: createDefaultGoalHeatScale(previous.heatScale?.goal || (isTimeSource ? 60 : 1000)) }
				: {}),
		}));
	};

	const currentColors = (): string[] => {
		const colors =
			isGoalSource
				? [...(formData.heatScale?.levels || [])]
						.sort((a, b) => a.minRatio - b.minRatio)
						.map((level) => level.color)
				: [...cellRules]
						.sort((a, b) => a.min - b.min)
						.map((rule) => rule.color);
		return colors.length > 0
			? colors
			: DEFAULT_RULES.map((rule) => rule.color);
	};

	const currentColorCount = (): number =>
		isGoalSource
			? formData.heatScale?.levels.length || DEFAULT_RULES.length
			: cellRules.length || DEFAULT_RULES.length;

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
		<div className="cg-editor-shell">
			<div className="cg-editor-workspace">
				<section className="cg-editor-settings" aria-label="图表配置">
			<Tab
				activeIndex={0}
				tabs={[
					{
						title: "内容",
						children: (
							<div
								className="contribution-graph-modal-form cg-editor-content-panel"
								data-editor-section="content"
							>
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
												value={
													formData.graphType ||
													graphOptions.find(
														(p) => p.selected
													)?.value
												}
												onChange={(event) => changeGraphType(event.target.value)}
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

									{formData.graphType==="timeline"&&<div className="form-item">
										<span className="label">初始学科分组</span>
										<div className="form-content"><select aria-label="时间轴初始分组" value={formData.timelineDepth||1} onChange={event=>changeFormData("timelineDepth",Number(event.target.value))}>
											<option value={1}>一级目录</option><option value={2}>二级目录</option>
										</select></div>
									</div>}
									<div className="form-item">
										<span className="label">
											{local.form_date_range}
										</span>
										<div className="form-content">
											<select
												value={
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
														value={
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
										onChange={changeDataSource}
										app={props.app}
										collectionFolders={props.activityService.getSettings().trackedFolders}
										collectionFiles={props.activityService.getSettings().trackedFiles}
									/>
									{isGoalSource && (
										<div className="form-item contribution-graph-goal-setting">
											<span className="label">
												{(isTimeSource ? "每日目标（分钟）" : local.form_daily_goal)}
											</span>
											<div className="form-vertical-content">
												<input
													type="number"
													min={1}
													value={
														formData.heatScale
															?.goal || (isTimeSource ? 60 : 1000)
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
																	createDefaultGoalHeatScale(isTimeSource ? 60 : 1000)),
																goal,
															}
														);
													}}
												/>
												<span className="form-description">
													{
														(isTimeSource ? "每天的活跃使用时长目标，单位为分钟。" : local.form_daily_goal_description)
													}
												</span>
												<span
													className={`activity-tracking-state ${
														(isTimeSource ? props.activityService.getSettings().timeTrackingEnabled : props.activityService.getSettings().trackingEnabled)
															? "is-enabled"
															: "is-disabled"
													}`}
												>
													{(isTimeSource ? props.activityService.getSettings().timeTrackingEnabled : props.activityService.getSettings().trackingEnabled)
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
						title: "外观",
						children: (
							<div
								className="contribution-graph-modal-form cg-editor-appearance-panel"
								data-editor-section="appearance"
							>
								<div className="form-group">
									<div className="style-section-heading">
										<span>{local.form_quick_style}</span>
										<small>{local.form_auto_preview}</small>
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
									{formData.graphType !== "hourly" && formData.graphType !== "timeline" && <>
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
									</>}
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
																paletteBaseColor,
																currentColorCount()
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
								</div>
							</div>
						),
					},
					{
						title: "高级",
						children: (
							<div
								className="contribution-graph-modal-form cg-editor-advanced-panel"
								data-editor-section="advanced"
							>
								<div className="form-group">
									<div className="style-section-heading">
										<span>高级外观设置</span>
										<small>低频选项，修改后实时预览</small>
									</div>
									<div className="form-item">
										<span className="label">{local.form_title_font_size_label}</span>
										<div className="form-content">
											<NumberInput
												defaultValue={getTitleFontSize()}
												onChange={(value) =>
													changeFormData("titleStyle", {
														...formData.titleStyle,
														fontSize: value + "px",
													})
												}
												min={1}
												max={128}
											/>
										</div>
									</div>
									<div className="form-item">
										<span className="label">{local.form_main_container_bg_color}</span>
										<div className="form-content">
											<ColorPicker
												color={formData.mainContainerStyle?.backgroundColor}
												onChange={(color) => {
													setSelectedThemeId("custom");
													changeFormData("mainContainerStyle", {
														...formData.mainContainerStyle,
														backgroundColor: color,
													});
												}}
												onReset={(color) => {
													setSelectedThemeId("custom");
													changeFormData("mainContainerStyle", {
														...formData.mainContainerStyle,
														backgroundColor: color,
													});
												}}
											/>
										</div>
									</div>
									<div className="form-item">
										<span className="label">{local.form_enable_main_container_shadow}</span>
										<div className="form-content">
											<input
												name="enableMainContainerShadow"
												type="checkbox"
												className="checkbox"
												checked={formData.enableMainContainerShadow}
												onChange={(event) => {
													setSelectedThemeId("custom");
													changeFormData("enableMainContainerShadow", event.target.checked);
												}}
											/>
										</div>
									</div>
									<div className="form-item">
										<span className="label">
											{formData.graphType === "timeline" ? "时间轴配色" : formData.graphType === "hourly" ? "柱体颜色" : isGoalSource ? local.form_goal_heat_levels : local.form_cell_style_rules}
										</span>
										<div className="form-vertical-content">
											{formData.graphType === "timeline" ? <span className="cg-editor-hint">按学科使用稳定配色，无需热力阈值或目标。</span> : formData.graphType === "hourly" ? (
												<ColorPicker
													color={cellRules.slice(-1)[0]?.color}
													defaultColor={TIME_HOURLY_RULES.slice(-1)[0].color}
													onChange={(color) => {
														if (!color) return;
														setSelectedThemeId("custom");
														setCellRules(rules => rules.map((rule, index) =>
															index === rules.length - 1 ? {...rule, color} : rule
														));
													}}
												/>
											) : isGoalSource ? (
												<GoalHeatScaleFormItem
													heatScale={formData.heatScale}
													onChange={(heatScale) => {
														setSelectedThemeId("custom");
														changeFormData("heatScale", heatScale);
													}}
												/>
											) : (
												<>
													{cellRules.map((rule) => (
														<CellRuleItem
															rule={rule}
															key={rule.id}
															onChange={(newRule) => {
																setCellRules(cellRules.map((current) =>
																	current.id === newRule.id ? newRule : current
																));
																setSelectedThemeId("custom");
															}}
															onRemove={(id) => setCellRules(cellRules.filter((rule) => rule.id !== id))}
														/>
													))}
													<button type="button" onClick={addCellRule} className="list-add-button">+</button>
												</>
											)}
										</div>
									</div>
									<details className="cg-editor-about">
										<summary>{local.form_about}</summary>
										<About />
									</details>
								</div>
							</div>
						),
					},
				]}
			></Tab>
				</section>
				<section className="cg-editor-preview" aria-label="实时预览">
					<div className="cg-preview-heading">实时预览</div>
					<div
						className="preview-graph preview-container"
						ref={previewContainerRef}
					></div>
				</section>
			</div>
			<footer className="cg-editor-footer">
				<div className="cg-editor-footer-secondary">
					<button
						type="button"
						className="cg-button"
						onClick={restoreStyleDefaults}
					>
						{local.form_restore_style_defaults}
					</button>
				</div>
				<div className="cg-editor-footer-actions">
					<button type="button" className="cg-button" onClick={onPreview}>
						{local.form_button_preview}
					</button>
					{props.onCancel && (
						<button type="button" className="cg-button" onClick={props.onCancel}>
							取消
						</button>
					)}
					<button type="button" className="cg-button cg-button-primary" onClick={onSubmit}>
						{local.form_button_save}
					</button>
				</div>
			</footer>
		</div>
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
