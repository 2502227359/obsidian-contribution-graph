
export interface Local {

	default: string;
	click_to_reset: string;
	/**
	 * context menu
	 */
	context_menu_create: string;
	codeblock_edit_graph: string;
	codeblock_edit_unavailable: string;

	/**
	 * form
	 */
	form_basic_settings: string;
	form_style_settings: string;
	form_about: string;
	form_local_edition: string;
	form_local_edition_description: string;
	form_title: string;
	form_title_placeholder: string;
	form_graph_type: string;
	form_graph_type_git: string;
	form_graph_type_month_track: string;
	form_graph_type_calendar: string;
	form_date_range: string;
	form_date_range_latest_days: string;
	form_date_range_latest_month: string;
	form_date_range_latest_year: string;
	form_date_range_input_placeholder: string;
	form_date_range_fixed_date: string;
	form_date_range_start_date: string;

	form_start_of_week: string;
	form_data_source_value: string;
	form_data_source_filter_label: string;

	form_datasource_filter_type_none: string;
	form_datasource_filter_type_status_is: string;
	form_datasource_filter_type_contains_any_tag: string;
	form_datasource_filter_type_status_in: string;

	form_datasource_filter_task_none: string;
	form_datasource_filter_task_status_completed: string;
	form_datasource_filter_task_status_fully_completed: string;
	form_datasource_filter_task_status_any: string;
	form_datasource_filter_task_status_incomplete: string;
	form_datasource_filter_task_status_canceled: string;
	form_datasource_filter_contains_tag: string;
	form_datasource_filter_contains_tag_input_placeholder: string;

	form_datasource_filter_customize: string;

	form_query_placeholder: string;

	form_date_field: string;
	form_date_field_type_file_name: string;
	form_date_field_type_file_ctime: string;
	form_date_field_type_file_mtime: string;
	form_date_field_type_file_specific_page_property: string;
	form_date_field_type_file_specific_task_property: string;

	form_date_field_placeholder: string;
	form_date_field_format: string;
	form_date_field_format_sample: string;
	form_date_field_format_description: string;
	form_date_field_format_placeholder: string;

	form_date_field_format_type_smart: string;

	form_date_field_format_type_manual: string;
	form_count_field_count_field_label: string;

	form_count_field_count_field_input_placeholder: string;

	form_count_field_count_field_type_default: string;

	form_count_field_count_field_type_page_prop: string;

	form_count_field_count_field_type_task_prop: string;
	form_title_font_size_label: string;
	form_number_input_min_warning: string;
	form_number_input_max_warning: string;
	form_fill_the_screen_label: string;
	form_main_container_bg_color: string;
	form_enable_main_container_shadow: string;
	form_show_cell_indicators: string;
	form_cell_shape: string;
	form_cell_shape_circle: string;
	form_cell_shape_square: string;
	form_cell_shape_rounded: string;
	form_cell_min_height: string;
	form_cell_min_width: string;

	form_datasource_type_page: string;
	form_datasource_type_all_task: string;
	form_datasource_type_task_in_specific_page: string;
	form_datasource_type_edit_activity: string;
	form_edit_activity_metric: string;
	form_edit_activity_metric_changed: string;
	form_edit_activity_metric_added: string;
	form_edit_activity_metric_deleted: string;
	form_edit_activity_folders: string;
	form_edit_activity_folders_all: string;
	form_edit_activity_folders_choose: string;
	form_edit_activity_folder_remove: string;
	form_edit_activity_folder_missing: string;
	form_edit_activity_folder_outside_scope: string;
	form_daily_goal: string;
	form_daily_goal_description: string;
	form_activity_tracking_enabled: string;
	form_activity_tracking_disabled: string;

	form_theme: string;
	form_theme_placeholder: string;
	form_cell_style_rules: string;
	form_quick_style: string;
	form_density: string;
	form_density_compact: string;
	form_density_balanced: string;
	form_density_touch: string;
	form_density_custom: string;
	form_link_cell_dimensions: string;
	form_cell_gap: string;
	form_palette_base_color: string;
	form_generate_palette: string;
	form_empty_cell_color: string;
	form_highlight_today: string;
	form_highlight_weekends: string;
	form_custom_theme_name: string;
	form_save_custom_theme: string;
	form_delete_custom_theme: string;
	form_restore_style_defaults: string;
	form_auto_preview: string;
	form_theme_saved: string;
	form_theme_deleted: string;
	form_theme_name_required: string;
	form_theme_save_failed: string;
	form_confirm_delete_theme: string;
	form_goal_heat_levels: string;
	form_goal_heat_level_threshold: string;
	form_goal_heat_level_emoji: string;
	form_goal_heat_level_add: string;
	form_goal_heat_level_remove: string;
	form_goal_heat_level_zero_locked: string;
	form_goal_heat_level_invalid: string;
	form_goal_heat_level_duplicate: string;
	form_goal_heat_level_limit: string;

	form_button_preview: string;
	form_button_save: string;

	/**
	 * weekday
	 */
	weekday_sunday: string;
	weekday_monday: string;
	weekday_tuesday: string;
	weekday_wednesday: string;
	weekday_thursday: string;
	weekday_friday: string;
	weekday_saturday: string;

	/**
	 * graph text
	 */
	you_have_no_contributions_on: string;
	you_have_contributed_to: string;
	click_to_load_more: string;
	graph_less: string;
	graph_more: string;
	graph_daily_goal: string;
	graph_status_untracked: string;
	graph_status_partial: string;
	graph_status_future: string;
	graph_untracked_on: string;
	graph_partially_tracked_on: string;
	graph_folder_missing: string;
	graph_folder_outside_scope: string;
	graph_folder_legacy_excluded: string;
	graph_close_details: string;
	graph_edit_activity_summary: string;
	graph_edit_activity_document_summary: string;
	graph_edit_activity_last_position: string;
	graph_edit_activity_document_history: string;
	graph_edit_activity_unattributed_document: string;
	graph_counting_policy_changed: string;
	graph_stat_added: string;
	graph_stat_deleted: string;
	graph_stat_changed: string;
	graph_stat_goal: string;
	graph_characters_unit: string;
	graph_dataview_timeout: string;
	graph_dataview_timeout_recommendation: string;

	/**
	 * plugin settings
	 */
	settings_activity_heading: string;
	settings_activity_description: string;
	settings_tracking_enabled: string;
	settings_tracking_enabled_description: string;
	settings_tracking_started: string;
	settings_tracking_paused: string;
	settings_counting_summary: string;
	settings_summary_strict: string;
	settings_summary_compatible: string;
	settings_summary_include_paste: string;
	settings_summary_exclude_paste: string;
	settings_summary_ignore_whitespace: string;
	settings_summary_include_whitespace: string;
	settings_summary_ignore_markdown: string;
	settings_summary_include_markdown: string;
	settings_summary_all_folders: string;
	settings_summary_folder_count: string;
	settings_character_rules_heading: string;
	settings_input_sources_heading: string;
	settings_collection_scope_heading: string;
	settings_counting_policy_updated: string;
	settings_exclude_whitespace: string;
	settings_exclude_whitespace_description: string;
	settings_exclude_markdown_formatting: string;
	settings_exclude_markdown_formatting_description: string;
	settings_strict_user_input: string;
	settings_strict_user_input_description: string;
	settings_count_pasted_text: string;
	settings_count_pasted_text_description: string;
	settings_count_ai_edits: string;
	settings_count_ai_edits_description: string;
	settings_tracked_folders: string;
	settings_tracked_folders_description: string;
	settings_tracked_folders_choose: string;
	settings_tracked_folders_remove: string;
	settings_tracked_folders_all: string;
	settings_tracked_folder_missing: string;
	settings_data_heading: string;
	settings_export: string;
	settings_export_description: string;
	settings_export_button: string;
	settings_export_success: string;
	settings_export_downloaded: string;
	settings_import: string;
	settings_import_description: string;
	settings_import_button: string;
	settings_import_success: string;
	settings_import_failed: string;
	settings_restore: string;
	settings_restore_description: string;
	settings_restore_button: string;
	settings_restore_confirm: string;
	settings_restore_success: string;
	settings_restore_none: string;
	settings_restore_failed: string;
	settings_backup_failed: string;
	settings_corrupt_data_recovered: string;
	settings_save_failed: string;
	settings_clear: string;
	settings_clear_description: string;
	settings_clear_button: string;
	settings_clear_confirm: string;
	settings_clear_success: string;
}
