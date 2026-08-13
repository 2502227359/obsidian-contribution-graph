import { Local } from "./types";

export class En implements Local {
    default = "default";
	click_to_reset = "click to reset";

    /**
     * context menu
     */
    context_menu_create = "Add Heatmap";
	codeblock_edit_graph = "Edit heatmap settings";
	codeblock_edit_unavailable = "The original heatmap block can no longer be located safely. Reopen the note and try again.";

    /**
     * form
     */
    form_basic_settings = "Basic Settings";
    form_style_settings = "Style Settings";
    form_about = "About";
    form_local_edition = "Local edition";
    form_local_edition_description = "Independent local plugin ID; Obsidian community updates will not overwrite this build.";
    form_title = "Title";
    form_title_placeholder = "Input title";
    form_graph_type = "Graph Type";
    form_graph_type_git = "Git Style";
    form_graph_type_month_track = "Month Track";
    form_graph_type_calendar = "Calendar";
    form_date_range = "Date Range";
    form_date_range_latest_days = "Latest Days";
    form_date_range_latest_month = "Latest Whole Month";
    form_date_range_latest_year = "Latest Whole Year";
    form_date_range_input_placeholder = "Input number here";
    form_date_range_fixed_date = "Fixed Date";
    form_date_range_start_date = "Start Date";

    form_start_of_week = "Start of Week";
    form_data_source_value = "Source";
    form_data_source_filter_label = "Filter";

    form_datasource_filter_type_none = "None";
    form_datasource_filter_type_status_is = "Status Is";
    form_datasource_filter_type_contains_any_tag = "Contains Any Tag";
	form_datasource_filter_type_status_in = "Status In";

    form_datasource_filter_task_none = "None";
    form_datasource_filter_task_status_completed = "Completed";
    form_datasource_filter_task_status_fully_completed = "Fully completed";
    form_datasource_filter_task_status_any = "Any Status";
    form_datasource_filter_task_status_incomplete = "Incomplete";
	form_datasource_filter_task_status_canceled = "Canceled";
    form_datasource_filter_contains_tag = "Contains Any Tag";
    form_datasource_filter_contains_tag_input_placeholder = "Please input tag, such as #todo";
    form_datasource_filter_customize = "Customize";

    form_query_placeholder = ' such as #tag or "folder"';

    form_date_field = "Date Field";
    form_date_field_type_file_name = "File Name";
    form_date_field_type_file_ctime = "File Create Time";
    form_date_field_type_file_mtime = "File Modify Time";
    form_date_field_type_file_specific_page_property = "Specific Page Property";
    form_date_field_type_file_specific_task_property = "Specific Task Property";

    form_date_field_placeholder = "default is file's create time";

    form_date_field_format = "Date Field Format";
    form_date_field_format_sample = "Sample";
    form_date_field_format_description =
        "If your date property value is not a standard format, you need to specify this field so that the system knows how to recognize your date format";
    form_date_field_format_placeholder = "such as yyyy-MM-dd HH:mm:ss";

    form_date_field_format_type_smart = "Auto Detect";

    form_date_field_format_type_manual = "Specify Format";

    form_count_field_count_field_label = "Count Field";

    form_count_field_count_field_input_placeholder = "Please input property name";

    form_count_field_count_field_type_default = "Default";

    form_count_field_count_field_type_page_prop = "Page Property";

    form_count_field_count_field_type_task_prop = "Task Property";
    form_title_font_size_label = "Title font Size";
    form_number_input_min_warning = "allow min value is {value}";
    form_number_input_max_warning = "allow max value is {value}";
    form_fill_the_screen_label = "Fill The Screen";
    form_main_container_bg_color = "Background Color";
    form_enable_main_container_shadow = "Enable Shadow";
    form_show_cell_indicators = "Show Cell Indicators";
    form_cell_shape = "Cell Shape";
    form_cell_shape_circle = "Circle";
    form_cell_shape_square = "Square";
    form_cell_shape_rounded = "Rounded";
    form_cell_min_height = "Min Height";
    form_cell_min_width = "Min Width";

    form_datasource_type_page = "Page";
    form_datasource_type_all_task = "All Task";
    form_datasource_type_task_in_specific_page = "Task in Specific Page";
	form_datasource_type_edit_activity = "Edit activity";
	form_edit_activity_metric = "Metric";
	form_edit_activity_metric_changed = "Changed characters (added + deleted)";
	form_edit_activity_metric_added = "Added characters";
	form_edit_activity_metric_deleted = "Deleted characters";
	form_edit_activity_folders = "Folders";
	form_edit_activity_folders_all = "With no selection, show every document inside the global collection scope";
	form_edit_activity_folders_choose = "Choose folder";
	form_edit_activity_folder_remove = "Remove this folder";
	form_edit_activity_folder_missing = "This folder is missing or was renamed";
	form_edit_activity_folder_outside_scope = "This folder is outside the plugin's global collection scope, so data cannot be complete";
	form_daily_goal = "Daily goal";
	form_daily_goal_description = "The darkest level means the goal is reached; raw character counts are never capped";
	form_activity_tracking_enabled = "Edit activity tracking is enabled";
	form_activity_tracking_disabled = "Edit activity tracking is off. Enable it in the plugin settings";

    form_theme = "Theme";
    form_theme_placeholder = "Select theme or customize style";
    form_cell_style_rules = "Cell Style Rules";
	form_goal_heat_levels = "Goal level colors";

    form_button_preview = "Preview";
    form_button_save = "Save";

    /**
     * weekday
     */
    weekday_sunday = "Sunday";
    weekday_monday = "Monday";
    weekday_tuesday = "Tuesday";
    weekday_wednesday = "Wednesday";
    weekday_thursday = "Thursday";
    weekday_friday = "Friday";
    weekday_saturday = "Saturday";

    /**
     * graph text
     */
    you_have_no_contributions_on = "No contributions on {date}";
    you_have_contributed_to = "{value} contributions on {date}";
    click_to_load_more = "Click to load more...";
	graph_less = "Less";
	graph_more = "More";
	graph_untracked_on = "Edit activity was not being tracked on {date}";
	graph_partially_tracked_on = "Only part of the requested folder scope was tracked on {date}; this value may be incomplete";
	graph_folder_missing = "Tracked folder does not exist: {folder}";
	graph_folder_outside_scope = "Tracked folder is outside the global collection scope: {folder}";
	graph_folder_legacy_excluded = "Historical characters that cannot be attributed to a document are excluded from folder views.";
	graph_close_details = "Close contribution details";
	graph_edit_activity_summary = "{date}: {added} added, {deleted} deleted, {changed} characters changed, {percent}% of goal";
	graph_edit_activity_document_summary = "{added} added · {deleted} deleted · {changed} changed";
	graph_edit_activity_last_position = "Last edit: line {line}, column {column}";
	graph_edit_activity_document_history = "Document edit history, {count} items";
	graph_edit_activity_unattributed_document = "Unattributed document (collected before upgrade)";
	graph_characters_unit = "characters";
	graph_dataview_timeout = "Dataview indexing did not finish in time";
	graph_dataview_timeout_recommendation = "Check that Dataview is enabled, then reopen the note or reload the plugin.";

	settings_activity_heading = "Edit activity";
	settings_activity_description = "Tracks character changes in the Obsidian editor on this device. File paths and character counts are saved for daily document details, but note contents are never stored. In strict mode, only changes matched to trusted input events are collected.";
	settings_tracking_enabled = "Track edit activity";
	settings_tracking_enabled_description = "Start recording added and deleted characters from today. Paused periods appear as untracked in heatmaps.";
	settings_tracking_started = "Edit activity tracking started";
	settings_tracking_paused = "Edit activity tracking paused";
	settings_exclude_whitespace = "Ignore whitespace";
	settings_exclude_whitespace_description = "Do not count spaces, tabs, or line breaks. Punctuation and emoji are still counted.";
	settings_strict_user_input = "Strictly exclude automated edits";
	settings_strict_user_input_description = "Only count edits directly triggered by typing, IME, and enabled clipboard or drop actions. Turning this off improves compatibility with editor plugins, but templates and other automated insertions may be counted.";
	settings_count_pasted_text = "Count pasted text";
	settings_count_pasted_text_description = "Include manually pasted text in edit activity. When disabled, the entire paste replacement is excluded, including characters replaced by the paste.";
	settings_tracked_folders = "Tracked folders";
	settings_tracked_folders_description = "Choose one or more folders from the current vault. Changes apply only to future edits. In strict mode, automated template insertions inside included documents are excluded.";
	settings_tracked_folders_choose = "Choose folder";
	settings_tracked_folders_remove = "Remove this folder";
	settings_tracked_folders_all = "The whole vault is currently tracked.";
	settings_tracked_folder_missing = "This folder no longer exists. You can remove this path.";
	settings_data_heading = "Data management";
	settings_export = "Export statistics";
	settings_export_description = "Copy JSON to the clipboard, or download it when clipboard access is unavailable.";
	settings_export_button = "Export";
	settings_export_success = "Edit activity data copied";
	settings_export_downloaded = "Edit activity data downloaded";
	settings_import = "Import statistics";
	settings_import_description = "Restore statistics and tracking settings from an exported JSON file. Current data is backed up before replacement.";
	settings_import_button = "Choose file";
	settings_import_success = "Edit activity data imported; previous data was backed up";
	settings_import_failed = "Import failed: invalid data";
	settings_restore = "Restore latest automatic backup";
	settings_restore_description = "Restore the most recent snapshot created before an import, clear, or earlier restore. The current data is backed up first.";
	settings_restore_button = "Restore";
	settings_restore_confirm = "Restore the latest automatic backup? The current statistics will be backed up first.";
	settings_restore_success = "Latest edit activity backup restored";
	settings_restore_none = "No automatic edit activity backup was found";
	settings_restore_failed = "The backup could not be read or restored; current data was not replaced";
	settings_backup_failed = "The operation was stopped because edit activity data could not be backed up";
	settings_corrupt_data_recovered = "Invalid edit activity data was recovered and backed up to {path}";
	settings_save_failed = "Failed to save edit activity data; retrying automatically";
	settings_clear = "Clear statistics";
	settings_clear_description = "Remove all recorded daily character statistics after creating an automatic backup.";
	settings_clear_button = "Clear";
	settings_clear_confirm = "Clear all edit activity statistics? An automatic backup will be created first.";
	settings_clear_success = "Edit activity statistics cleared; a backup was created";
}
