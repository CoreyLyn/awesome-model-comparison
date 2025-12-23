(() => {
  const DEFAULT_MANIFEST_PATH = "data/prompts.json";
  const STORAGE_KEY = "amc.ui.v1";

  const state = {
    manifest: null,
    filteredPrompts: [],
    selectedPromptId: null,
    mode: "grid",
    theme: "auto",
    query: "",
    selectedTags: new Set(),
    manifestSource: { type: "fetch", path: DEFAULT_MANIFEST_PATH, file: null, cachedText: null },
  };

  const el = {
    app: document.getElementById("app"),
    btnSidebarOpen: document.getElementById("btnSidebarOpen"),
    btnSidebarClose: document.getElementById("btnSidebarClose"),
    searchInput: document.getElementById("searchInput"),
    tagChips: document.getElementById("tagChips"),
    promptList: document.getElementById("promptList"),
    btnReloadManifest: document.getElementById("btnReloadManifest"),
    btnPickManifest: document.getElementById("btnPickManifest"),
    manifestHint: document.getElementById("manifestHint"),
    promptTitle: document.getElementById("promptTitle"),
    promptDesc: document.getElementById("promptDesc"),
    btnCopyPrompt: document.getElementById("btnCopyPrompt"),
    btnToggleTheme: document.getElementById("btnToggleTheme"),
    themeIcon: document.getElementById("themeIcon"),
    emptyState: document.getElementById("emptyState"),
    models: document.getElementById("models"),
  };

  const toast = createToast();

  function createToast() {
    const node = document.createElement("div");
    node.className = "toast";
    node.setAttribute("role", "status");
    node.setAttribute("aria-live", "polite");
    document.body.appendChild(node);
    let hideTimer = 0;
    return (message) => {
      window.clearTimeout(hideTimer);
      node.textContent = message;
      node.dataset.show = "true";
      hideTimer = window.setTimeout(() => {
        node.dataset.show = "false";
      }, 1400);
    };
  }

  function safeText(value) {
    return typeof value === "string" ? value : "";
  }

  function normalize(str) {
    return String(str ?? "").trim().toLowerCase();
  }

  function uniqueTags(prompts) {
    const out = new Set();
    for (const p of prompts) {
      for (const t of Array.isArray(p.tags) ? p.tags : []) out.add(String(t));
    }
    return Array.from(out).sort((a, b) => a.localeCompare(b, "zh-CN"));
  }

  function matchesPrompt(prompt, query, selectedTags) {
    if (selectedTags.size) {
      const tags = new Set((prompt.tags ?? []).map((t) => String(t)));
      for (const tag of selectedTags) if (!tags.has(tag)) return false;
    }

    if (!query) return true;

    const hay = [
      prompt.title,
      prompt.description,
      ...(Array.isArray(prompt.tags) ? prompt.tags : []),
      prompt.id,
    ]
      .map(normalize)
      .join("\n");

    return hay.includes(query);
  }

  function setSidebarOpen(open) {
    el.app.dataset.sidebar = open ? "open" : "closed";
  }

  function urlWithCacheBuster(url) {
    const u = new URL(url, location.href);
    u.searchParams.set("_ts", String(Date.now()));
    return u.toString();
  }

  function isProbablyFileUrl(url) {
    try {
      return new URL(url, location.href).protocol === "file:";
    } catch {
      return false;
    }
  }

  function iframeSrcForLoad(resolvedUrl) {
    return isProbablyFileUrl(resolvedUrl) ? resolvedUrl : urlWithCacheBuster(resolvedUrl);
  }

  function getInitialUIState() {
    const fromStorage = (() => {
      try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      } catch {
        return null;
      }
    })();

    const params = new URLSearchParams(location.search);
    const prompt = params.get("prompt") || fromStorage?.prompt || null;
    const mode = params.get("mode") || fromStorage?.mode || "grid";
    const theme = params.get("theme") || fromStorage?.theme || "auto";
    const q = params.get("q") || fromStorage?.q || "";
    const tagsParam = params.get("tags") || "";
    const tagsFromUrl = tagsParam
      ? tagsParam
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
      : [];

    return { prompt, mode, theme, q, tagsFromUrl };
  }

  function persistUIState() {
    const params = new URLSearchParams(location.search);

    if (state.selectedPromptId) params.set("prompt", state.selectedPromptId);
    else params.delete("prompt");

    params.set("mode", state.mode);

    if (state.theme && state.theme !== "auto") params.set("theme", state.theme);
    else params.delete("theme");

    if (state.query) params.set("q", state.query);
    else params.delete("q");

    if (state.selectedTags.size) params.set("tags", Array.from(state.selectedTags).join(","));
    else params.delete("tags");

    const next = `${location.pathname}?${params.toString()}${location.hash || ""}`;
    history.replaceState(null, "", next);

    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          prompt: state.selectedPromptId,
          mode: state.mode,
          theme: state.theme,
          q: state.query,
        }),
      );
    } catch {
      // ignore
    }
  }

  function applyTheme(theme) {
    state.theme = theme;

    const resolved =
      theme === "auto"
        ? window.matchMedia?.("(prefers-color-scheme: light)").matches
          ? "light"
          : "dark"
        : theme;

    document.documentElement.dataset.theme = resolved;

    el.themeIcon.innerHTML =
      resolved === "light"
        ? '<svg><use href="#i-sun"></use></svg>'
        : '<svg><use href="#i-moon"></use></svg>';

    persistUIState();
  }

  async function copyToClipboard(text) {
    const payload = String(text ?? "");
    if (!payload) return false;

    try {
      await navigator.clipboard.writeText(payload);
      return true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = payload;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  function showHint(message) {
    el.manifestHint.hidden = !message;
    el.manifestHint.textContent = message || "";
  }

  function validateManifest(maybe) {
    if (!maybe || typeof maybe !== "object") throw new Error("清单格式错误：根对象不是 JSON object。");
    if (!Array.isArray(maybe.prompts)) throw new Error("清单格式错误：缺少 prompts[]。");
    return maybe;
  }

  async function loadManifestFromFetch(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`读取失败：${res.status} ${res.statusText}`);
    const text = await res.text();
    const json = validateManifest(JSON.parse(text));
    state.manifestSource = { type: "fetch", path, file: null, cachedText: text };
    return json;
  }

  async function loadManifestFromFilePicker() {
    if (!window.showOpenFilePicker) {
      throw new Error("当前浏览器不支持文件选择 API；建议用本地静态服务器打开该页面。");
    }

    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: [{ description: "JSON", accept: { "application/json": [".json"] } }],
    });

    const file = await handle.getFile();
    const text = await file.text();
    const json = validateManifest(JSON.parse(text));
    state.manifestSource = { type: "file", path: null, file: handle, cachedText: text };
    return json;
  }

  async function reloadManifest() {
    showHint("");
    try {
      if (state.manifestSource.type === "file" && state.manifestSource.file) {
        const file = await state.manifestSource.file.getFile();
        const text = await file.text();
        state.manifest = validateManifest(JSON.parse(text));
        state.manifestSource.cachedText = text;
        toast("清单已刷新");
        renderAll();
        return;
      }
      state.manifest = await loadManifestFromFetch(DEFAULT_MANIFEST_PATH);
      toast("清单已刷新");
      renderAll();
    } catch (err) {
      showHint(String(err?.message || err));
      toast("刷新失败");
    }
  }

  function getPromptById(id) {
    return state.manifest?.prompts?.find((p) => p.id === id) || null;
  }

  function setMode(mode) {
    if (!["grid", "split", "single"].includes(mode)) mode = "grid";
    state.mode = mode;
    el.models.dataset.mode = mode;
    for (const btn of document.querySelectorAll(".seg-btn")) {
      btn.dataset.active = btn.dataset.mode === mode ? "true" : "false";
    }
    persistUIState();
    renderModels();
  }

  function setSelectedPrompt(id) {
    state.selectedPromptId = id;
    for (const node of el.promptList.querySelectorAll(".prompt-item")) {
      node.dataset.active = node.dataset.id === id ? "true" : "false";
    }
    persistUIState();
    renderModels();
    if (window.matchMedia("(max-width: 980px)").matches) setSidebarOpen(false);
  }

  function renderTagChips() {
    el.tagChips.innerHTML = "";
    const tags = uniqueTags(state.manifest?.prompts || []);

    const allChip = document.createElement("button");
    allChip.type = "button";
    allChip.className = "chip";
    allChip.textContent = "全部";
    allChip.dataset.active = state.selectedTags.size === 0 ? "true" : "false";
    allChip.addEventListener("click", () => {
      state.selectedTags.clear();
      renderAll();
      persistUIState();
    });
    el.tagChips.appendChild(allChip);

    for (const tag of tags) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip";
      chip.textContent = tag;
      chip.dataset.active = state.selectedTags.has(tag) ? "true" : "false";
      chip.addEventListener("click", () => {
        if (state.selectedTags.has(tag)) state.selectedTags.delete(tag);
        else state.selectedTags.add(tag);
        renderAll();
        persistUIState();
      });
      el.tagChips.appendChild(chip);
    }
  }

  function renderPromptList() {
    el.promptList.innerHTML = "";

    if (!state.filteredPrompts.length) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "无匹配提示词。尝试清空搜索或标签过滤。";
      el.promptList.appendChild(empty);
      return;
    }

    for (const p of state.filteredPrompts) {
      const item = document.createElement("div");
      item.className = "prompt-item";
      item.dataset.id = p.id;
      item.dataset.active = p.id === state.selectedPromptId ? "true" : "false";
      item.setAttribute("role", "option");
      item.tabIndex = 0;

      const title = document.createElement("div");
      title.className = "prompt-item-title";
      title.textContent = safeText(p.title) || p.id;

      const desc = document.createElement("div");
      desc.className = "prompt-item-desc";
      desc.textContent = safeText(p.description);

      const tags = document.createElement("div");
      tags.className = "prompt-item-tags";
      for (const t of Array.isArray(p.tags) ? p.tags : []) {
        const tag = document.createElement("div");
        tag.className = "tag";
        tag.textContent = String(t);
        tags.appendChild(tag);
      }

      item.appendChild(title);
      item.appendChild(desc);
      if (tags.childNodes.length) item.appendChild(tags);

      item.addEventListener("click", () => setSelectedPrompt(p.id));
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setSelectedPrompt(p.id);
        }
      });

      el.promptList.appendChild(item);
    }
  }

  function updateFilteredPrompts() {
    const prompts = state.manifest?.prompts || [];
    const query = normalize(state.query);
    state.filteredPrompts = prompts.filter((p) => matchesPrompt(p, query, state.selectedTags));
  }

  function ensureSelectedPrompt() {
    const prompts = state.manifest?.prompts || [];
    if (!prompts.length) {
      state.selectedPromptId = null;
      return;
    }
    if (!state.filteredPrompts.length) {
      state.selectedPromptId = null;
      return;
    }
    const exists = state.filteredPrompts.some((p) => p.id === state.selectedPromptId);
    if (!exists) state.selectedPromptId = state.filteredPrompts[0].id;
  }

  function renderHeader() {
    const prompt = getPromptById(state.selectedPromptId);
    if (!prompt) {
      el.promptTitle.textContent = "选择一个提示词";
      el.promptDesc.textContent = "从左侧列表切换，或加载本地清单。";
      return;
    }
    el.promptTitle.textContent = safeText(prompt.title) || prompt.id;
    el.promptDesc.textContent = safeText(prompt.description);
  }

  function setEmptyVisible(visible) {
    el.emptyState.hidden = !visible;
  }

  function renderModels() {
    const prompt = getPromptById(state.selectedPromptId);
    renderHeader();
    el.models.dataset.mode = state.mode;

    if (!prompt) {
      el.models.innerHTML = "";
      setEmptyVisible(true);
      return;
    }

    setEmptyVisible(false);

    const models = Array.isArray(prompt.models) ? prompt.models : [];
    el.models.innerHTML = "";

    if (state.mode === "split") {
      const divider = document.createElement("div");
      divider.className = "split-divider";
      divider.title = "拖拽调节左右列宽";
      installSplitDrag(divider, el.models);
      el.models.appendChild(divider);
    }

    models.forEach((m, idx) => {
      el.models.appendChild(createModelCard(m, idx));
    });
  }

  function installSplitDrag(divider, container) {
    const onPointerDown = (e) => {
      e.preventDefault();
      divider.setPointerCapture?.(e.pointerId);
      const rect = container.getBoundingClientRect();
      const onMove = (ev) => {
        const x = ev.clientX - rect.left;
        const w = rect.width;
        const ratio = Math.min(0.8, Math.max(0.2, x / w));
        container.style.setProperty("--split-left", `${Math.round(ratio * 1000) / 10}%`);
        container.style.setProperty("--split-right", `${Math.round((1 - ratio) * 1000) / 10}%`);
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp, { once: true });
    };
    divider.addEventListener("pointerdown", onPointerDown);
  }

  function actionButton(title, iconHref) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "action-btn";
    b.title = title;
    b.innerHTML = `<span class="icon" aria-hidden="true"><svg><use href="${iconHref}"></use></svg></span>`;
    return b;
  }

  function setIframeError(card, message, retryFn) {
    const shell = card.querySelector(".iframe-shell");
    if (!shell) return;
    const existing = shell.querySelector(".error");
    if (existing) existing.remove();

    const node = document.createElement("div");
    node.className = "error";
    const strong = document.createElement("strong");
    strong.textContent = "加载失败";
    const text = document.createElement("div");
    text.textContent = message;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.textContent = "重试";
    btn.addEventListener("click", retryFn);

    node.appendChild(strong);
    node.appendChild(text);
    node.appendChild(btn);
    shell.appendChild(node);
  }

  function clearIframeError(card) {
    card.querySelector(".iframe-shell .error")?.remove();
  }

  function loadIframeWithState(iframe, skeleton, card, resolvedUrl) {
    clearIframeError(card);
    skeleton.hidden = false;
    const src = iframeSrcForLoad(resolvedUrl);
    let done = false;
    const controller = window.AbortController ? new AbortController() : null;
    let fallbackTimer = 0;

    const timeout = window.setTimeout(() => {
      if (done) return;
      controller?.abort();
      setIframeError(
        card,
        `加载超时。可能原因：\n- 运行在 IDE 预览/WebView，iframe 被限制\n- 未通过本地静态服务器打开\n- htmlPath 指向不存在的文件\n\n当前页面协议：${location.protocol}\n目标：${resolvedUrl}`,
        () =>
          loadIframeWithState(iframe, skeleton, card, resolvedUrl),
      );
      skeleton.hidden = true;
    }, 12000);

    const cleanup = () => {
      iframe.removeEventListener("load", onLoad);
      iframe.removeEventListener("error", onError);
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
    };

    const onLoad = () => {
      if (done) return;
      done = true;
      controller?.abort();
      window.clearTimeout(timeout);
      skeleton.hidden = true;
      clearIframeError(card);
      cleanup();
    };

    const onError = () => {
      if (done) return;
      done = true;
      controller?.abort();
      window.clearTimeout(timeout);
      skeleton.hidden = true;
      setIframeError(card, "浏览器报告加载错误。", () =>
        loadIframeWithState(iframe, skeleton, card, resolvedUrl),
      );
      cleanup();
    };

    cleanup();
    iframe.addEventListener("load", onLoad);
    iframe.addEventListener("error", onError);

    // Reset any previous srcdoc render so navigation events can fire properly.
    iframe.removeAttribute("srcdoc");
    iframe.dataset.render = "src";
    iframe.src = src;

    // Fallback: in some preview environments, iframe navigation/load events can stall.
    // If we can fetch the HTML, render it via srcdoc (keeps HTML unchanged, but may break relative assets).
    if (!isProbablyFileUrl(resolvedUrl)) {
      fallbackTimer = window.setTimeout(async () => {
        if (done) return;
        try {
          const res = await fetch(resolvedUrl, {
            cache: "no-store",
            signal: controller?.signal,
          });
          if (!res.ok) return;
          const text = await res.text();
          if (done) return;
          done = true;
          window.clearTimeout(timeout);
          skeleton.hidden = true;
          clearIframeError(card);
          iframe.dataset.render = "srcdoc";
          iframe.src = "about:blank";
          iframe.setAttribute("srcdoc", text);
          toast("使用 srcdoc 回退渲染");
          cleanup();
        } catch {
          // ignore
        }
      }, 1500);
    }
  }

  function reloadIframe(card, resolvedUrl) {
    const iframe = card.querySelector("iframe");
    const skeleton = card.querySelector(".skeleton");
    if (!iframe || !skeleton) return;
    iframe.src = "about:blank";
    window.setTimeout(() => loadIframeWithState(iframe, skeleton, card, resolvedUrl), 0);
    toast("已刷新");
  }

  function createModelCard(model, idx) {
    const card = document.createElement("article");
    card.className = "model-card";

    if (state.mode === "split") card.style.gridColumn = idx % 2 === 0 ? "1" : "3";

    const head = document.createElement("div");
    head.className = "model-head";

    const titleWrap = document.createElement("div");
    titleWrap.className = "model-title";

    const titleTop = document.createElement("div");
    titleTop.className = "model-title-top";

    const label = document.createElement("div");
    label.className = "model-label";
    label.textContent = safeText(model.label) || safeText(model.modelId) || "未命名模型";

    const source = document.createElement("div");
    source.className = "model-source";
    source.textContent = safeText(model.source) || "—";

    titleTop.appendChild(label);
    titleTop.appendChild(source);

    const notes = safeText(model.notes);
    const notesNode = document.createElement("div");
    notesNode.className = "model-notes";
    if (notes) notesNode.textContent = notes;
    else notesNode.hidden = true;

    titleWrap.appendChild(titleTop);
    titleWrap.appendChild(notesNode);

    const actions = document.createElement("div");
    actions.className = "model-actions";

    const url = safeText(model.htmlPath);
    const resolvedUrl = url ? new URL(url, location.href).toString() : null;

    const btnReload = actionButton("刷新 iframe", "#i-refresh");
    btnReload.addEventListener("click", () => {
      if (!resolvedUrl) return toast("缺少 htmlPath");
      reloadIframe(card, resolvedUrl);
    });

    const btnOpen = actionButton("新标签打开", "#i-external");
    btnOpen.addEventListener("click", () => {
      if (!resolvedUrl) return toast("缺少 htmlPath");
      window.open(resolvedUrl, "_blank", "noopener,noreferrer");
    });

    actions.appendChild(btnReload);
    actions.appendChild(btnOpen);

    head.appendChild(titleWrap);
    head.appendChild(actions);

    const shell = document.createElement("div");
    shell.className = "iframe-shell";

    const skeleton = document.createElement("div");
    skeleton.className = "skeleton";
    skeleton.textContent = "加载中…";
    shell.appendChild(skeleton);

    const iframe = document.createElement("iframe");
    iframe.className = "model-iframe";
    iframe.loading = "eager";
    iframe.referrerPolicy = "no-referrer";
    iframe.title = label.textContent;
    shell.appendChild(iframe);

    card.appendChild(head);
    card.appendChild(shell);

    if (resolvedUrl) loadIframeWithState(iframe, skeleton, card, resolvedUrl);
    else skeleton.textContent = "缺少 htmlPath";

    return card;
  }

  function renderAll() {
    updateFilteredPrompts();
    ensureSelectedPrompt();
    renderTagChips();
    renderPromptList();
    renderHeader();
    renderModels();
  }

  function wireEvents() {
    el.btnSidebarOpen.addEventListener("click", () => setSidebarOpen(true));
    el.btnSidebarClose.addEventListener("click", () => setSidebarOpen(false));

    el.searchInput.addEventListener("input", (e) => {
      state.query = e.target.value || "";
      renderAll();
      persistUIState();
    });

    el.btnReloadManifest.addEventListener("click", reloadManifest);
    el.btnPickManifest.addEventListener("click", async () => {
      showHint("");
      try {
        state.manifest = await loadManifestFromFilePicker();
        toast("清单已加载");
        renderAll();
      } catch (err) {
        showHint(String(err?.message || err));
        toast("加载失败");
      }
    });

    for (const btn of document.querySelectorAll(".seg-btn")) {
      btn.addEventListener("click", () => setMode(btn.dataset.mode));
    }

    el.btnCopyPrompt.addEventListener("click", async () => {
      const prompt = getPromptById(state.selectedPromptId);
      const ok = await copyToClipboard(prompt?.description || "");
      toast(ok ? "已复制提示词" : "复制失败");
    });

    el.btnToggleTheme.addEventListener("click", () => {
      const next = state.theme === "dark" ? "light" : state.theme === "light" ? "auto" : "dark";
      applyTheme(next);
      toast(next === "auto" ? "主题：跟随系统" : `主题：${next === "dark" ? "深色" : "浅色"}`);
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement === document.body) {
        e.preventDefault();
        el.searchInput.focus();
      }
      if (e.key === "Escape" && el.app.dataset.sidebar === "open") setSidebarOpen(false);
    });
  }

  async function boot() {
    wireEvents();

    const init = getInitialUIState();
    state.query = init.q;
    el.searchInput.value = init.q;
    for (const t of init.tagsFromUrl) state.selectedTags.add(t);
    setMode(init.mode);
    applyTheme(init.theme);

    try {
      state.manifest = await loadManifestFromFetch(DEFAULT_MANIFEST_PATH);
      showHint("");
    } catch (err) {
      showHint(
        `无法自动读取 ${DEFAULT_MANIFEST_PATH}：${String(err?.message || err)}\n` +
        `可点“加载清单”选择本地 prompts.json，或用本地静态服务器打开该目录。`,
      );
    }

    if (init.prompt) state.selectedPromptId = init.prompt;
    renderAll();
  }

  boot();
})();
