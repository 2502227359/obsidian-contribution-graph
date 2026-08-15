
![](attachment/d20ba90e31c16a3c4d79cba9298577de.png)

# Contribution Graph Local

This is an independently identified local build. Its plugin ID is not linked
to the Obsidian community-store entry, so community updates cannot overwrite
the local modifications.

## What

Contribution Graph is a plugin for [obsidian.md](https://obsidian.md/) which can generate interactive heatmap graphs like GitHub to track your notes, habits, activity, history, and so on.

## Use Cases

- Habit Tracker: Count the number of tasks you complete every day. Different numbers will be marked in different colors.
- Note Tracker: Count the number of notes you create every day. Different numbers will be marked in different colors.
- Review Report: Count your notes or tasks for a certain period of time and generate a heat map for a more intuitive review
- and more...

## Quick Start

- Create empty note, then right-click
- Select **Add Heatmap** options
- Click the `save` button, and then a heatmap will be created in note.

![Alt text](attachment/contribution-graph-create.gif)

## Themes

- Git Style

![alt text](attachment/image-1.png)

- Month Track

![alt text](attachment/image-2.png)

- Calendar

![alt text](attachment/image.png)

## Features

- **Multiple graph types**, support week-track(default), month-track, and calendar view.
- **Personalized style**, you can configure cell colors and fill cells with emojis.
- **Customizable dates**,use fixed date range or latest date to generate graph
- **Interactive charts**, you can customize cell click event, hover to show statistic data
- **Integrate with DataviewJS**, use contribution graph's api to dynamically render charts 
- **Local edit activity**, track characters added and deleted in the Obsidian editor without storing note contents
- **Responsive and accessible heatmaps**, keep recent dates visible, adapt month layouts to narrow panes, and open day details with the keyboard

![](attachment/74103317de5336b5283338c56171f268.png)

## Character Edit Activity

Enable **Settings → Contribution Graph → Track edit activity**, then create a
graph with the internal edit activity data source:

```contributionGraph
title: Writing activity
graphType: default
dateRangeType: LATEST_DAYS
dateRangeValue: 180
dataSource:
  type: EDIT_ACTIVITY
  metric: CHANGED_CHARS
  folders:
    - Projects/Writing
heatScale:
  type: GOAL
  goal: 1000
```

`CHANGED_CHARS` counts added plus deleted characters. You can also use
`ADDED_CHARS` or `DELETED_CHARS`. The tracker records user edits on the current
device only, starts when enabled, ignores whitespace by default, and never
stores note contents. Strict input filtering is enabled by default, so template
insertions and other edits without a trusted keyboard, IME, clipboard, or drop
event are excluded. The separate **Count pasted text** setting can exclude the
entire paste operation while continuing to count typing, IME, cut, and drop
edits. The optional **Ignore Markdown formatting marks** setting uses Obsidian's
parsed Markdown structure to exclude recognized heading, list, quote, emphasis,
link, code-fence, task-box, and table delimiters from future edits while keeping
prose punctuation, link text, and code contents countable. Markdown-aware edits
are settled from the final syntax of the current line when the cursor leaves it,
the editor loses focus, or the app enters the background. The settings page
groups character, input-source, and collection-scope policies and shows a compact
summary of the active combination. Dates before tracking started are shown as
untracked.

Counting-policy changes are timestamped in local plugin data. If more than one
policy contributes to the same day, the contribution detail explicitly warns
that the total combines data from before and after the change. Existing totals
are never recalculated.
The plugin setting defines the maximum scope collected from future edits. Each
heatmap can then select its own `dataSource.folders` from the vault, so separate
graphs can monitor different projects with different goals. Leaving a graph's
folder selection empty shows all activity available inside the global
collection scope. A per-graph folder must be inside that global scope.

Heatmaps use Obsidian theme colors for their surrounding UI while preserving
configured heat-level colors. Git and month-track views remain horizontally
scrollable in narrow panes; Git view opens at the latest dates, and month labels
remain visible while scrolling. Clicking a date keeps it highlighted and edit
activity details show added, deleted, changed, and goal-completion totals in a
compact summary. Date cells can also be reached with Tab, traversed with the
arrow keys, and opened with Enter or Space.

The graph editor previews changes automatically after a short debounce. Its
style tab includes compact, balanced, touch-friendly, and custom density modes;
linked cell dimensions; cell spacing; empty-cell color; and optional today and
weekend emphasis. Edit-activity graphs start with four goal levels, but the
editor can add, remove, and reorder levels by starting percentage, with up to
eight levels created visually and existing YAML scales of up to twenty levels
preserved. A base color generates a sequential palette sized to the current
scale. Reusable themes resample their colors without changing goal thresholds
or emoji, and can save the complete visual combination locally.
Use **Restore style defaults** to reset only the current graph's presentation.

Imports and data clearing create an automatic snapshot in the plugin directory
before replacing any statistics. Use **Settings → Contribution Graph Local →
Restore latest automatic backup** to recover the most recent snapshot. Restore
also backs up the current state first.

DataviewJS can read the recorded daily totals without becoming responsible for
collecting them:

```js
const stats = window.contributionGraphApi.getDailyEditStats({
  fromDate: "2026-01-01",
  toDate: "2026-12-31",
  folders: ["Projects/Writing"]
});
```


### How to Modify Graph?

Just click the edit button at top right corner

![Alt text](attachment/contribution-graph-edit.gif)

### Configurations

| name                   | description                                                           | type                    | default    | sample     | required                                 |
| ---------------------- | --------------------------------------------------------------------- | ----------------------- | ---------- | ---------- | ---------------------------------------- |
| title                  | the title of the graph                                                | string                  | Contributions         |            | false                                    |
| titleStyle             | the style of the title                                                | object                  |          |            |   false                                       |
| days                   | Maximum number of days for the chart to display (starting from today) | number                  |            | 365        | true if miss **fromDate** and **toDate** |
| fromDate               | The start date of the chart                                           | date, format yyyy-MM-dd |            | 2023-01-01 | true if miss **days**                    |
| toDate                 | The end date of the chart                                             | date, format yyyy-MM-dd |            | 2023-12-31 | true if miss **days**                    |
| query                  | dataview query syntax, contribution graph will use it to count files  | string                  |            |            | true                                     |
| dateField              | Date attributes of files used for data distribution                   | string                  | file.ctime | createTime | false                                    |
| startOfWeek            | start of week                                                         | number                  | 0          |            | false                                    |
| showCellRuleIndicators | Control the display and hiding of cell rule indicator elements        | boolean                 | true       |            | false                                    |
| cellStyleRules         | cell style rule                                                       | array                   |            |            | false                                    |
| appearance             | density, gap, empty-cell color, and date emphasis                     | object                  | balanced   |            | false                                    |

## More Usage Guides

- [API Usage, Integrate with DataviewJS ](README_ADVANCED.md)
- [Basic Codeblock Usage](README_BASIC.md)
- [Development log](CHANGELOG.md)

## Development and Packaging

```bash
npm test
npm run build
npm run package
```

`npm run package` validates that package and manifest versions match, then
stages the installable files and SHA-256 checksums under
`dist/contribution-graph-local/`.
