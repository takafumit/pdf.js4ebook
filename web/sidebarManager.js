/* ---------- テキストボックス・ハイライト情報表示ボタン ---------- */
export function showSidebar() {
  let existing = document.getElementById("sidebar");
  if (existing) {
    existing.remove();
    return;
  }

  const sidebar = document.createElement("div");
  sidebar.id = "sidebar";
  sidebar.style.position = "fixed";
  sidebar.style.right = "0";
  sidebar.style.top = "0";
  sidebar.style.width = "260px";
  sidebar.style.height = "100%";
  sidebar.style.backgroundColor = "#f9f9f9";
  sidebar.style.borderLeft = "1px solid #ccc";
  sidebar.style.overflowY = "auto";
  sidebar.style.padding = "10px";
  sidebar.style.zIndex = "9999";
  sidebar.style.fontSize = "14px";
  sidebar.style.lineHeight = "1.4em";

  // 閉じるボタンを追加
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.title = "閉じる";
  closeBtn.style.position = "absolute";
  closeBtn.style.top = "8px";
  closeBtn.style.right = "8px";
  closeBtn.style.border = "none";
  closeBtn.style.background = "transparent";
  closeBtn.style.fontSize = "18px";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.color = "#555";

  closeBtn.onmouseenter = () => (closeBtn.style.color = "#000");
  closeBtn.onmouseleave = () => (closeBtn.style.color = "#555");
  closeBtn.onclick = () => sidebar.remove();

  sidebar.appendChild(closeBtn);
  // ↑ ここまでが「×」ボタンの追加部分

  const filterContainer = document.createElement("div");
  filterContainer.style.marginTop = "30px";
  filterContainer.style.marginBottom = "10px";
  filterContainer.style.padding = "6px";
  filterContainer.style.borderBottom = "1px solid #ccc";

  // チェックボックス設定
  const filters = [
    { label: "テキストボックス", id: "filterNotes", checked: true },
    { label: "ハイライト", id: "filterHighlights", checked: true },
  ];

  filters.forEach(f => {
    const label = document.createElement("label");
    label.style.marginRight = "10px";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = f.id;
    cb.checked = f.checked;

    label.appendChild(cb);
    label.appendChild(document.createTextNode(" " + f.label));

    filterContainer.appendChild(label);

    cb.addEventListener("change", applySidebarFilter);
  });

  sidebar.appendChild(filterContainer);

  function applySidebarFilter() {
    const showNotes = document.getElementById("filterNotes").checked;
    const showHighlights = document.getElementById("filterHighlights").checked;

    // サイドバー内のテキストボックス（note-item）
    document.querySelectorAll("#sidebar .note-item").forEach(el => {
      el.style.display = showNotes ? "block" : "none";
    });

    // テキストボックス見出し
    document.querySelectorAll("#sidebar .note-header").forEach(el => {
      el.style.display = showNotes ? "block" : "none";
    });

    // サイドバー内のハイライト（highlight-item）
    document.querySelectorAll("#sidebar .highlight-item").forEach(el => {
      el.style.display = showHighlights ? "block" : "none";
    });

    // ハイライト見出し
    document.querySelectorAll("#sidebar .highlight-header").forEach(el => {
      el.style.display = showHighlights ? "block" : "none";
    });

  }

  // サイドバー左端にドラッグバーを追加（幅変更できるようにする）
  const resizeBar = document.createElement("div");
  resizeBar.style.position = "absolute";
  resizeBar.style.left = "0";
  resizeBar.style.top = "0";
  resizeBar.style.width = "5px";
  resizeBar.style.height = "100%";
  resizeBar.style.cursor = "ew-resize";
  resizeBar.style.background = "rgba(0,0,0,0)"; // 透明
  resizeBar.style.zIndex = "10000";
  sidebar.appendChild(resizeBar);

  let isResizing = false;

  resizeBar.addEventListener("mousedown", (e) => {
    isResizing = true;
    document.body.style.cursor = "ew-resize";
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const newWidth = window.innerWidth - e.clientX;
    // 最小幅・最大幅を設定（好みで調整可能）
    const minWidth = 180, maxWidth = 500;
    if (newWidth > minWidth && newWidth < maxWidth) {
      sidebar.style.width = newWidth + "px";
    }
  });

  document.addEventListener("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      document.body.style.cursor = "default";
    }
  });

  // ページごとにテキストボックスとハイライトをまとめる
  const pages = {};

  document.querySelectorAll(".note").forEach(note => {
    const page = parseInt(note.dataset.page) || 1;
    if (!pages[page]) pages[page] = { notes: [], highlights: [] };
    pages[page].notes.push(note);
  });

  document.querySelectorAll(".highlight").forEach(hl => {
    const page = parseInt(hl.dataset.page) || 1;
    if (!pages[page]) pages[page] = { notes: [], highlights: [] };
    pages[page].highlights.push(hl);
  });

  // ページ順に表示
  Object.keys(pages)
    .sort((a, b) => a - b)
    .forEach(page => {
      const pageDiv = document.createElement("div");
      pageDiv.style.marginBottom = "15px";
      pageDiv.style.borderBottom = "1px solid #ccc";
      pageDiv.style.paddingBottom = "10px";

      const title = document.createElement("div");
      title.textContent = `${page}ページ目`;
      title.style.fontWeight = "bold";
      title.style.marginBottom = "8px";
      title.style.backgroundColor = "#e0e0e0";
      title.style.padding = "4px 6px";
      title.style.borderRadius = "4px";
      pageDiv.appendChild(title);

      // ページ内容の折りたたみ／展開機能
      title.style.cursor = "pointer";
      title.dataset.collapsed = "false";
      title.textContent = "▼ " + `${page}ページ目`;

      title.onclick = () => {
        const isCollapsed = title.dataset.collapsed === "true";
        const contents = pageDiv.querySelectorAll(":scope > div:not(:first-child)");
        contents.forEach(el => el.style.display = isCollapsed ? "block" : "none");
        title.dataset.collapsed = (!isCollapsed).toString();
        title.textContent = (isCollapsed ? "▼ " : "▶ ") + `${page}ページ目`;
      };

      // テキストボックス一覧
      if (pages[page].notes.length > 0) {
        const noteLabel = document.createElement("div");
        noteLabel.className = "note-header";
        noteLabel.textContent = "テキストボックス：";
        noteLabel.style.fontWeight = "bold";
        noteLabel.style.marginBottom = "4px";
        pageDiv.appendChild(noteLabel);

        pages[page].notes.forEach(note => {
          const div = document.createElement("div");
          div.className = "note-item";
          div.style.marginBottom = "5px";
          div.style.paddingLeft = "10px";

          const content = document.createElement("div");
          content.textContent = note.textContent
            + (note.dataset.linkedText ? " | " + note.dataset.linkedText : "");
          content.style.cursor = "pointer";
          content.style.color = getComputedStyle(note).color;

          content.onclick = () => {
            const pageNum = parseInt(note.dataset.page) - 1;
            const pageView = PDFViewerApplication.pdfViewer.getPageView(pageNum);
            if (!pageView) return;
            const vp = pageView.viewport;
            const [viewX, viewY] = vp.convertToViewportPoint(note.dataset.x, note.dataset.y);
            document.getElementById("viewerContainer").scrollTop =
              pageView.div.offsetTop + viewY;
          };

          div.appendChild(content);
          pageDiv.appendChild(div);
        });
      }

      // ハイライト一覧
      if (pages[page].highlights.length > 0) {
        const hlLabel = document.createElement("div");
        hlLabel.className = "highlight-header";
        hlLabel.textContent = "ハイライト：";
        hlLabel.style.fontWeight = "bold";
        hlLabel.style.marginTop = "6px";
        hlLabel.style.marginBottom = "4px";
        pageDiv.appendChild(hlLabel);

        // const seen = new Set();
        pages[page].highlights.forEach(hl => {
          const text = hl.dataset.text;
          // if (!text || seen.has(text)) return;
          // seen.add(text);

          const div = document.createElement("div");
          div.className = "highlight-item";
          div.style.marginBottom = "5px";
          div.style.paddingLeft = "10px";

          const content = document.createElement("div");
          content.textContent = text;
          content.style.cursor = "pointer";
          content.style.borderRadius = "4px";
          content.style.padding = "2px 4px";

          const colorMap = {
            yellow: "rgba(255,255,0,0.5)",
            green: "rgba(144,238,144,0.5)",
            pink: "rgba(255,182,193,0.6)"
          };
          content.style.backgroundColor =
            colorMap[hl.dataset.color] || "rgba(255,255,0,0.3)";
          content.style.color = "#000";

          content.textContent = text && text.trim() !== "" ? text : "(矩形選択ハイライト)";

          content.onclick = () => {
            const pageNum = parseInt(hl.dataset.page) - 1;
            const pageView = PDFViewerApplication.pdfViewer.getPageView(pageNum);
            if (!pageView) return;
            const vp = pageView.viewport;
            const [viewX, viewY] = vp.convertToViewportPoint(hl.dataset.x, hl.dataset.y);
            document.getElementById("viewerContainer").scrollTop =
              pageView.div.offsetTop + viewY;
          };

          div.appendChild(content);
          pageDiv.appendChild(div);
        });
      }
      sidebar.appendChild(pageDiv);
    });

  document.body.appendChild(sidebar);
}