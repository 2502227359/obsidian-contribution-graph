import { DateTime } from "luxon";
import { Fragment, useEffect, useState } from "react";
import { Locals } from "src/i18/messages";
import {
	DataFilter,
	DataSource,
	DataSourceType,
	EditActivityMetric,
} from "src/query/types";
import { getAllProperties, getTagOptions } from "src/util/page";
import { Icons } from "../icon/Icons";
import { SuggestInput } from "../suggest/SuggestInput";
import {
	countFieldTypes,
	dataSourceTypes,
	dateFieldTypes,
	editActivityMetricOptions,
	getDataSourceFilterOptions,
	taskStatusOptions,
} from "./options";
import { App, TFolder } from "obsidian";
import { InputTags, TagOption } from "../suggest/SuggestTagInput";
import { areFoldersCoveredByScope, normalizeTrackedFolders } from "src/activity/folderScope";
import { getSelectableVaultFolders, VaultFolderSuggestModal } from "src/activity/VaultFolderSuggestModal";

export function DataSourceFormItem(props: {
	dataSource: DataSource;
	onChange: (dataSource: DataSource) => void;
	app: App;
	collectionFolders: string[];
	collectionFiles?: string[];
}): JSX.Element {
	const { dataSource } = props;
	const [dateFormatType, setDateFormatType] = useState(
		dataSource.dateField?.format ? "manual" : "smart_detect"
	);
	const [dataSourceType, setDataSourceType] = useState(
		dataSource.type || "PAGE"
	);

	useEffect(() => setDataSourceType(dataSource.type), [dataSource.type]);

	const changeDataSource = (name: string, value: any) => {
		const newDataSource = { ...dataSource, [name]: value };
		props.onChange(newDataSource);
	};

	const changeDateField = (name: string, value: any) => {
		const newDateField = { ...dataSource.dateField, [name]: value };
		changeDataSource("dateField", newDateField);
	};

	const changeCountField = (name: string, value: any) => {
		const newCountField = { ...dataSource.countField, [name]: value };
		changeDataSource("countField", newCountField);
	};

	const changeFilter = (id: string, name: string, value: any) => {
		const newFilters = dataSource.filters?.map((f) => {
			if (f.id == id) {
				if (name == "type" && value == "STATUS_IS") {
					return { ...f, [name]: value, value: "COMPLETED" };
				}
				return { ...f, [name]: value };
			}
			return f;
		});
		changeDataSource("filters", newFilters);
	};

	const addFilter = (id: string) => {
		const newFilters = dataSource.filters || [];
		newFilters.push({
			id: id,
			type: "NONE",
		});
		changeDataSource("filters", newFilters);
	};

	const removeFilter = (id: string) => {
		const newFilters = dataSource.filters?.filter((f) => f.id != id);
		changeDataSource("filters", newFilters || []);
	};

	const onDataSourceTypeChange = (newSource: DataSourceType) => {
		const newDataSource = { ...dataSource, type: newSource };
		if (newSource === "EDIT_ACTIVITY" || newSource === "TIME_ACTIVITY") {
			props.onChange({
				type: newSource,
				metric: "CHANGED_CHARS",
				folders: [],
			});
			return;
		}

		if (!newDataSource.value) {
			newDataSource.value = "";
		}
		if (newSource === "PAGE") {
			newDataSource.filters = [];

			if (newDataSource.dateField?.type === "TASK_PROPERTY") {
				newDataSource.dateField = {
					type: "FILE_CTIME",
				};
			}

			if (dataSource.countField?.type === "TASK_PROPERTY") {
				changeCountField("type", "DEFAULT");
				changeCountField("value", undefined);
				newDataSource.countField = {
					type: "DEFAULT",
				};
			}
		}
		props.onChange(newDataSource);
	};

	const getTagsFromDataSource = (filter: DataFilter): TagOption[] => {
		if (filter.type != "CONTAINS_ANY_TAG" && filter.type != 'STATUS_IN') {
			return [];
		}
		if (!(filter.value instanceof Array)) {
			return [];
		}
		return filter.value.map((t) => {
			return {
				id: t,
				label: t,
				value: t,
			};
		});
	};

	const taskDataSource: DataSourceType[] = [
		"ALL_TASK",
		"TASK_IN_SPECIFIC_PAGE",
	];

	const local = Locals.get();
	return (
		<Fragment>
			<div className="form-item">
				<span className="label">{local.form_data_source_value}</span>
				<div className="form-content">
					<select
					value={dataSource.type || "PAGE"}
						onChange={(e) => {
							setDataSourceType(e.target.value as DataSourceType);
							onDataSourceTypeChange(
								e.target.value as DataSourceType
							);
						}}
					>
						{dataSourceTypes.map((option) => {
							return (
								<option value={option.value} key={option.value}>
									{option.label}
								</option>
							);
						})}
					</select>
					{dataSourceType != "ALL_TASK" &&
						!(["EDIT_ACTIVITY", "TIME_ACTIVITY"].includes(dataSourceType)) && (
						<input
							type="text"
							defaultValue={dataSource.value}
							placeholder={local.form_query_placeholder}
							onChange={(e) => {
								changeDataSource("value", e.target.value);
							}}
						/>
					)}
				</div>
			</div>

			{["EDIT_ACTIVITY", "TIME_ACTIVITY"].includes(dataSourceType) && (
				<div className="form-item contribution-graph-activity-folders">
					<span className="label">{local.form_edit_activity_folders}</span>
					<div className="form-vertical-content">
						<button
							type="button"
							onClick={() => {
								const selected = normalizeTrackedFolders(dataSource.folders || []);
								new VaultFolderSuggestModal(
									props.app,
									getSelectableVaultFolders(props.app, selected),
									local.form_edit_activity_folders_choose,
									(folder) => changeDataSource("folders", normalizeTrackedFolders([...selected, folder.path]))
								).open();
							}}
						>
							{local.form_edit_activity_folders_choose}
						</button>
						{(dataSource.folders || []).length === 0 && (
							<div className="form-description">{local.form_edit_activity_folders_all}</div>
						)}
						{normalizeTrackedFolders(dataSource.folders || []).map((folder) => {
							const missing = !(props.app.vault.getAbstractFileByPath(folder) instanceof TFolder);
							const outside = !areFoldersCoveredByScope([folder], props.collectionFolders, props.collectionFiles);
							return (
								<div className={`contribution-graph-folder-chip${missing || outside ? " is-warning" : ""}`} key={folder}>
									<span>{folder}</span>
									<button type="button" aria-label={local.form_edit_activity_folder_remove} onClick={() => changeDataSource("folders", (dataSource.folders || []).filter((path) => path !== folder))}>×</button>
									{missing && <div className="form-description">{local.form_edit_activity_folder_missing}</div>}
									{!missing && outside && <div className="form-description">{local.form_edit_activity_folder_outside_scope}</div>}
								</div>
							);
						})}
					</div>
				</div>
			)}

			{dataSourceType === "EDIT_ACTIVITY" && (
				<div className="form-item contribution-graph-activity-source">
					<span className="label">
						{local.form_edit_activity_metric}
					</span>
					<div className="form-content">
						<select
							value={
								dataSource.metric || "CHANGED_CHARS"
							}
							onChange={(event) =>
								changeDataSource(
									"metric",
									event.target.value as EditActivityMetric
								)
							}
						>
							{editActivityMetricOptions.map((option) => (
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
			)}

			{taskDataSource.includes(dataSource.type) && (
				<div className="form-item">
					<span className="label">
						{local.form_data_source_filter_label}
					</span>
					<div className="form-vertical-content">
						{dataSource.filters?.map((filter, index) => {
							return (
								<div className="form-content" key={filter.id}>
									<select
										value={filter.type || "NONE"}
										onChange={(e) => {
											changeFilter(
												filter.id,
												"type",
												e.target.value
											);
										}}
									>
										{getDataSourceFilterOptions("TASK").map(
											(op) => {
												return (
													<option
														value={op.value}
														key={op.value}
													>
														{op.label}
													</option>
												);
											}
										)}
									</select>

									{filter.type == "STATUS_IS" && (
										<select
											defaultValue={
												filter?.value || "NONE"
											}
											onChange={(e) => {
												changeFilter(
													filter.id,
													"value",
													e.target.value
												);
											}}
										>
											{taskStatusOptions.map((option) => {
												return (
													<option
														value={option.value}
														key={option.value}
													>
														{option.label}
													</option>
												);
											})}
										</select>
									)}

									{filter?.type == "CONTAINS_ANY_TAG" ? (
										<InputTags
											tags={getTagsFromDataSource(filter)}
											onChange={(tags) => {
												changeFilter(
													filter.id,
													"value",
													tags.map((t) => {
														return t.value;
													})
												);
											}}
											onRemove={(tag) => {
												if (
													filter?.value instanceof
													Array
												) {
													changeFilter(
														filter.id,
														"value",
														filter?.value?.filter(
															(t) => {
																return (
																	t !=
																	tag.value
																);
															}
														)
													);
												}
											}}
											getItems={(query) => {
												return getTagOptions(
													query,
													props.app
												);
											}}
											inputPlaceholder={
												local.form_datasource_filter_contains_tag_input_placeholder
											}
										/>
									) : null}

									{filter?.type == "STATUS_IN" ? (
										<InputTags
											tags={getTagsFromDataSource(filter)}
											onChange={(values) => {
												changeFilter(
													filter.id,
													"value",
													values.map((t) => {
														return t.value;
													})
												);
											}}
											onRemove={(tag) => {
												if (
													filter?.value instanceof
													Array
												) {
													changeFilter(
														filter.id,
														"value",
														filter?.value?.filter(
															(t) => {
																return (
																	t !=
																	tag.value
																);
															}
														)
													);
												}
											}}
											getItems={(query) => {
												return [
													{
														id: "CANCELED",
														label: local.form_datasource_filter_task_status_canceled,
														value: "CANCELED",
														icon: Icons.CODE,
													},
													{
														id: "COMPLETED",
														label: local.form_datasource_filter_task_status_completed,
														value: "COMPLETED",
														icon: Icons.CODE,
													},
													{
														id: "INCOMPLETE",
														label: local.form_datasource_filter_task_status_incomplete,
														value: "INCOMPLETE",
														icon: Icons.CODE,
													},
													{
														id: "ANY",
														label: local.form_datasource_filter_task_status_any,
														value: "ANY",
														icon: Icons.CODE,
													},
													{
														id: "FULLY_COMPLETED",
														label: local.form_datasource_filter_task_status_fully_completed,
														value: "FULLY_COMPLETED",
														icon: Icons.CODE,
													},
												];
											}}
											inputPlaceholder={
												local.form_datasource_filter_contains_tag_input_placeholder
											}
										/>
									) : null}

									<button
										className="list-remove-button"
										onClick={(e) => removeFilter(filter.id)}
									>
										x
									</button>
								</div>
							);
						})}
						<div className="form-content">
							<button
								className="list-add-button"
								onClick={(e) =>
									addFilter(Date.now().toString())
								}
							>
								+
							</button>
						</div>
					</div>
				</div>
			)}

			{!(["EDIT_ACTIVITY", "TIME_ACTIVITY"].includes(dataSourceType)) && <div className="form-item">
				<span className="label">{local.form_date_field}</span>
				<div className="form-content">
					<select
						defaultValue={
							dataSource.dateField?.type || "FILE_CTIME"
						}
						onChange={(e) => {
							changeDateField("type", e.target.value);
						}}
					>
						{dateFieldTypes(dataSource.type).map((option) => {
							return (
								<option value={option.value} key={option.value}>
									{option.label}
								</option>
							);
						})}
					</select>
					{dataSource.dateField?.type == "PAGE_PROPERTY" && (
						<SuggestInput
							defaultInputValue={dataSource.dateField?.value}
							onInputChange={(newValue) => {
								changeDateField("value", newValue);
							}}
							inputPlaceholder={local.form_date_field_placeholder}
							getItems={(query) => {
								return getAllProperties(query, props.app).map(
									(p, index) => {
										return {
											id: p.name,
											value: p.name,
											label: p.name,
											icon: Icons.CODE,
											description: p.sampleValue || "",
										};
									}
								);
							}}
							onSelected={(item) => {
								changeDateField("value", item.value);
							}}
						/>
					)}

					{dataSource.dateField?.type == "TASK_PROPERTY" && (
						<input
							type="text"
							defaultValue={dataSource.dateField?.value || ""}
							placeholder={local.form_date_field_placeholder}
							onChange={(e) => {
								changeDateField("value", e.target.value);
							}}
						/>
					)}
				</div>
			</div>}

			{!(["EDIT_ACTIVITY", "TIME_ACTIVITY"].includes(dataSourceType)) && <div className="form-item">
				<span className="label">{local.form_date_field_format}</span>
				<div className="form-vertical-content">
					<select
						defaultValue={dateFormatType}
						onChange={(e) => {
							setDateFormatType(e.target.value);
							if (e.target.value == "smart_detect") {
								changeDateField("format", undefined);
							}
						}}
					>
						<option value="smart_detect">
							{local.form_date_field_format_type_smart}
						</option>
						<option value="manual">
							{local.form_date_field_format_type_manual}
						</option>
					</select>
					{dateFormatType == "manual" ? (
						<>
							<input
								type="text"
								defaultValue={
									dataSource.dateField?.format || ""
								}
								name="dateFieldFormat"
								placeholder={
									local.form_date_field_format_placeholder
								}
								onChange={(e) => {
									changeDateField("format", e.target.value);
								}}
							/>

							<div className="form-description">
								<a href="https://moment.github.io/luxon/#/formatting?id=table-of-tokens">
									Luxon Format
								</a>
								{" " + local.form_date_field_format_sample}:
								{" " +
									DateTime.fromJSDate(
										new Date("2024-01-01 00:00:00")
									).toFormat(
										dataSource.dateField?.format ||
											"yyyy-MM-dd'T'HH:mm:ss"
									)}
							</div>
						</>
					) : null}
				</div>
			</div>}

			{!(["EDIT_ACTIVITY", "TIME_ACTIVITY"].includes(dataSourceType)) && <div className="form-item">
				<span className="label">
					{local.form_count_field_count_field_label}
				</span>
				<div className="form-vertical-content">
					<select
						defaultValue={dataSource.countField?.type || "DEFAULT"}
						onChange={(e) => {
							changeCountField("type", e.target.value);
						}}
					>
						{countFieldTypes(dataSource.type).map((option) => {
							return (
								<option value={option.value} key={option.value}>
									{option.label}
								</option>
							);
						})}
					</select>
					{dataSource.countField?.type == "PAGE_PROPERTY" ||
					dataSource.countField?.type == "TASK_PROPERTY" ? (
						<SuggestInput
							defaultInputValue={
								dataSource.countField?.value || ""
							}
							onInputChange={(newValue) => {
								changeCountField("value", newValue);
							}}
							inputPlaceholder={
								local.form_count_field_count_field_input_placeholder
							}
							getItems={(query) => {
								return getAllProperties(query, props.app).map(
									(p, index) => {
										return {
											id: p.name,
											value: p.name,
											label: p.name,
											icon: Icons.CODE,
											description: p.sampleValue || "",
										};
									}
								);
							}}
							onSelected={(item) => {
								changeCountField("value", item.value);
							}}
						/>
					) : null}
				</div>
			</div>}
		</Fragment>
	);
}
