# Development Log

## 2026年11月18日 — 零点二十九点二 周回顾与时间轴容器打磨

- 周回顾顶部按日期和筛选组织，分组层级收进“显示”，保留原有目录、参考目标和所有分析入口；统一菜单边界、卡片层次、间距和选中状态。
- 投入结构与时间轴共用低饱和度配色，弱化图表网格；悬浮和时段筛选时其他数据仍保持可辨认。
- 嵌入学习时间轴复用普通热力图的背景、圆角、边框和阴影，支持既有容器样式；放大弹窗与周回顾内部不重复套外框。
- 保留霞鹜文楷，不增加分析功能，不改变计时、统计、采集范围或持久化格式。

## 2026年11月17日 — 零点二十九点一 时间轴显示优化

- 日期导航与常用图表操作分组，轨道层级与片段定位收进“显示”，保留原有操作、键盘访问及霞鹜文楷。
- 时间轴色块使用低饱和度配色、细边框及小圆角，弱化网格并改善选中与悬浮层次；色标和明细同步取色，其他图表配色不变。
- 极短片段保持真实时间宽度，短色块不挤入标题，裁剪边缘不画圆角；同篇高亮时其他片段保留可读性。
- 不增加功能，不改变计时、采集范围、持久化格式或统计口径。

## 2026-08-15 — v0.15.0 customizable goal heat levels

### Added

- Added visual add, remove, and percentage-threshold controls for edit-activity
  heat levels. The required zero-percent level stays locked, invalid or
  duplicate drafts never reach live preview, and new levels extend the current
  scale in 25-percent steps.
- Added compact responsive level rows with localized validation, keyboard
  commit/cancel behavior, and horizontally safe legends for larger scales.

### Improved

- Sequential palettes and built-in or saved themes now resample smoothly to the
  current number of levels while preserving the existing four-color output.
- Reusable themes accept one to twenty colors and remain visual-only: applying
  one does not replace a graph's goal, thresholds, or emoji.
- The visual editor can create up to eight levels while preserving and editing
  existing YAML scales containing up to twenty levels.

### Verification

- `npm test`: 108 tests passed, including level mutation and validation,
  variable palette generation, six-level boundary resolution, and one-to-twenty
  color theme persistence.
- `npm run package`: TypeScript validation, production bundling, version
  consistency checks, and release staging passed.

## 2026-08-14 — v0.14.0 style workflow and reusable themes

### Added

- Added debounced live preview to the graph editor, plus one-click restoration
  of the built-in style defaults.
- Added compact, balanced, touch-friendly, and custom density modes. Custom
  sizing supports linked width and height, and every graph can set its cell gap.
- Added configurable empty-cell color and optional today/weekend emphasis while
  retaining Obsidian theme variables as the fallback.
- Added base-color palette generation and two color-vision-friendly presets.
- Added reusable custom graph themes containing heat colors, density, cell
  dimensions and shape, spacing, empty/background colors, date emphasis, and
  shadow state. Themes are stored locally without note content.

### Improved

- All three graph types now consume the same responsive cell-size variables,
  so density presets behave consistently in Git, month-track, and calendar
  views while explicit YAML cell dimensions keep priority.
- Disposed previews can no longer render late Dataview results or stale errors
  into the settings dialog.
- Migrated edit-activity storage to schema version 10. Schema 9 statistics are
  preserved and receive an empty reusable-theme collection automatically.

### Verification

- `npm test`: 96 tests passed, including appearance normalization, palette
  generation, reusable-theme persistence, and schema 9 migration coverage.
- `npm run build`: TypeScript validation and production bundling passed.

## 2026-08-13 — v0.13.0 responsive heatmap refinement

### Improved

- Reorganized chart titles and legends into a compact responsive header. Goal
  legends now show the daily target and explain only the tracking states that
  occur in the visible date range.
- Added persistent selected-day styling, roving arrow-key navigation, native
  keyboard-operable date cells, visible focus states, and focus restoration
  when contribution details close.
- Git and month-track views now keep horizontal scrolling available and show
  subtle overflow-edge cues. Month labels remain visible while scrolling, and
  existing latest-date and preserved-position behavior is retained.
- Calendar months now use a responsive grid, while cells adapt to narrow and
  touch layouts without overriding explicitly configured dimensions.
- Edit-activity details now present added, deleted, changed, and goal progress
  as compact metrics, with collection and counting-policy warnings separated
  from the totals.
- Replaced graph chrome and empty-state hardcoded colors with Obsidian theme
  variables, refined hover/selected states, and respected reduced-motion
  preferences.

### Verification

- `npm test`: 91 tests passed, including keyboard navigation and timeline
  overflow-state coverage.
- `npm run package`: TypeScript and production bundling passed; the installable
  `0.13.0` package and checksums were generated successfully.

## 2026-08-13 — v0.12.0 meaningful character counting

### Added

- Added an optional **Ignore Markdown formatting marks** collection setting.
  It uses Obsidian's incremental Markdown syntax tree to exclude recognized
  formatting delimiters while preserving prose punctuation, link text, URLs,
  and code content.
- Markdown-aware edits on the current line are now coalesced and settled from
  the final syntax tree on line changes, cursor navigation, blur, backgrounding,
  or unload. Pending edits retain their original local date across midnight.
- Formatting inspection is limited to changed ranges and falls back to normal
  counting when no compatible Markdown parse information is available.
- Added timestamped counting-policy periods. Contribution details warn when a
  day's total combines more than one policy, without rewriting historical data.
- Reorganized settings into character policy, input sources, collection scope,
  and data management, with a compact summary of the active policy combination.
- Migrated edit-activity storage to schema version 9. Existing installations
  keep Markdown filtering disabled until explicitly enabled.

### Verification

- `npm test`: 86 tests passed, including formatting-node classification,
  line settlement, midnight attribution, policy history, content-only grapheme
  counting, and schema migration defaults.

## 2026-08-13 — v0.11.0 reliability and recovery hardening

### Fixed

- Date-only contribution values are now parsed as local calendar dates instead
  of UTC timestamps, preventing weekday and month shifts in negative timezones.
- Live Preview settings edits now use Obsidian's source section range and
  verify the original fence before replacing YAML. Backtick/tilde fences,
  indentation, CRLF content, and source-view changes no longer rely on a fixed
  character offset.
- Dataview index waits are shared across rendered graphs, time out with an
  actionable message, and remove their event listener when the last waiting
  code block is destroyed.
- Bumped the local release and aligned `package.json`, the lockfile, and
  `manifest.json` on version `0.11.0`.

### Added

- Imports and data clearing now create an automatic JSON snapshot before any
  in-memory data is replaced. A failed backup stops the destructive operation.
- Added a native Obsidian setting to restore the latest automatic backup;
  restoring first snapshots the current state so the operation can be undone.
- Added `npm run package`, which performs a production build, validates version
  consistency, stages the installable plugin files, and writes SHA-256 sums.

### Verification

- `npm test`: 80 tests passed, including local-date parsing, safe fenced-block
  replacement, shared Dataview wait cleanup/timeout, and backup restoration.
- `npm run package`: production build and release staging completed.

## 2026-07-31 — Local edit activity heatmap

### Added

- Added the `EDIT_ACTIVITY` data source, independent of Dataview, with
  `CHANGED_CHARS`, `ADDED_CHARS`, and `DELETED_CHARS` metrics.
- Added a CodeMirror 6 transaction tracker for user typing, paste, cut, and
  selection replacement. Undo, redo, programmatic changes, non-Markdown files,
  whitespace by default, and intermediate IME composition states are excluded.
- Added daily local persistence for added/deleted character totals,
  per-document aggregates, and the last recorded edit position. Note contents
  are never stored.
- Added tracking controls, whitespace preferences, import, export, corruption
  recovery, save retry, and confirmed data clearing.
- Added strict trusted-input filtering, enabled by default, so template and
  plugin edits without a matching keyboard, IME, clipboard, or drop event are
  excluded. A compatibility toggle restores the previous `userEvent` policy.
- Added an independent paste-counting toggle. When disabled, a paste and any
  selection it replaces are excluded without affecting typing, IME, cut, or
  drop statistics.
- Added a searchable vault-folder picker for limiting collection to one or more
  folders. Empty scope continues to track the whole vault, and configured paths
  follow folder renames.
- Added independent folder filters to each edit-activity heatmap. Folder choices
  are stored in `dataSource.folders`, validated against the global collection
  scope, and can also be passed to `getDailyEditStats()`.
- Added goal-based heat levels with a default daily goal of 1,000 characters
  and distinct untracked/future-day states.
- Added the read-only
  `window.contributionGraphApi.getDailyEditStats()` API.

### Improved

- Rebuilt the Live Preview heatmap settings control as an accessible, stable
  gear button with an icon fallback and non-flickering hover/focus behavior.
- Added daily detail summaries with per-document character totals, a scrollable
  document list, and links that open the document near its last recorded edit
  position.
- Document detail ordering now follows the selected added/deleted/changed
  metric, and stale line/column positions are clamped against the current file
  before navigation.
- Enlarged the contribution-detail close control for desktop and touch use,
  added hover/focus states and localized accessibility labels, and reserved
  summary spacing so the control no longer overlaps text.
- Visible edit-activity graphs refresh automatically after edits, at local
  midnight, and after the app returns to the foreground. The selected detail
  day is preserved across reactive refreshes.
- Edit refreshes are now routed by changed date and file path, so unrelated
  folder-specific heatmaps do not rebuild after every keystroke.
- Collection-scope history now distinguishes fully tracked, partially tracked,
  and untracked dates. Missing/renamed folders and folders outside the global
  scope show explicit errors instead of silently appearing as zero activity.
- Rendering now clears stale DOM before rebuilding, avoids accumulating queried
  data across refreshes, limits queried edit statistics to the visible date
  range, and cleans up graph subscriptions with the code-block lifecycle.
- Default timeline graphs now open at the latest dates when horizontally
  clipped. Reactive refreshes keep following the latest edge unless the user
  has scrolled back to inspect history, and weekday labels remain pinned.
- Theme presets and custom colors now update the four goal-ratio heat levels
  used by edit-activity graphs. Page and task graphs continue to use
  `cellStyleRules`.
- Added strict date-range, goal, heat-level, color, and imported-data
  validation.
- Preserved existing page/task data sources and
  `window.renderContributionGraph` compatibility.

### Local fork identity

- Changed the plugin ID to `contribution-graph-local` so Obsidian community
  updates cannot overwrite this build.
- Removed the original donation, author, and update-facing UI from the local
  fork.

### Verification

- `npm test`: 71 tests passed across character counting, trusted-input
  classification, template exclusion, IME composition,
  metric mapping, heat levels, date boundaries, path migration, persistence,
  save retry, pause/resume coverage, invalid imports, theme mapping, and folder
  scope matching.
- `npm run build`: TypeScript checking and the production bundle completed
  successfully.
