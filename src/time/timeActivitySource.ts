import { isFileInCollectionScope } from "../activity/folderScope";

// 独立活动的保留源键，不对应仓库文件，也不记录对话内容或会话编号。
export const YOLO_CHAT_ACTIVITY_PATH = "activity://yolo-chat";
export const YOLO_CHAT_ACTIVITY_LABEL = "YOLO 对话活动";
export const YOLO_CHAT_VIEW_TYPE = "yolo-chat-view";

export function isYoloChatActivity(path: unknown): boolean {
	return path === YOLO_CHAT_ACTIVITY_PATH;
}

/** 笔记遵循目录采集范围；用户启用时长统计时也采集独立 YOLO 活动。 */
export function isTimeActivityInCollectionScope(
	path: string,
	folders: readonly string[],
	files: readonly string[] = []
): boolean {
	return isYoloChatActivity(path) || isFileInCollectionScope(path, folders, files);
}
