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

  function validateManifest(maybe) {
    if (!maybe || typeof maybe !== "object") throw new Error("Invalid manifest: root is not a JSON object.");
    if (!Array.isArray(maybe.prompts)) throw new Error("Invalid manifest: missing prompts[].");
    return maybe;
  }

  async function loadManifestFromFetch(path) {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to read: ${res.status} ${res.statusText}`);
    const text = await res.text();
    const json = validateManifest(JSON.parse(text));
    state.manifestSource = { type: "fetch", path, file: null, cachedText: text };
    return json;
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
    allChip.textContent = "All";
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
      empty.textContent = "No matching prompts. Try clearing your search or tag filters.";
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
      el.promptTitle.textContent = "Select a prompt";
      el.promptDesc.textContent = "Choose from the list on the left.";
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
      divider.title = "Drag to adjust column width";
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
    strong.textContent = "Load failed";
    const text = document.createElement("div");
    text.textContent = message;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.textContent = "Retry";
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
        `Load timeout. Possible reasons:\n- Running in IDE preview/WebView where iframes are restricted\n- Not opened via local static server\n- htmlPath points to non-existent file\n\nCurrent protocol: ${location.protocol}\nTarget: ${resolvedUrl}`,
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
      setIframeError(card, "Browser reported loading error.", () =>
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
          toast("Using srcdoc fallback rendering");
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
    toast("Refreshed");
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
    label.textContent = safeText(model.label) || safeText(model.modelId) || "Unnamed model";

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

    const btnReload = actionButton("Refresh iframe", "#i-refresh");
    btnReload.addEventListener("click", () => {
      if (!resolvedUrl) return toast("Missing htmlPath");
      reloadIframe(card, resolvedUrl);
    });

    const btnOpen = actionButton("Open in new tab", "#i-external");
    btnOpen.addEventListener("click", () => {
      if (!resolvedUrl) return toast("Missing htmlPath");
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
    skeleton.textContent = "Loading...";
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
    else skeleton.textContent = "Missing htmlPath";

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



    for (const btn of document.querySelectorAll(".seg-btn")) {
      btn.addEventListener("click", () => setMode(btn.dataset.mode));
    }

    el.btnCopyPrompt.addEventListener("click", async () => {
      const prompt = getPromptById(state.selectedPromptId);
      const ok = await copyToClipboard(prompt?.description || "");
      toast(ok ? "Prompt copied" : "Copy failed");
    });

    el.btnToggleTheme.addEventListener("click", () => {
      const next = state.theme === "dark" ? "light" : state.theme === "light" ? "auto" : "dark";
      applyTheme(next);
      toast(next === "auto" ? "Theme: System" : `Theme: ${next === "dark" ? "Dark" : "Light"}`);
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
    } catch (err) {
      console.error(`Failed to read ${DEFAULT_MANIFEST_PATH}:`, err);
    }

    if (init.prompt) state.selectedPromptId = init.prompt;
    renderAll();
  }

  boot();
})();
