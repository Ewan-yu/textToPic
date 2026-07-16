# Repository Guidelines

## Project Structure & Module Organization

This repository is a dependency-free, client-side text-to-image tool. Runtime code lives at the project root:

- `index.html` defines the Chinese-language editor, controls, preview, and dialogs.
- `styles.css` contains the responsive layout and visual tokens.
- `app.js` handles settings, Canvas text layout, pagination, preview, directory access, and PNG downloads.
- `PROJECT_DESIGN.md` records design and acceptance decisions; `task_plan.md`, `findings.md`, and `progress.md` preserve implementation history.

Keep generated screenshots in `verification/`. That directory and root-level PNG files are intentionally ignored by Git.

## Build, Test, and Development Commands

No package installation or build step is required. Open `index.html` directly, or run a local static server for more realistic browser behavior:

```bash
python -m http.server 8080
```

Then visit `http://localhost:8080`. Before committing, run `git diff --check` to catch whitespace errors and review `git status --short` for unintended artifacts.

## Coding Style & Naming Conventions

Use two-space indentation in HTML, CSS, and JavaScript. Follow the existing vanilla JavaScript style: strict mode, semicolons, double-quoted strings, `camelCase` for variables and functions, and `UPPER_SNAKE_CASE` for constants. Use descriptive CSS class names such as `.preview-meta`; define reusable colors and spacing as custom properties in `:root`. Preserve accessible labels, focus states, and Chinese interface copy. Do not introduce a framework or dependency without a concrete need.

## Testing Guidelines

There is no automated test suite or coverage target. Manually verify text wrapping, preserved blank lines and lists, long-image and fixed-page exports, duplicate filename handling, and download fallbacks. Test current Chrome or Edge for the File System Access API, plus a narrow mobile viewport where directory selection is hidden. Check both short and very long Chinese and English input. Store review screenshots under `verification/` when useful.

## Commit & Pull Request Guidelines

Recent commits use concise, imperative, sentence-case subjects without prefixes, for example `Improve mobile save fallback`. Keep each commit focused on one behavioral change. Pull requests should explain the user-visible result, list manual test cases and browsers, link relevant issues, and include before/after screenshots for layout changes. Call out changes to export naming, browser permissions, or persisted settings explicitly.
