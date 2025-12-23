# 模型生成 HTML 对比页设计文档

## 目标
- 对同一提示词下，不同模型生成的 HTML 进行快速观感/交互对比。
- 数据驱动：新增提示/模型仅需更新清单与放置 HTML，无须改前端逻辑。
- 保持模型产出的 HTML 原样嵌入，不做修改。

## 范围
- 单页静态应用（index.html）读取本地清单与 HTML。
- 不涉及服务端；本地文件即可运行。

## 目录结构（建议）
- index.html：主页面入口。
- data/prompts.json：清单，驱动页面渲染。
- html/<prompt-id>/<model-id>.html：各模型输出文件；如需复用可放 html/<model-id>.html 并在清单引用。
- assets/
  - style.css：布局、主题、对比模式样式。
  - app.js：数据加载、渲染、交互逻辑。
  - icons/：刷新、复制、外链等 SVG。

## 清单 Schema（无 version/date）
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
- prompt 层：id | title | description | tags[] | models[]
- model 层：modelId | label | htmlPath | source? | notes?

## 关键交互流程
- 侧栏：提示词列表，支持搜索（title/description/tags）与标签过滤；点击切换 prompt。
- 顶部条：显示当前 prompt 标题与描述；按钮：复制提示；视图模式切换（网格/分栏/单列）。
- 主对比区（按 models 渲染卡片）：
  - 头部：label、source、notes；操作：刷新 iframe、新标签打开、显示源码折叠。
  - 内容：iframe 嵌入 htmlPath，统一高度；分栏模式支持拖拽分隔调宽。
  - 状态：加载骨架、错误提示+重试；懒加载当前 prompt 的 iframe。
- 辅助：URL query 记忆 prompt、mode；主题切换（亮/暗）；可选源码查看（读取原始 HTML 文本）。

## 视图模式
- 网格：2–3 列自适应，适合多模型。
- 分栏：两列，可拖拽分隔，对比聚焦。
- 单列：垂直堆叠，逐个查看。

## 状态与容错
- 空状态：未选 prompt 时展示指引。
- 加载状态：iframe 骨架屏。
- 错误状态：加载失败文案 + 重试按钮。
- 懒加载：仅加载当前 prompt 的模型 iframe。

## 扩展与维护
- 新增提示：在 prompts.json 增加 prompt 对象，并放置对应 HTML 到 html/<id>/。
- 新增模型：在目标 prompt 的 models 添加对象，放置 HTML 到对应路径。
- 复用产出：允许多个 prompt 共享同一 htmlPath。

## 落地步骤（最小集）
1) 创建 data/prompts.json，填入首个 prompt 与模型列表。
2) 将现有 claude-sonnet-4.5.html、gemini-3-pro.html、gpt-5.2.html 移至 html/ios-weather/ 或在清单中引用它们的现有路径。
3) 搭建 index.html + assets/{style.css, app.js}，读取清单并渲染上述交互。
4) 手动验证：切换提示、切换视图模式、刷新 iframe、源码折叠、错误/骨架状态。

## 后续可选功能
- 同步滚动、截图/视觉 diff、性能提示（加载时长/帧率）。
- 分享链接（URL 深链 prompt 与 mode）。
- 多语言 UI 切换。
