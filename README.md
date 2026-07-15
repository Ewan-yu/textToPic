# 小红书图文生成器

一个纯前端网页小工具，用于把输入文本转换成适合发布到小红书的图片。

## 功能

- 保留输入文本的换行、空行、列表和缩进。
- 支持长图输出。
- 支持按固定高度分段输出多张图片。
- 支持模板、字体、宽度、字号、行距、边距和分段高度设置。
- 使用 Canvas 在浏览器内生成 PNG，不需要后端或构建流程。

## 使用方式

直接用浏览器打开 `index.html`。

也可以在项目目录启动任意静态服务，例如：

```bash
python -m http.server 8080
```

然后访问 `http://localhost:8080`。

## 项目结构

```text
index.html          页面结构
styles.css          页面布局与样式
app.js              Canvas 排版、预览、分段与下载逻辑
PROJECT_DESIGN.md   项目设计与验收文档
task_plan.md        阶段计划
findings.md         需求与技术决策记录
progress.md         进度与验证记录
```
