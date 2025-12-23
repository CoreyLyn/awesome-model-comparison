# Awesome Model Comparison

对同一提示词下，不同模型生成的 HTML 进行快速观感/交互对比的静态单页应用（无服务端）。

## 功能

- 数据驱动：通过 `data/prompts.json` 自动渲染提示词列表与模型卡片
- 对比视图：网格 / 分栏（可拖拽分隔）/ 单列
- 侧栏：搜索（title/description/tags/id）与标签过滤
- 模型卡片：刷新 iframe、新标签打开、查看源码（折叠）、加载骨架与错误重试
- 记忆状态：URL query（prompt/mode/theme/q/tags）与 `localStorage`

## 目录结构

```
.
├─ index.html
├─ data/
│  └─ prompts.json
├─ html/
│  └─ <prompt-id>/
│     └─ <model-id>.html
└─ assets/
   ├─ app.js
   └─ style.css
```

## 本地运行

### 方式 A：直接双击打开（file://）

可以直接打开 `index.html`。

注意：部分浏览器会限制 `file://` 下的 `fetch`，导致无法自动读取 `data/prompts.json` 或无法读取源码。
此时可在页面里点击“加载清单”，手动选择 `data/prompts.json`（支持的浏览器需要 `showOpenFilePicker`）。

### 方式 B：推荐，用本地静态服务器

在仓库根目录启动任一静态服务器：

- Python：`python -m http.server 8000`
- Node（若你已安装）：`npx serve .`

然后访问：`http://localhost:8000/`

## 清单（data/prompts.json）Schema

根对象：

```json
{
  "prompts": [
    {
      "id": "ios-weather",
      "title": "iOS 18 天气卡片",
      "description": "You are a UI Designer at Apple Inc. ...",
      "tags": ["UI", "iOS", "Weather"],
      "models": [
        {
          "modelId": "gpt-5.2",
          "label": "GPT-5.2",
          "htmlPath": "html/ios-weather/gpt-5.2.html",
          "source": "OpenAI",
          "notes": "提示无改动"
        }
      ]
    }
  ]
}
```

字段说明：

- prompt：`id` / `title` / `description` / `tags[]` / `models[]`
- model：`modelId` / `label` / `htmlPath` / `source?` / `notes?`

> 约定：模型产出的 HTML 原样嵌入（不做修改）。

## 如何新增对比项

### 新增提示词（prompt）

1. 在 `data/prompts.json` 的 `prompts[]` 追加一个 prompt 对象（确保 `id` 唯一）
2. 创建目录 `html/<prompt-id>/`
3. 将各模型输出 HTML 放入该目录，并在 `models[].htmlPath` 指向对应文件

### 新增模型（model）

1. 在目标 prompt 的 `models[]` 追加一个 model 对象
2. 放置对应的 HTML 文件，并更新 `htmlPath`

## URL 参数（可分享/可记忆）

- `prompt`：prompt id
- `mode`：`grid` | `split` | `single`
- `theme`：`dark` | `light`（不传则跟随系统）
- `q`：侧栏搜索关键字
- `tags`：以逗号分隔的标签集合（例如 `UI,iOS`）

示例：

`/?prompt=ios-weather&mode=split&theme=dark&tags=UI,iOS`

## 说明与限制

- 源码查看使用 `fetch(htmlPath)`：在 `file://` 场景可能失败，建议使用本地静态服务器打开。
- iframe 内页面来自模型输出，可能包含高资源占用或不可信脚本；建议在本地离线环境使用。

## 常见问题

### 预览一直显示“加载中…”

1. 优先用本地静态服务器打开（见“本地运行 / 方式 B”），避免 `file://` 的各种安全限制。
2. 点击模型卡片右上角的“新标签打开”验证 `htmlPath` 是否指向了存在的文件。
