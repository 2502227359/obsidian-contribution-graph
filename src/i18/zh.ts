import { Local } from "./types";

export class Zh implements Local {
	default = "默认";
	click_to_reset = "点击重置";
    /**
     * context menu
     */
    context_menu_create = "新建热力图";
	codeblock_edit_graph = "编辑热力图设置";

    /**
     * form
     */
    form_basic_settings = "基础设置";
    form_style_settings = "样式设置";
    form_about = "关于";
    form_local_edition = "本地版本";
	form_local_edition_description = "使用独立的本地插件 ID，Obsidian 社区更新不会覆盖此版本。";
    form_title = "标题";
    form_title_placeholder = "输入标题";
    form_graph_type = "图表类型";
    form_graph_type_git = "Git 视图";
    form_graph_type_month_track = "月追踪视图";
    form_graph_type_calendar = "日历视图";
    form_date_range = "日期范围";
    form_date_range_latest_days = "最近几天";
    form_date_range_latest_month = "最近几个整月";
	form_date_range_latest_year = "最近几个整年";
    form_date_range_input_placeholder = "在这里输入数值";
    form_date_range_fixed_date = "固定日期";
    form_date_range_start_date = "开始日期";

    form_start_of_week = "每周开始于";
    form_data_source_value = "来源";
    form_data_source_filter_label = "筛选";

    form_datasource_filter_type_none = "无";
    form_datasource_filter_type_status_is = "状态等于";
    form_datasource_filter_type_contains_any_tag = "包含任意标签";
    form_datasource_filter_type_status_in = "包含任意一个状态";

    form_datasource_filter_task_none = "无";
    form_datasource_filter_task_status_completed = "已完成（不包含子任务）";
    form_datasource_filter_task_status_fully_completed = "已完成（包含子任务）";
	form_datasource_filter_task_status_canceled = "已取消";
    form_datasource_filter_task_status_any = "任意状态";
    form_datasource_filter_task_status_incomplete = "未完成";
    form_datasource_filter_contains_tag = "包含任意一个标签";
    form_datasource_filter_contains_tag_input_placeholder = "请输入标签，比如 #todo";
    form_datasource_filter_customize = "自定义";

    form_query_placeholder = '比如 #tag 或 "folder"';

    form_date_field = "日期字段";
    form_date_field_type_file_name = "文件名称";
    form_date_field_type_file_ctime = "文件创建日期";
    form_date_field_type_file_mtime = "文件修改日期";
    form_date_field_type_file_specific_page_property = "指定文档属性";
    form_date_field_type_file_specific_task_property = "指定任务属性";

    form_date_field_placeholder = "默认为文件的创建日期";

    form_date_field_format = "日期格式";
    form_date_field_format_sample = "示例值";
    form_date_field_format_description = "如果你的日期属性值不是标准的格式，需要指定该字段让系统知道如何识别你的日期格式";
    form_date_field_format_placeholder = "比如 yyyy-MM-dd HH:mm:ss";

    form_date_field_format_type_smart = "自动识别";

    form_date_field_format_type_manual = "指定格式";

    form_count_field_count_field_label = "打分属性";

    form_count_field_count_field_input_placeholder = "请输入属性名称";

    form_count_field_count_field_type_default = "默认";

    form_count_field_count_field_type_page_prop = "文档属性";

    form_count_field_count_field_type_task_prop = "任务属性";
    form_title_font_size_label = "标题字体大小";
    form_number_input_min_warning = "允许的最小值为 {value}";
	form_number_input_max_warning = "允许的最大值为 {value}";
    form_fill_the_screen_label = "充满屏幕";
    form_main_container_bg_color = "背景颜色";
	form_enable_main_container_shadow = "启用阴影";
    form_show_cell_indicators = "显示单元格指示器";
    form_cell_shape = "单元格形状";
    form_cell_shape_circle = "圆形";
    form_cell_shape_square = "方块";
    form_cell_shape_rounded = "圆角";
    form_cell_min_height = "单元格最小高度";
	form_cell_min_width = "单元格最小宽度";

    form_datasource_type_page = "文档";
    form_datasource_type_all_task = "所有任务";
    form_datasource_type_task_in_specific_page = "指定文档中的任务";
	form_datasource_type_edit_activity = "编辑活动";
	form_edit_activity_metric = "统计指标";
	form_edit_activity_metric_changed = "总编辑字符（新增 + 删除）";
	form_edit_activity_metric_added = "新增字符";
	form_edit_activity_metric_deleted = "删除字符";
	form_edit_activity_folders = "监控文件夹";
	form_edit_activity_folders_all = "未选择时显示全局采集范围内的全部文档";
	form_edit_activity_folders_choose = "选择文件夹";
	form_edit_activity_folder_remove = "移除此文件夹";
	form_edit_activity_folder_missing = "文件夹不存在或已被重命名";
	form_edit_activity_folder_outside_scope = "该范围不在插件的全局采集范围内，无法获得完整数据";
	form_daily_goal = "每日目标";
	form_daily_goal_description = "达到目标后显示最深色，实际字符数不会被截断";
	form_activity_tracking_enabled = "编辑活动采集已开启";
	form_activity_tracking_disabled = "编辑活动采集尚未开启，请前往插件设置启用";

    form_theme = "主题";
    form_theme_placeholder = "选择主题或自定义样式";
    form_cell_style_rules = "单元格样式规则";
	form_goal_heat_levels = "目标比例颜色";

    form_button_preview = "预览";
    form_button_save = "保存";

    /**
     * weekday
     */
    weekday_sunday = "周日";
    weekday_monday = "周一";
    weekday_tuesday = "周二";
    weekday_wednesday = "周三";
    weekday_thursday = "周四";
    weekday_friday = "周五";
    weekday_saturday = "周六";

    /**
     * graph text
     */
    you_have_no_contributions_on = "你在 {date} 没有任何贡献";
    you_have_contributed_to = "你在 {date} 有 {value} 次贡献";
    click_to_load_more = "点击加载更多......";
	graph_less = "较少";
	graph_more = "较多";
	graph_untracked_on = "{date} 尚未启用编辑活动采集";
	graph_partially_tracked_on = "{date} 的目录范围仅采集了部分时间，数值可能不完整";
	graph_folder_missing = "监控文件夹不存在：{folder}";
	graph_folder_outside_scope = "监控文件夹超出插件设置中的全局采集范围：{folder}";
	graph_folder_legacy_excluded = "按文件夹查看时，升级前无法归属到文档的历史字符已排除。";
	graph_close_details = "关闭贡献详情";
	graph_edit_activity_summary = "{date}：新增 {added}，删除 {deleted}，总编辑 {changed} 字符，完成目标 {percent}%";
	graph_edit_activity_document_summary = "新增 {added} · 删除 {deleted} · 总编辑 {changed} 字符";
	graph_edit_activity_last_position = "最后编辑：第 {line} 行，第 {column} 列";
	graph_edit_activity_document_history = "文档编辑历史，共 {count} 项";
	graph_edit_activity_unattributed_document = "未归属文档（升级前采集的数据）";
	graph_characters_unit = "字符";

	settings_activity_heading = "编辑活动";
	settings_activity_description = "统计当前设备上 Obsidian 编辑器内的字符变化。为显示每日文档明细，会保存文件路径和字符数，但不会保存笔记内容；严格模式下仅采集能匹配到真实输入事件的修改。";
	settings_tracking_enabled = "采集编辑活动";
	settings_tracking_enabled_description = "开启后从今天开始记录新增和删除字符；关闭期间在热力图中显示为未采集。";
	settings_tracking_started = "编辑活动采集已开启";
	settings_tracking_paused = "编辑活动采集已暂停";
	settings_exclude_whitespace = "忽略空白字符";
	settings_exclude_whitespace_description = "不统计空格、制表符和换行；标点与 emoji 仍会统计。";
	settings_strict_user_input = "严格排除自动修改";
	settings_strict_user_input_description = "仅统计由键盘、输入法及已启用的剪贴板或拖放操作直接触发的编辑。关闭后兼容更多编辑插件，但模板等自动插入可能被统计。";
	settings_count_pasted_text = "统计粘贴内容";
	settings_count_pasted_text_description = "将用户手动粘贴的文本计入编辑活动。关闭后会排除整笔粘贴替换，包括粘贴时被替换的字符。";
	settings_tracked_folders = "统计文件夹";
	settings_tracked_folders_description = "从当前仓库选择一个或多个文件夹。修改后只影响之后的编辑；严格模式下会排除范围内文档的模板自动插入。";
	settings_tracked_folders_choose = "选择文件夹";
	settings_tracked_folders_remove = "移除此文件夹";
	settings_tracked_folders_all = "当前统计整个仓库。";
	settings_tracked_folder_missing = "该文件夹当前不存在，可以移除此路径。";
	settings_data_heading = "数据管理";
	settings_export = "导出统计";
	settings_export_description = "复制 JSON 到剪贴板；剪贴板不可用时自动下载文件。";
	settings_export_button = "导出";
	settings_export_success = "编辑活动数据已复制";
	settings_export_downloaded = "编辑活动数据已下载";
	settings_import = "导入统计";
	settings_import_description = "从本插件导出的 JSON 文件恢复统计和采集设置。";
	settings_import_button = "选择文件";
	settings_import_success = "编辑活动数据已导入";
	settings_import_failed = "导入失败：文件格式不正确";
	settings_corrupt_data_recovered = "编辑活动数据存在异常，已恢复可用数据并备份到 {path}";
	settings_save_failed = "编辑活动数据保存失败，将自动重试";
	settings_clear = "清除统计";
	settings_clear_description = "永久清除所有已记录的每日字符数据。";
	settings_clear_button = "清除";
	settings_clear_confirm = "确定清除全部编辑活动统计吗？此操作无法撤销。";
	settings_clear_success = "编辑活动统计已清除";
}
