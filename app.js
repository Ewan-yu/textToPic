(function () {
  "use strict";

  const MAX_CANVAS_HEIGHT = 32760;
  const SAMPLE_TEXT = `今天想分享一个很适合小红书长文的排版方式。

它适合：
- 读书笔记
- 旅行攻略
- 情绪随笔
- 产品使用心得

保留你原来的换行、空行和列表结构。
如果文本很长，可以切换到「固定分段」，生成多张等高图片。`;

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
    textInput: document.getElementById("textInput"),
    sampleButton: document.getElementById("sampleButton"),
    clearButton: document.getElementById("clearButton"),
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
  };

  if (!els.textInput || !els.previewList) {
    return;
  }

  let renderTimer = 0;
  let latestCanvases = [];
  let latestWarning = "";

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

  function fontString(settings, weight) {
    return `${weight || 400} ${settings.fontSize}px ${settings.font.stack}`;
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

  function buildLayout(text, settings) {
    const measureCanvas = document.createElement("canvas");
    const ctx = measureCanvas.getContext("2d");
    const maxWidth = Math.max(1, settings.width - settings.padding * 2);
    const paragraphGap = Math.max(10, Math.round(settings.fontSize * 0.32));
    const blankGap = Math.max(24, Math.round(settings.lineHeightPx * 0.88));
    const items = [];

    ctx.font = fontString(settings);

    const rawLines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const hasText = rawLines.some((line) => line.length > 0);

    rawLines.forEach((rawLine, index) => {
      if (rawLine.length === 0) {
        if (hasText) {
          items.push({ kind: "space", height: blankGap });
        }
        return;
      }

      const visualLines = wrapLine(ctx, rawLine, maxWidth);

      visualLines.forEach((line) => {
        items.push({
          kind: "text",
          text: line,
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

  function drawItems(ctx, items, settings, startY) {
    let y = startY;

    ctx.font = fontString(settings);
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = settings.theme.foreground;

    items.forEach((item) => {
      if (item.kind === "text") {
        ctx.fillText(item.text, settings.padding, y + item.baseline);
      }

      y += item.height;
    });
  }

  function renderLongCanvas(text, settings) {
    const layout = buildLayout(text, settings);
    const desiredHeight = Math.max(settings.sliceHeight, layout.contentHeight);
    const canvasHeight = Math.min(desiredHeight, MAX_CANVAS_HEIGHT);
    const { canvas, ctx } = prepareCanvas(settings.width, canvasHeight, settings);

    drawItems(ctx, layout.items, settings, settings.padding);

    if (desiredHeight > MAX_CANVAS_HEIGHT) {
      latestWarning = "长图高度超过浏览器限制，请切换固定分段导出完整内容";
    }

    return [canvas];
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

  function renderPageCanvases(text, settings) {
    const layout = buildLayout(text, settings);
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
    const text = els.textInput.value;

    latestWarning = "";
    latestCanvases =
      settings.mode === "long"
        ? renderLongCanvas(text, settings)
        : renderPageCanvases(text, settings);

    els.previewList.replaceChildren();
    latestCanvases.forEach((canvas, index) => appendPreview(canvas, index, latestCanvases.length));

    const suffix = latestWarning ? ` · ${latestWarning}` : "";
    const emptyHint = text.trim().length === 0 ? " · 请输入正文" : "";
    els.previewMeta.textContent = `${latestCanvases.length} 张`;
    els.statusText.textContent = `已生成 ${latestCanvases.length} 张 · ${settings.width}px${suffix}${emptyHint}`;
    updateActionLabels(settings, latestCanvases.length);
  }

  function scheduleRender() {
    updateRangeLabels();
    window.clearTimeout(renderTimer);
    renderTimer = window.setTimeout(renderPreview, 80);
  }

  function downloadCanvas(canvas, filename) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("图片生成失败"));
          return;
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.append(link);
        link.click();
        link.remove();

        window.setTimeout(() => {
          URL.revokeObjectURL(url);
          resolve();
        }, 120);
      }, "image/png");
    });
  }

  async function downloadCurrent(primaryOnly) {
    if (latestCanvases.length === 0) {
      renderPreview();
    }

    const settings = getSettings();
    const canvases = primaryOnly ? latestCanvases.slice(0, 1) : latestCanvases;
    const prefix = settings.mode === "long" ? "xiaohongshu-long" : "xiaohongshu-page";

    els.statusText.textContent = `正在导出 ${canvases.length} 张`;

    for (let index = 0; index < canvases.length; index += 1) {
      const suffix = settings.mode === "long" ? "" : `-${String(index + 1).padStart(2, "0")}`;
      await downloadCanvas(canvases[index], `${prefix}${suffix}.png`);
    }

    els.statusText.textContent = `已导出 ${canvases.length} 张`;
  }

  function bindEvents() {
    const controls = [
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

    els.sampleButton.addEventListener("click", () => {
      els.textInput.value = SAMPLE_TEXT;
      scheduleRender();
      els.textInput.focus();
    });

    els.clearButton.addEventListener("click", () => {
      els.textInput.value = "";
      scheduleRender();
      els.textInput.focus();
    });

    els.downloadPrimary.addEventListener("click", () => {
      downloadCurrent(true).catch((error) => {
        els.statusText.textContent = error.message;
      });
    });

    els.downloadAll.addEventListener("click", () => {
      downloadCurrent(false).catch((error) => {
        els.statusText.textContent = error.message;
      });
    });
  }

  els.textInput.value = SAMPLE_TEXT;
  bindEvents();
  updateRangeLabels();
  renderPreview();

  window.textToPicDebug = {
    buildLayout,
    getSettings,
    renderPreview,
  };
})();
