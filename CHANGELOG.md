# Development Log

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

- `npm test`: 69 tests passed across character counting, trusted-input
  classification, template exclusion, IME composition,
  metric mapping, heat levels, date boundaries, path migration, persistence,
  save retry, pause/resume coverage, invalid imports, theme mapping, and folder
  scope matching.
- `npm run build`: TypeScript checking and the production bundle completed
  successfully.
