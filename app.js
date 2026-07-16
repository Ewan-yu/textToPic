(function () {
  "use strict";

  const MAX_CANVAS_HEIGHT = 32760;
  const SETTINGS_DB = "text-to-pic-settings";
  const SETTINGS_STORE = "kv";
  const DIRECTORY_KEY = "export-directory";
  const HIGHLIGHT_COLOR = "#ffe568";
  const HIGHLIGHT_TEXT_COLOR = "#2b260f";
  const PNG_FILE_TYPES = [
    {
      description: "PNG 图片",
      accept: { "image/png": [".png"] },
    },
  ];
  const SAMPLE_CONTENT = [
    { text: "今天想分享一个很适合小红书长文的排版方式。\n\n它适合：\n- " },
    { text: "读书笔记", bold: true },
    { text: "\n- 旅行攻略\n- 情绪随笔\n- 产品使用心得\n\n保留你原来的" },
    { text: "换行、空行和列表结构", bold: true },
    { text: "。\n如果文本很长，可以切换到「" },
    { text: "固定分段", highlight: HIGHLIGHT_COLOR },
    { text: "」，生成多张等高图片。" },
  ];

  const THEMES = {
    clean: {
      name: "清白",
      background: "#fff8ed",
      foreground: "#23211d",
      muted: "#8a7460",
      accent: "#c94f3d",
      rule: "#ecdcc6",
    },
    ink: {
      name: "墨绿",
      background: "#eef5ed",
      foreground: "#16342c",
      muted: "#5c7468",
      accent: "#2d7b62",
      rule: "#c9ddd0",
    },
    rose: {
      name: "绯红",
      background: "#fff2f5",
      foreground: "#31181f",
      muted: "#8f5b68",
      accent: "#bd405f",
      rule: "#efd0d8",
    },
    night: {
      name: "夜读",
      background: "#171915",
      foreground: "#f7f0e6",
      muted: "#b7aa95",
      accent: "#e1b75f",
      rule: "#37382f",
    },
  };

  const FONTS = {
    system: {
      name: "现代黑体",
      stack: '"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", Arial, sans-serif',
    },
    serif: {
      name: "书页宋体",
      stack: '"Songti SC", "SimSun", "Noto Serif CJK SC", Georgia, serif',
    },
    kai: {
      name: "手写楷体",
      stack: '"KaiTi", "STKaiti", "Kaiti SC", "Microsoft YaHei", cursive',
    },
  };

  const els = {
    titleInput: document.getElementById("titleInput"),
    textInput: document.getElementById("textInput"),
    boldButton: document.getElementById("boldButton"),
    textColorButton: document.getElementById("textColorButton"),
    textColorPicker: document.getElementById("textColorPicker"),
    highlightButton: document.getElementById("highlightButton"),
    highlightColorPicker: document.getElementById("highlightColorPicker"),
    clearFormatButton: document.getElementById("clearFormatButton"),
    sampleButton: document.getElementById("sampleButton"),
    clearButton: document.getElementById("clearButton"),
    chooseDirectoryButton: document.getElementById("chooseDirectoryButton"),
    clearDirectoryButton: document.getElementById("clearDirectoryButton"),
    saveLine: document.getElementById("saveLine"),
    mobileSaveHint: document.getElementById("mobileSaveHint"),
    directoryStatus: document.getElementById("directoryStatus"),
    themeSelect: document.getElementById("themeSelect"),
    fontSelect: document.getElementById("fontSelect"),
    widthSelect: document.getElementById("widthSelect"),
    sliceHeight: document.getElementById("sliceHeight"),
    fontSize: document.getElementById("fontSize"),
    lineHeight: document.getElementById("lineHeight"),
    pagePadding: document.getElementById("pagePadding"),
    fontSizeValue: document.getElementById("fontSizeValue"),
    lineHeightValue: document.getElementById("lineHeightValue"),
    pagePaddingValue: document.getElementById("pagePaddingValue"),
    previewList: document.getElementById("previewList"),
    previewMeta: document.getElementById("previewMeta"),
    statusText: document.getElementById("statusText"),
    downloadPrimary: document.getElementById("downloadPrimary"),
    downloadAll: document.getElementById("downloadAll"),
    exportDialog: document.getElementById("exportDialog"),
    exportDialogTitle: document.getElementById("exportDialogTitle"),
    exportDialogMessage: document.getElementById("exportDialogMessage"),
    exportDialogClose: document.getElementById("exportDialogClose"),
  };

  if (!els.textInput || !els.previewList) {
    return;
  }

  let renderTimer = 0;
  let latestCanvases = [];
  let latestWarning = "";
  let exportDirectoryHandle = null;
  let savedEditorRange = null;

  function getMode() {
    const checked = document.querySelector('input[name="exportMode"]:checked');
    return checked ? checked.value : "long";
  }

  function getSettings() {
    const fontSize = Number(els.fontSize.value);
    const lineHeight = Number(els.lineHeight.value);

    return {
      mode: getMode(),
      theme: THEMES[els.themeSelect.value] || THEMES.clean,
      font: FONTS[els.fontSelect.value] || FONTS.system,
      title: els.titleInput.value,
      width: Number(els.widthSelect.value),
      sliceHeight: Number(els.sliceHeight.value),
      fontSize,
      lineHeight,
      lineHeightPx: Math.round(fontSize * lineHeight),
      padding: Number(els.pagePadding.value),
    };
  }

  function updateRangeLabels() {
    els.fontSizeValue.textContent = els.fontSize.value;
    els.lineHeightValue.textContent = Number(els.lineHeight.value).toFixed(2);
    els.pagePaddingValue.textContent = els.pagePadding.value;
  }

  function fontString(settings, weight, size) {
    return `${weight || 400} ${size || settings.fontSize}px ${settings.font.stack}`;
  }

  function getContinuationPrefix(line) {
    const listMatch = line.match(
      /^(\s*(?:[-*+]|•|(?:\d+|[a-zA-Z])[.)]|[一二三四五六七八九十]+[、.])\s+)/u,
    );

    if (listMatch) {
      return listMatch[1].replace(/\S/gu, " ");
    }

    const leading = line.match(/^\s*/u);
    return leading ? leading[0] : "";
  }

  function tokenizeWrapUnits(line) {
    const units = [];
    let index = 0;

    while (index < line.length) {
      const rest = line.slice(index);
      const spaceMatch = rest.match(/^[ ]+/u);
      const wordMatch = rest.match(
        /^[A-Za-z0-9]+(?:[._'’-][A-Za-z0-9]+)*(?:[.,!?;:)\]}]+)?/u,
      );

      if (spaceMatch) {
        units.push(spaceMatch[0]);
        index += spaceMatch[0].length;
        continue;
      }

      if (wordMatch) {
        units.push(wordMatch[0]);
        index += wordMatch[0].length;
        continue;
      }

      const char = Array.from(rest)[0];
      units.push(char);
      index += char.length;
    }

    return units;
  }

  function isSpaceUnit(unit) {
    return /^[ ]+$/u.test(unit);
  }

  function trimLineEnd(line) {
    return line.replace(/[ ]+$/u, "");
  }

  function wrapLine(ctx, rawLine, maxWidth) {
    const normalized = rawLine.replace(/\t/g, "    ");
    const continuationPrefix = getContinuationPrefix(normalized);
    const units = tokenizeWrapUnits(normalized);
    const wrapped = [];
    let current = "";

    if (normalized.trim().length === 0) {
      return [normalized];
    }

    for (const unit of units) {
      const candidate = current + unit;

      if (ctx.measureText(candidate).width <= maxWidth || current.length === 0) {
        current = candidate;
        continue;
      }

      const line = trimLineEnd(current);

      if (line.length > 0) {
        wrapped.push(line);
      }

      if (isSpaceUnit(unit)) {
        current = continuationPrefix;
        continue;
      }

      current = continuationPrefix + unit;

      if (ctx.measureText(current).width > maxWidth && continuationPrefix.length > 0) {
        current = unit;
      }
    }

    const finalLine = trimLineEnd(current);

    if (finalLine.length > 0) {
      wrapped.push(finalLine);
    }

    return wrapped.length > 0 ? wrapped : [""];
  }

  function appendStyledRun(runs, text, style) {
    const normalizedText = text.replace(/\r\n?/g, "\n").replace(/\u00a0/g, " ");

    if (normalizedText.length === 0) {
      return;
    }

    const run = {
      text: normalizedText,
      bold: Boolean(style && style.bold),
      color: normalizeStyleColor(style && style.color),
      highlight: normalizeStyleColor(style && style.highlight, HIGHLIGHT_COLOR),
    };
    const previous = runs[runs.length - 1];

    if (
      previous &&
      previous.bold === run.bold &&
      previous.color === run.color &&
      previous.highlight === run.highlight
    ) {
      previous.text += run.text;
      return;
    }

    runs.push(run);
  }

  function hasTrailingNewline(runs) {
    const lastRun = runs[runs.length - 1];
    return Boolean(lastRun && lastRun.text.endsWith("\n"));
  }

  function isTransparentColor(color) {
    if (typeof color !== "string") {
      return true;
    }

    const normalized = color.replace(/\s/g, "").toLowerCase();
    return (
      normalized === "transparent" ||
      normalized === "initial" ||
      normalized === "inherit" ||
      normalized === "rgba(0,0,0,0)"
    );
  }

  function normalizeStyleColor(color, booleanFallback) {
    if (color === true) {
      return booleanFallback || null;
    }

    if (typeof color !== "string" || color.length === 0 || isTransparentColor(color)) {
      return null;
    }

    return color;
  }

  function readEditorDocument() {
    const flatRuns = [];
    const blockTags = new Set(["DIV", "P", "LI", "UL", "OL", "BLOCKQUOTE"]);

    function walk(node, inheritedStyle) {
      if (node.nodeType === Node.TEXT_NODE) {
        appendStyledRun(flatRuns, node.nodeValue || "", inheritedStyle);
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }

      const element = node;

      if (element.tagName === "BR") {
        appendStyledRun(flatRuns, "\n", inheritedStyle);
        return;
      }

      const style = { ...inheritedStyle };
      const fontWeight = element.style.fontWeight.toLowerCase();
      const backgroundColor = element.style.backgroundColor;
      const foregroundColor =
        element.style.color ||
        (element.tagName === "FONT" ? element.getAttribute("color") : "");

      if (element.tagName === "B" || element.tagName === "STRONG") {
        style.bold = true;
      }

      if (fontWeight === "normal" || fontWeight === "400") {
        style.bold = false;
      } else if (
        fontWeight === "bold" ||
        fontWeight === "bolder" ||
        Number.parseInt(fontWeight, 10) >= 600
      ) {
        style.bold = true;
      }

      if (element.tagName === "MARK") {
        style.highlight = HIGHLIGHT_COLOR;
      }

      if (backgroundColor) {
        style.highlight = normalizeStyleColor(backgroundColor);
      }

      if (foregroundColor) {
        style.color = normalizeStyleColor(foregroundColor);
      }

      const isBlock = blockTags.has(element.tagName);

      if (isBlock && flatRuns.length > 0 && !hasTrailingNewline(flatRuns)) {
        appendStyledRun(flatRuns, "\n", {});
      }

      Array.from(element.childNodes).forEach((child) => walk(child, style));

      if (isBlock && element.nextSibling && !hasTrailingNewline(flatRuns)) {
        appendStyledRun(flatRuns, "\n", {});
      }
    }

    Array.from(els.textInput.childNodes).forEach((node) => {
      walk(node, { bold: false, color: null, highlight: null });
    });

    const lines = [[]];

    flatRuns.forEach((run) => {
      const parts = run.text.split("\n");

      parts.forEach((part, index) => {
        appendStyledRun(lines[lines.length - 1], part, run);

        if (index < parts.length - 1) {
          lines.push([]);
        }
      });
    });

    return {
      lines,
      text: lines.map((line) => line.map((run) => run.text).join("")).join("\n"),
    };
  }

  function setEditorContent(runs) {
    const fragment = document.createDocumentFragment();

    runs.forEach((run) => {
      let node = document.createTextNode(run.text);

      if (run.bold) {
        const strong = document.createElement("strong");
        strong.append(node);
        node = strong;
      }

      if (run.color) {
        const colorSpan = document.createElement("span");
        colorSpan.style.color = run.color;
        colorSpan.append(node);
        node = colorSpan;
      }

      if (run.highlight) {
        const mark = document.createElement("mark");
        mark.style.backgroundColor = run.highlight;
        mark.append(node);
        node = mark;
      }

      fragment.append(node);
    });

    els.textInput.replaceChildren(fragment);
    savedEditorRange = null;
  }

  function measureStyledUnit(ctx, unit, settings) {
    ctx.font = fontString(settings, unit.bold ? 700 : 400);
    return ctx.measureText(unit.text).width;
  }

  function mergeStyledUnits(units) {
    const runs = [];

    units.forEach((unit) => appendStyledRun(runs, unit.text, unit));

    return {
      runs,
      text: runs.map((run) => run.text).join(""),
    };
  }

  function trimStyledLineEnd(units) {
    const trimmed = units.map((unit) => ({ ...unit }));

    while (trimmed.length > 0) {
      const last = trimmed[trimmed.length - 1];
      last.text = last.text.replace(/[ ]+$/u, "");

      if (last.text.length > 0) {
        break;
      }

      trimmed.pop();
    }

    return trimmed;
  }

  function wrapStyledLine(ctx, rawRuns, maxWidth, settings) {
    const normalizedRuns = rawRuns.map((run) => ({
      ...run,
      text: run.text.replace(/\t/g, "    "),
    }));
    const plainText = normalizedRuns.map((run) => run.text).join("");

    if (plainText.trim().length === 0) {
      return [mergeStyledUnits(normalizedRuns)];
    }

    const continuationPrefix = getContinuationPrefix(plainText);
    const prefixUnits = continuationPrefix
      ? [{ text: continuationPrefix, bold: false, color: null, highlight: null }]
      : [];
    const prefixWidth = prefixUnits.reduce(
      (sum, unit) => sum + measureStyledUnit(ctx, unit, settings),
      0,
    );
    const units = normalizedRuns.flatMap((run) => {
      return tokenizeWrapUnits(run.text).map((text) => ({
        text,
        bold: run.bold,
        color: run.color,
        highlight: run.highlight,
      }));
    });
    const wrapped = [];
    let current = [];
    let currentWidth = 0;

    units.forEach((unit) => {
      const unitWidth = measureStyledUnit(ctx, unit, settings);

      if (currentWidth + unitWidth <= maxWidth || current.length === 0) {
        current.push(unit);
        currentWidth += unitWidth;
        return;
      }

      const line = trimStyledLineEnd(current);

      if (line.length > 0) {
        wrapped.push(mergeStyledUnits(line));
      }

      if (isSpaceUnit(unit.text)) {
        current = prefixUnits.map((prefixUnit) => ({ ...prefixUnit }));
        currentWidth = prefixWidth;
        return;
      }

      current = [...prefixUnits.map((prefixUnit) => ({ ...prefixUnit })), unit];
      currentWidth = prefixWidth + unitWidth;

      if (currentWidth > maxWidth && prefixUnits.length > 0) {
        current = [unit];
        currentWidth = unitWidth;
      }
    });

    const finalLine = trimStyledLineEnd(current);

    if (finalLine.length > 0) {
      wrapped.push(mergeStyledUnits(finalLine));
    }

    return wrapped.length > 0 ? wrapped : [{ runs: [], text: "" }];
  }

  function createPlainEditorDocument(text) {
    const normalizedText = text.replace(/\r\n?/g, "\n");

    return {
      lines: normalizedText.split("\n").map((line) => {
        return line.length > 0
          ? [{ text: line, bold: false, color: null, highlight: null }]
          : [];
      }),
      text: normalizedText,
    };
  }

  function buildLayout(editorDocument, settings) {
    const documentData =
      typeof editorDocument === "string"
        ? createPlainEditorDocument(editorDocument)
        : editorDocument;
    const measureCanvas = document.createElement("canvas");
    const ctx = measureCanvas.getContext("2d");
    const maxWidth = Math.max(1, settings.width - settings.padding * 2);
    const paragraphGap = Math.max(10, Math.round(settings.fontSize * 0.32));
    const blankGap = Math.max(24, Math.round(settings.lineHeightPx * 0.88));
    const title = settings.title.trim();
    const titleFontSize = Math.round(settings.fontSize * 1.22);
    const titleLineHeight = Math.round(titleFontSize * 1.34);
    const titleGap = Math.max(24, Math.round(settings.fontSize * 0.76));
    const items = [];

    if (title.length > 0) {
      ctx.font = fontString(settings, 750, titleFontSize);

      wrapLine(ctx, title, maxWidth).forEach((line) => {
        items.push({
          kind: "title",
          text: line,
          height: titleLineHeight,
          baseline: Math.round(titleFontSize),
          size: titleFontSize,
          weight: 750,
        });
      });

      items.push({ kind: "space", height: titleGap });
    }

    const rawLines = documentData.lines;
    const hasText = rawLines.some((line) => line.some((run) => run.text.length > 0));

    rawLines.forEach((rawLine, index) => {
      const lineText = rawLine.map((run) => run.text).join("");

      if (lineText.length === 0) {
        if (hasText) {
          items.push({ kind: "space", height: blankGap });
        }
        return;
      }

      const visualLines = wrapStyledLine(ctx, rawLine, maxWidth, settings);

      visualLines.forEach((line) => {
        items.push({
          kind: "text",
          runs: line.runs,
          height: settings.lineHeightPx,
          baseline: Math.round(settings.fontSize),
        });
      });

      if (index < rawLines.length - 1) {
        items.push({ kind: "space", height: paragraphGap });
      }
    });

    const contentHeight =
      settings.padding +
      items.reduce((sum, item) => sum + item.height, 0) +
      settings.padding;

    return {
      items,
      contentHeight: Math.ceil(contentHeight),
      hasText,
    };
  }

  function prepareCanvas(width, height, settings) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    canvas.width = width;
    canvas.height = height;
    canvas.className = "render-canvas";

    ctx.fillStyle = settings.theme.background;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = settings.theme.accent;
    ctx.globalAlpha = 0.95;
    ctx.fillRect(settings.padding, Math.max(42, Math.round(settings.padding * 0.55)), 78, 6);
    ctx.globalAlpha = 1;

    ctx.strokeStyle = settings.theme.rule;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(settings.padding, height - Math.max(42, Math.round(settings.padding * 0.5)));
    ctx.lineTo(width - settings.padding, height - Math.max(42, Math.round(settings.padding * 0.5)));
    ctx.stroke();

    return { canvas, ctx };
  }

  function getHighlightTextColor(color) {
    const normalized = color.replace(/\s/g, "");
    const hexMatch = normalized.match(/^#([0-9a-f]{6})$/i);
    const rgbMatch = normalized.match(/^rgba?\((\d+),(\d+),(\d+)/i);
    let channels = null;

    if (hexMatch) {
      channels = [
        Number.parseInt(hexMatch[1].slice(0, 2), 16),
        Number.parseInt(hexMatch[1].slice(2, 4), 16),
        Number.parseInt(hexMatch[1].slice(4, 6), 16),
      ];
    } else if (rgbMatch) {
      channels = rgbMatch.slice(1, 4).map(Number);
    }

    if (!channels) {
      return HIGHLIGHT_TEXT_COLOR;
    }

    const luminance =
      (channels[0] * 0.299 + channels[1] * 0.587 + channels[2] * 0.114) / 255;
    return luminance > 0.52 ? HIGHLIGHT_TEXT_COLOR : "#fffdf8";
  }

  function drawItems(ctx, items, settings, startY) {
    let y = startY;

    ctx.font = fontString(settings);
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = settings.theme.foreground;

    items.forEach((item) => {
      if (item.kind === "title") {
        ctx.font = fontString(settings, item.weight, item.size);
        ctx.fillStyle = settings.theme.foreground;
        ctx.fillText(item.text, settings.padding, y + item.baseline);
      }

      if (item.kind === "text") {
        let x = settings.padding;
        const baselineY = y + item.baseline;

        item.runs.forEach((run) => {
          ctx.font = fontString(settings, run.bold ? 700 : 400);
          const width = ctx.measureText(run.text).width;

          if (run.highlight && run.text.length > 0) {
            const highlightTop = baselineY - Math.round(settings.fontSize * 0.84);
            const highlightHeight = Math.round(settings.fontSize * 1.08);

            ctx.save();
            ctx.globalAlpha = 0.78;
            ctx.fillStyle = run.highlight;
            ctx.fillRect(x - 2, highlightTop, width + 4, highlightHeight);
            ctx.restore();
          }

          ctx.fillStyle =
            run.color ||
            (run.highlight
              ? getHighlightTextColor(run.highlight)
              : settings.theme.foreground);
          ctx.fillText(run.text, x, baselineY);
          x += width;
        });
      }

      y += item.height;
    });
  }

  function renderLongCanvas(editorDocument, settings) {
    const layout = buildLayout(editorDocument, settings);
    const desiredHeight = Math.max(settings.sliceHeight, layout.contentHeight);
    const canvasHeight = Math.min(desiredHeight, MAX_CANVAS_HEIGHT);
    const { canvas, ctx } = prepareCanvas(settings.width, canvasHeight, settings);

    drawItems(ctx, layout.items, settings, settings.padding);

    if (desiredHeight > MAX_CANVAS_HEIGHT) {
      latestWarning = "长图高度超过浏览器限制，请切换固定分段导出完整内容";
    }

    return [canvas];
  }

  function openSettingsDb() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("当前浏览器不支持目录记忆"));
        return;
      }

      const request = indexedDB.open(SETTINGS_DB, 1);

      request.onupgradeneeded = () => {
        request.result.createObjectStore(SETTINGS_STORE);
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function readSetting(key) {
    const db = await openSettingsDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SETTINGS_STORE, "readonly");
      const request = transaction.objectStore(SETTINGS_STORE).get(key);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  }

  async function writeSetting(key, value) {
    const db = await openSettingsDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SETTINGS_STORE, "readwrite");
      transaction.objectStore(SETTINGS_STORE).put(value, key);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }

  async function deleteSetting(key) {
    const db = await openSettingsDb();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SETTINGS_STORE, "readwrite");
      transaction.objectStore(SETTINGS_STORE).delete(key);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    });
  }

  function supportsDirectoryExport() {
    return window.isSecureContext && typeof window.showDirectoryPicker === "function";
  }

  function supportsSaveFilePicker() {
    return window.isSecureContext && typeof window.showSaveFilePicker === "function";
  }

  function supportsDirectoryMemory() {
    return !isMobileLike() && supportsDirectoryExport() && "indexedDB" in window;
  }

  function isMobileLike() {
    const userAgent = navigator.userAgent || "";
    return (
      /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent) ||
      (navigator.maxTouchPoints > 1 && window.matchMedia("(max-width: 900px)").matches)
    );
  }

  function shouldUseMobileNativeDownload() {
    return isMobileLike();
  }

  function getFallbackSaveLabel() {
    if (shouldUseMobileNativeDownload()) {
      return "浏览器原生下载";
    }

    if (supportsSaveFilePicker()) {
      return "保存窗口";
    }

    return "浏览器下载";
  }

  function getDirectoryUnsupportedMessage() {
    const fallback = getFallbackSaveLabel();

    if (!window.isSecureContext) {
      return `当前页面不是安全上下文，无法固定保存目录，将使用${fallback}`;
    }

    if (isMobileLike()) {
      return `移动端不支持固定保存目录，将使用${fallback}`;
    }

    return `当前浏览器不支持固定目录，将使用${fallback}`;
  }

  function updateDirectoryControls() {
    const directorySupported = supportsDirectoryExport();
    const mobileNativeDownload = shouldUseMobileNativeDownload();

    if (els.saveLine) {
      els.saveLine.hidden = mobileNativeDownload;
    }

    if (els.mobileSaveHint) {
      els.mobileSaveHint.hidden = !mobileNativeDownload;
    }

    els.chooseDirectoryButton.textContent = directorySupported ? "选择目录" : "保存说明";
    els.clearDirectoryButton.disabled = !directorySupported && !exportDirectoryHandle;
  }

  function updateDirectoryStatus(message) {
    if (!els.directoryStatus) {
      return;
    }

    updateDirectoryControls();

    if (message) {
      els.directoryStatus.textContent = message;
      return;
    }

    if (!supportsDirectoryExport()) {
      els.directoryStatus.textContent = getDirectoryUnsupportedMessage();
      return;
    }

    if (exportDirectoryHandle) {
      els.directoryStatus.textContent = `已记住目录：${exportDirectoryHandle.name}`;
      return;
    }

    els.directoryStatus.textContent = "未设置保存目录";
  }

  async function verifyDirectoryPermission(directoryHandle) {
    const options = { mode: "readwrite" };

    if ((await directoryHandle.queryPermission(options)) === "granted") {
      return true;
    }

    return (await directoryHandle.requestPermission(options)) === "granted";
  }

  async function loadSavedDirectory() {
    updateDirectoryControls();

    if (shouldUseMobileNativeDownload()) {
      exportDirectoryHandle = null;
      updateDirectoryStatus();
      return;
    }

    if (!supportsDirectoryMemory()) {
      updateDirectoryStatus();
      return;
    }

    try {
      exportDirectoryHandle = await readSetting(DIRECTORY_KEY);
      updateDirectoryStatus();
    } catch (error) {
      exportDirectoryHandle = null;
      updateDirectoryStatus("目录记忆不可用，将使用普通下载");
    }
  }

  async function chooseDirectory() {
    if (shouldUseMobileNativeDownload()) {
      const message =
        "移动端不支持固定保存目录，点击下载会直接调用浏览器原生下载。请在浏览器下载列表或手机文件管理的下载目录查看图片。";
      updateDirectoryStatus(message);
      showExportDialog("移动端保存说明", message);
      return;
    }

    if (!supportsDirectoryExport()) {
      const message = `${getDirectoryUnsupportedMessage()}。点击下载时会优先弹出可用的保存窗口；如果浏览器不支持，会保存到默认下载目录。`;
      updateDirectoryStatus(message);
      showExportDialog("保存方式说明", message);
      return;
    }

    updateDirectoryStatus("正在打开本地目录选择窗口");
    const directoryHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    const hasPermission = await verifyDirectoryPermission(directoryHandle);

    if (!hasPermission) {
      updateDirectoryStatus("未获得目录写入权限");
      return;
    }

    exportDirectoryHandle = directoryHandle;

    if (!supportsDirectoryMemory()) {
      updateDirectoryStatus(`已选择目录：${directoryHandle.name}（本次有效）`);
      return;
    }

    try {
      await writeSetting(DIRECTORY_KEY, directoryHandle);
      updateDirectoryStatus(`已记住目录：${directoryHandle.name}`);
    } catch (error) {
      updateDirectoryStatus(`已选择目录：${directoryHandle.name}（本次有效，无法记住）`);
    }
  }

  function describeDirectoryError(error) {
    if (!error) {
      return "目录选择失败";
    }

    if (error.name === "AbortError") {
      return "未选择保存目录";
    }

    if (error.name === "SecurityError") {
      return "浏览器阻止目录选择。请用 Chrome 或 Edge 的顶层页面打开，不要嵌入预览窗口";
    }

    return error.message || "目录选择失败";
  }

  async function clearDirectory() {
    exportDirectoryHandle = null;

    try {
      await deleteSetting(DIRECTORY_KEY);
    } catch (error) {
      // Ignore storage cleanup failures; clearing in memory is enough for this session.
    }

    updateDirectoryStatus("已清除保存目录");
  }

  function sanitizeFileBase(title) {
    const clean = title
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[. ]+$/g, "")
      .slice(0, 80)
      .trim();

    return clean || "xiaohongshu";
  }

  function padSerial(number) {
    return String(number).padStart(2, "0");
  }

  function buildExportFileNames(settings, count, aliasIndex) {
    const base = sanitizeFileBase(settings.title);
    const alias = aliasIndex > 0 ? `(${aliasIndex})` : "";

    if (settings.mode === "long") {
      return [`${base}${alias}.png`];
    }

    return Array.from({ length: count }, (_, index) => {
      return `${base}${alias}-${padSerial(index + 1)}.png`;
    });
  }

  async function directoryContains(directoryHandle, filename) {
    try {
      await directoryHandle.getFileHandle(filename, { create: false });
      return true;
    } catch (error) {
      if (error && error.name === "NotFoundError") {
        return false;
      }

      throw error;
    }
  }

  async function createNonOverwritingNames(directoryHandle, settings, count) {
    for (let aliasIndex = 0; aliasIndex <= 999; aliasIndex += 1) {
      const names = buildExportFileNames(settings, count, aliasIndex);
      const collisions = await Promise.all(
        names.map((name) => directoryContains(directoryHandle, name)),
      );

      if (!collisions.some(Boolean)) {
        return names;
      }
    }

    throw new Error("无法生成不重名的文件名");
  }

  function paginateItems(layout, settings) {
    const pages = [];
    let current = [];
    let y = settings.padding;
    let hasContent = false;
    const bottomLimit = settings.sliceHeight - settings.padding;

    function pushPage() {
      pages.push(current);
      current = [];
      y = settings.padding;
      hasContent = false;
    }

    layout.items.forEach((item) => {
      const isSpace = item.kind === "space";

      if (isSpace && !hasContent) {
        return;
      }

      if (y + item.height > bottomLimit && hasContent) {
        pushPage();

        if (isSpace) {
          return;
        }
      }

      current.push(item);
      y += item.height;

      if (item.kind === "text") {
        hasContent = true;
      }
    });

    if (current.length > 0 || pages.length === 0) {
      pages.push(current);
    }

    return pages;
  }

  function renderPageCanvases(editorDocument, settings) {
    const layout = buildLayout(editorDocument, settings);
    const pages = paginateItems(layout, settings);

    return pages.map((items) => {
      const { canvas, ctx } = prepareCanvas(settings.width, settings.sliceHeight, settings);
      drawItems(ctx, items, settings, settings.padding);
      return canvas;
    });
  }

  function appendPreview(canvas, index, total) {
    const frame = document.createElement("div");
    const label = document.createElement("div");
    const pageText = total > 1 ? `第 ${index + 1} 张 / 共 ${total} 张` : "单张长图";
    const sizeText = `${canvas.width} x ${canvas.height}px`;

    frame.className = "preview-frame";
    label.className = "preview-label";
    label.innerHTML = `<span>${pageText}</span><span>${sizeText}</span>`;
    frame.append(label, canvas);
    els.previewList.append(frame);
  }

  function updateActionLabels(settings, count) {
    if (settings.mode === "long") {
      els.downloadPrimary.textContent = "下载长图";
      els.downloadAll.textContent = "下载当前";
      return;
    }

    els.downloadPrimary.textContent = count > 1 ? "下载首张" : "下载分段";
    els.downloadAll.textContent = "下载全部分段";
  }

  function renderPreview() {
    const settings = getSettings();
    const editorDocument = readEditorDocument();

    latestWarning = "";
    latestCanvases =
      settings.mode === "long"
        ? renderLongCanvas(editorDocument, settings)
        : renderPageCanvases(editorDocument, settings);

    els.previewList.replaceChildren();
    latestCanvases.forEach((canvas, index) => appendPreview(canvas, index, latestCanvases.length));

    const suffix = latestWarning ? ` · ${latestWarning}` : "";
    const emptyHint = editorDocument.text.trim().length === 0 ? " · 请输入正文" : "";
    els.previewMeta.textContent = `${latestCanvases.length} 张`;
    els.statusText.textContent = `已生成 ${latestCanvases.length} 张 · ${settings.width}px${suffix}${emptyHint}`;
    updateActionLabels(settings, latestCanvases.length);
  }

  function scheduleRender() {
    updateRangeLabels();
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(renderPreview, 80);
  }

  function showExportDialog(title, message) {
    if (!els.exportDialog) {
      return;
    }

    els.exportDialogTitle.textContent = title;
    els.exportDialogMessage.textContent = message;
    els.exportDialog.hidden = false;
    els.exportDialogClose.focus();
  }

  function hideExportDialog() {
    if (els.exportDialog) {
      els.exportDialog.hidden = true;
    }
  }

  function showExportError(error) {
    const message = error && error.message ? error.message : "导出失败，请重试";
    els.statusText.textContent = message;
    showExportDialog("导出失败", message);
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("图片生成失败"));
          return;
        }

        resolve(blob);
      }, "image/png");
    });
  }

  async function writeBlobToFileHandle(fileHandle, blob) {
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  async function writeCanvasToDirectory(canvas, directoryHandle, filename) {
    const blob = await canvasToBlob(canvas);
    const fileHandle = await directoryHandle.getFileHandle(filename, { create: true });
    await writeBlobToFileHandle(fileHandle, blob);
  }

  async function saveCanvasWithPicker(canvas, filename) {
    const fileHandle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: PNG_FILE_TYPES,
      excludeAcceptAllOption: false,
    });
    const blob = await canvasToBlob(canvas);
    await writeBlobToFileHandle(fileHandle, blob);
  }

  async function saveCanvasesWithPicker(canvases, filenames) {
    let savedCount = 0;

    try {
      for (let index = 0; index < canvases.length; index += 1) {
        await saveCanvasWithPicker(canvases[index], filenames[index]);
        savedCount += 1;
      }
    } catch (error) {
      error.savedCount = savedCount;
      throw error;
    }

    return savedCount;
  }

  async function downloadCanvas(canvas, filename) {
    const blob = await canvasToBlob(canvas);

    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();

      window.setTimeout(() => {
        resolve();
      }, 120);

      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 60000);
    });
  }

  async function downloadCurrent(primaryOnly) {
    if (latestCanvases.length === 0) {
      renderPreview();
    }

    const settings = getSettings();
    const canvases = primaryOnly ? latestCanvases.slice(0, 1) : latestCanvases;

    els.statusText.textContent = `正在导出 ${canvases.length} 张`;

    const filenames = buildExportFileNames(settings, canvases.length, 0);

    if (shouldUseMobileNativeDownload()) {
      for (let index = 0; index < canvases.length; index += 1) {
        await downloadCanvas(canvases[index], filenames[index]);
      }

      const message = `已调用浏览器原生下载 ${canvases.length} 张。请在浏览器下载列表或手机文件管理的下载目录查看图片。`;
      els.statusText.textContent = message;
      showExportDialog("已开始下载", message);
      return;
    }

    if (exportDirectoryHandle) {
      const hasPermission = await verifyDirectoryPermission(exportDirectoryHandle);

      if (hasPermission) {
        const filenames = await createNonOverwritingNames(
          exportDirectoryHandle,
          settings,
          canvases.length,
        );

        for (let index = 0; index < canvases.length; index += 1) {
          await writeCanvasToDirectory(canvases[index], exportDirectoryHandle, filenames[index]);
        }

        const message = `已保存 ${canvases.length} 张到 ${exportDirectoryHandle.name}`;
        els.statusText.textContent = message;
        showExportDialog("保存完成", message);
        return;
      }

      updateDirectoryStatus("目录权限失效，将使用普通下载");
    }

    if (supportsSaveFilePicker()) {
      try {
        const savedCount = await saveCanvasesWithPicker(canvases, filenames);
        const message = `已通过保存窗口保存 ${savedCount} 张`;
        els.statusText.textContent = message;
        showExportDialog("保存完成", message);
        return;
      } catch (error) {
        if (error && error.name === "AbortError") {
          const savedCount = error.savedCount || 0;
          const message =
            savedCount > 0 ? `已保存 ${savedCount} 张，其余已取消` : "已取消保存";
          els.statusText.textContent = message;
          showExportDialog("已取消保存", message);
          return;
        }

        els.statusText.textContent = "保存窗口不可用，将改用浏览器下载";
      }
    }

    for (let index = 0; index < canvases.length; index += 1) {
      await downloadCanvas(canvases[index], filenames[index]);
    }

    const message =
      isMobileLike() && !supportsDirectoryExport()
        ? `已调用浏览器下载 ${canvases.length} 张。如弹出下载或保存提示，请确认；否则请到下载目录查看。`
        : `已导出 ${canvases.length} 张`;
    els.statusText.textContent = message;
    showExportDialog("导出完成", message);
  }

  function selectionIsInEditor(selection) {
    if (!selection || selection.rangeCount === 0) {
      return false;
    }

    const range = selection.getRangeAt(0);
    return (
      els.textInput.contains(range.startContainer) &&
      els.textInput.contains(range.endContainer)
    );
  }

  function saveEditorSelection() {
    const selection = window.getSelection();

    if (!selectionIsInEditor(selection)) {
      return false;
    }

    savedEditorRange = selection.getRangeAt(0).cloneRange();
    return true;
  }

  function restoreEditorSelection() {
    els.textInput.focus({ preventScroll: true });

    const selection = window.getSelection();
    const range = savedEditorRange || document.createRange();

    if (!savedEditorRange) {
      range.selectNodeContents(els.textInput);
      range.collapse(false);
    }

    selection.removeAllRanges();
    selection.addRange(range);
  }

  function getSelectionHighlightColor() {
    const selection = window.getSelection();

    if (!selectionIsInEditor(selection)) {
      return null;
    }

    let node = selection.anchorNode;

    while (node && node !== els.textInput) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.style.backgroundColor) {
          return normalizeStyleColor(node.style.backgroundColor);
        }

        if (node.tagName === "MARK") {
          return HIGHLIGHT_COLOR;
        }
      }

      node = node.parentNode;
    }

    const commandColor = document.queryCommandValue("hiliteColor");
    return normalizeStyleColor(commandColor);
  }

  function getSelectionTextColor() {
    const selection = window.getSelection();

    if (!selectionIsInEditor(selection)) {
      return null;
    }

    let node = selection.anchorNode;

    while (node && node !== els.textInput) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const color =
          node.style.color ||
          (node.tagName === "FONT" ? node.getAttribute("color") : "");

        if (color) {
          return normalizeStyleColor(color);
        }
      }

      node = node.parentNode;
    }

    return null;
  }

  function cssColorToHex(color) {
    if (!color) {
      return null;
    }

    const normalized = color.replace(/\s/g, "");
    const longHex = normalized.match(/^#([0-9a-f]{6})$/i);
    const shortHex = normalized.match(/^#([0-9a-f]{3})$/i);
    const rgb = normalized.match(/^rgba?\((\d+),(\d+),(\d+)/i);

    if (longHex) {
      return `#${longHex[1].toLowerCase()}`;
    }

    if (shortHex) {
      return `#${shortHex[1]
        .split("")
        .map((character) => character + character)
        .join("")}`.toLowerCase();
    }

    if (rgb) {
      return `#${rgb
        .slice(1, 4)
        .map((channel) => Number(channel).toString(16).padStart(2, "0"))
        .join("")}`;
    }

    return null;
  }

  function updateColorToolStyles() {
    els.textColorButton.style.setProperty("--tool-color", els.textColorPicker.value);
    els.highlightButton.style.setProperty(
      "--tool-color",
      els.highlightColorPicker.value,
    );
  }

  function updateFormatToolbar() {
    const selection = window.getSelection();

    if (!selectionIsInEditor(selection)) {
      return;
    }

    els.boldButton.setAttribute(
      "aria-pressed",
      document.queryCommandState("bold") ? "true" : "false",
    );
    const textColor = getSelectionTextColor();
    const highlightColor = getSelectionHighlightColor();
    const textColorHex = cssColorToHex(textColor);
    const highlightColorHex = cssColorToHex(highlightColor);

    els.highlightButton.setAttribute("aria-pressed", highlightColor ? "true" : "false");

    if (textColorHex) {
      els.textColorPicker.value = textColorHex;
    }

    if (highlightColorHex) {
      els.highlightColorPicker.value = highlightColorHex;
    }

    updateColorToolStyles();
  }

  function applyEditorFormat(command) {
    restoreEditorSelection();

    if (command === "highlight") {
      const color = getSelectionHighlightColor()
        ? "transparent"
        : els.highlightColorPicker.value;
      document.execCommand("styleWithCSS", false, true);
      document.execCommand("hiliteColor", false, color);
    } else if (command === "textColor") {
      document.execCommand("styleWithCSS", false, true);
      document.execCommand("foreColor", false, els.textColorPicker.value);
    } else if (command === "clear") {
      document.execCommand("removeFormat", false);
    } else {
      document.execCommand("styleWithCSS", false, false);
      document.execCommand(command, false);
    }

    saveEditorSelection();
    updateFormatToolbar();
    scheduleRender();
  }

  function applyEditorColor(command, color) {
    restoreEditorSelection();
    document.execCommand("styleWithCSS", false, true);
    document.execCommand(command, false, color);
    saveEditorSelection();
    updateFormatToolbar();
    scheduleRender();
  }

  function insertPlainText(text) {
    if (document.execCommand("insertText", false, text)) {
      return;
    }

    const selection = window.getSelection();

    if (!selectionIsInEditor(selection)) {
      return;
    }

    const range = selection.getRangeAt(0);
    const textNode = document.createTextNode(text);
    range.deleteContents();
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function bindEvents() {
    const controls = [
      els.titleInput,
      els.textInput,
      els.themeSelect,
      els.fontSelect,
      els.widthSelect,
      els.sliceHeight,
      els.fontSize,
      els.lineHeight,
      els.pagePadding,
    ];

    controls.forEach((control) => {
      control.addEventListener("input", scheduleRender);
      control.addEventListener("change", scheduleRender);
    });

    document.querySelectorAll('input[name="exportMode"]').forEach((input) => {
      input.addEventListener("change", scheduleRender);
    });

    [
      els.boldButton,
      els.textColorButton,
      els.highlightButton,
      els.clearFormatButton,
    ].forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
    });

    els.boldButton.addEventListener("click", () => applyEditorFormat("bold"));
    els.textColorButton.addEventListener("click", () => applyEditorFormat("textColor"));
    els.highlightButton.addEventListener("click", () => applyEditorFormat("highlight"));
    els.clearFormatButton.addEventListener("click", () => applyEditorFormat("clear"));

    els.textColorPicker.addEventListener("change", () => {
      updateColorToolStyles();
      applyEditorColor("foreColor", els.textColorPicker.value);
    });

    els.highlightColorPicker.addEventListener("change", () => {
      updateColorToolStyles();
      applyEditorColor("hiliteColor", els.highlightColorPicker.value);
    });

    els.textInput.addEventListener("paste", (event) => {
      event.preventDefault();
      insertPlainText(event.clipboardData.getData("text/plain"));
      saveEditorSelection();
      scheduleRender();
    });

    document.addEventListener("selectionchange", () => {
      if (saveEditorSelection()) {
        updateFormatToolbar();
      }
    });

    els.sampleButton.addEventListener("click", () => {
      els.titleInput.value = "小红书排版示例";
      setEditorContent(SAMPLE_CONTENT);
      scheduleRender();
      els.textInput.focus();
    });

    els.clearButton.addEventListener("click", () => {
      els.titleInput.value = "";
      setEditorContent([]);
      scheduleRender();
      els.textInput.focus();
    });

    els.chooseDirectoryButton.addEventListener("click", () => {
      chooseDirectory().catch((error) => {
        const message = describeDirectoryError(error);
        updateDirectoryStatus(message);

        if (error && error.name !== "AbortError") {
          showExportDialog("目录选择失败", `${message}。点击下载时会使用${getFallbackSaveLabel()}。`);
        }
      });
    });

    els.clearDirectoryButton.addEventListener("click", () => {
      clearDirectory();
    });

    els.exportDialogClose.addEventListener("click", hideExportDialog);
    els.exportDialog.addEventListener("click", (event) => {
      if (event.target === els.exportDialog) {
        hideExportDialog();
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !els.exportDialog.hidden) {
        hideExportDialog();
      }
    });

    els.downloadPrimary.addEventListener("click", () => {
      downloadCurrent(true).catch(showExportError);
    });

    els.downloadAll.addEventListener("click", () => {
      downloadCurrent(false).catch(showExportError);
    });
  }

  els.titleInput.value = "小红书排版示例";
  setEditorContent(SAMPLE_CONTENT);
  bindEvents();
  updateRangeLabels();
  updateColorToolStyles();
  renderPreview();
  loadSavedDirectory();

  window.textToPicDebug = {
    buildLayout,
    buildExportFileNames,
    createNonOverwritingNames,
    getSettings,
    readEditorDocument,
    renderPreview,
    sanitizeFileBase,
  };
})();
