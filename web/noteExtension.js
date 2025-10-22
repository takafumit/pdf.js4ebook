/* ========================================================
   noteExtension.js – PDF.js (v5.3.31) ノート拡張
   ノート＆ハイライト統合版（ボタン押下時のみ追加可能）
   Robust Undo / Redo：create, move, delete, update
   追加機能：
     - ハイライト色パレット（yellow / green / pink）
     - 選択色でハイライト描画（保存・復元対応）
   ======================================================== */

/* ---------- グローバル設定 ---------- */
// モードや Undo/Redo ，ローカルストレージ保存関連
let addMode = false;
let highlightMode = false;
let selected = null;
let undoStack = [], redoStack = [];
const HANDLE = 12;

const pdfId = PDFViewerApplication?.url?.split("/").pop() ?? "untitled.pdf";
const STORAGE_KEY = `notes::${pdfId}`;
const HIGHLIGHT_KEY = `highlights::${pdfId}`;

// 安全な $ ヘルパー（存在しなければ null を返す）
const $ = id => document.getElementById(id);

/* ---------- 色定義 ---------- */
const highlightColors = {
  yellow: { name: "yellow", border: "rgba(255,255,0,0.5)", bg: "rgba(255,255,0,0.3)" },
  green: { name: "green", border: "rgba(144,238,144,0.5)", bg: "rgba(144,238,144,0.3)" },
  pink: { name: "pink", border: "rgba(255,182,193,0.5)", bg: "rgba(255,182,193,0.3)" },
};
let currentHighlightColor = "yellow";

/* ---------- Undo/Redo ---------- */
const OP = {
  create: el => ({ action: "create", note: el }),
  delete: (el, parent) => ({ action: "delete", note: el, parent }),
  move: (el, fromX, fromY, toX, toY) => ({ action: "move", note: el, fromX, fromY, toX, toY }),
  update: (el, prev, next) => ({ action: "update", note: el, prev, next }),
};

function exec(op, reverse = false) {
  const { action, note } = op;
  switch (action) {
    case "create": reverse ? note.remove() : $("noteLayer").appendChild(note); break;
    case "delete": reverse ? op.parent.appendChild(note) : note.remove(); break;
    case "move":
      note.style.left = (reverse ? op.fromX : op.toX) + "px";
      note.style.top = (reverse ? op.fromY : op.toY) + "px";
      break;
    case "update":
      note.textContent = reverse ? op.prev : op.next;
      break;
  }
}

function invert(op) {
  const inv = { ...op };
  switch (op.action) {
    case "create": inv.action = "delete"; inv.parent = op.note.parentElement; break;
    case "delete": inv.action = "create"; break;
    case "move": [inv.fromX, inv.toX] = [inv.toX, inv.fromX];[inv.fromY, inv.toY] = [op.toY, op.fromY]; break;
    case "update": [inv.prev, inv.next] = [op.next, op.prev]; break;
  }
  return inv;
}

function doOp(op) {
  exec(op);
  undoStack.push(invert(op));
  redoStack.length = 0;
  scheduleSave();
  if (op.note?.classList.contains("highlight")) saveAllHighlights();
}

function undo() { const op = undoStack.pop(); if (!op) return; exec(op, true); redoStack.push(invert(op)); scheduleSave(); }
function redo() { const op = redoStack.pop(); if (!op) return; exec(op); undoStack.push(invert(op)); scheduleSave(); }

// 選択処理
function select(n) {
  if (selected) {
    if (selected.classList.contains("highlight")) {
      const colorName = selected.dataset.color || "yellow";
      const c = highlightColors[colorName] || highlightColors.yellow;
      selected.style.border = `2px solid ${c.border}`;
      selected.style.backgroundColor = c.bg;
    }
    if (selected.classList.contains("note")) {
      selected.classList.remove("selected");
    }
  }
  selected = n;

  // 新しく選択
  if (selected) {
    if (selected.classList.contains("highlight")) {
      selected.style.border = "2px solid rgba(0, 0, 255, 1)";
      selected.style.backgroundColor = "rgba(0, 0, 255, 0.22)";
    }
    if (selected.classList.contains("note")) {
      selected.classList.add("selected");
    }
  }

  // 削除ボタンの状態更新
  const btn = document.getElementById("deleteButton");
  if (btn) {
    if (!selected) {
      btn.disabled = true;
      btn.style.opacity = "0.5";
      // パレットも非表示
      const palette = document.getElementById("noteTextStylePalette");
      if (palette) palette.style.display = "none";
    } else {
      btn.disabled = false;
      btn.style.opacity = "1";
    }
  }
}

/* ---------- DOM → PDF座標変換 ---------- */
function domToPdf(el, pageNum) {
  const pageView = PDFViewerApplication.pdfViewer.getPageView(pageNum - 1);
  const vp = pageView.viewport;
  const rect = el.getBoundingClientRect();
  const pageRect = pageView.div.getBoundingClientRect();

  const domX = rect.left - pageRect.left;
  const domY = rect.top - pageRect.top;

  const [pdfX, pdfY] = vp.convertToPdfPoint(domX, domY);
  return { x: pdfX, y: pdfY, w: rect.width / vp.scale, h: rect.height / vp.scale };
}

/* ---------- 保存 ---------- */
// テキストボックス保存
function saveAllNotes() {
  const notes = [];
  document.querySelectorAll(".note").forEach(note => {
    const pageNum = +note.dataset.page || 1;
    const { x, y, w, h } = domToPdf(note, pageNum);

    notes.push({
      page: pageNum,
      x, y, w, h,
      text: note.textContent,
      bubbleAttached: note.dataset.bubbleAttached === "true",
      fontSize: note.dataset.fontSize || "14",
      color: note.dataset.color || "black"
    });
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ notes }));
}

// ハイライト保存
function saveAllHighlights() {
  const highlights = [];
  document.querySelectorAll(".highlight").forEach(h => {
    const pageNum = parseInt(h.dataset.page);
    const { x, y, w, h: height } = domToPdf(h, pageNum);
    highlights.push({ id: h.dataset.id, page: pageNum, x, y, w, h: height, color: h.dataset.color || "yellow" });
  });
  localStorage.setItem(HIGHLIGHT_KEY, JSON.stringify({ highlights }));
}

// 保存を一定時間（300ms）遅延実行して，頻繁な操作でも効率よく保存
function scheduleSave() {
  clearTimeout(window._saveTimer);
  window._saveTimer = setTimeout(() => {
    saveAllNotes();
    saveAllHighlights();
  }, 300);
}

/* ---------- ノート ---------- */
// ノート作成
function addNote(e) {
  const note = document.createElement("div");
  note.className = "note";
  // テキストボックスの右下の拡大表示部分
  note.contentEditable = "true";
  note.textContent = "ノート";

  if (!note.dataset.id) note.dataset.id = `note-${Date.now()}`;

  const noteWidth = 100, noteHeight = 50;
  note.style.width = noteWidth + "px";
  note.style.height = noteHeight + "px";

  // 文字スタイル初期値
  note.style.fontSize = "14px";
  note.style.color = "black";
  note.dataset.fontSize = "14";
  note.dataset.color = "black";

  const pageDiv = e.target.closest(".page");
  const pageNum = pageDiv ? +pageDiv.dataset.pageNumber : 1;
  note.dataset.page = pageNum;

  const pageView = PDFViewerApplication.pdfViewer.getPageView(pageNum - 1);
  const viewerRect = $("viewerContainer").getBoundingClientRect();
  const clickX = e.clientX - viewerRect.left + $("viewerContainer").scrollLeft;
  const clickY = e.clientY - viewerRect.top + $("viewerContainer").scrollTop;

  note.style.left = `${clickX}px`;
  note.style.top = `${clickY}px`;
  note.dataset.editing = "false";
  note.dataset.origText = note.textContent;

  // クリックで選択 & パレット表示
  note.onclick = e => {
    e.stopPropagation();
    select(note);
    showNoteTextStylePalette(note);
  };

  note.onfocus = () => { note.dataset.editing = "true"; note.dataset.origText = note.textContent; };
  note.onblur = () => commit(note);

  enableDrag(note);
  $("noteLayer").appendChild(note);
  note.focus();

  const pageX = clickX - (pageView.div.getBoundingClientRect().left - viewerRect.left);
  const pageY = clickY - (pageView.div.getBoundingClientRect().top - viewerRect.top);
  const [pdfX, pdfY] = pageView.viewport.convertToPdfPoint(pageX, pageY);

  note.dataset.x = pdfX;
  note.dataset.y = pdfY;
  note.dataset.w = noteWidth / pageView.viewport.scale;
  note.dataset.h = noteHeight / pageView.viewport.scale;

  doOp(OP.create(note));

  note.oncontextmenu = e => {
    e.preventDefault();
    // linkSelectedTextToNote(note);
  };
}

// フォーカスを外したときに編集内容を確定し，Undo履歴に登録
function commit(note) {
  if (!note || note.dataset.editing !== "true") return;
  const prev = note.dataset.origText, next = note.textContent;
  if (prev !== next) doOp(OP.update(note, prev, next));
  note.dataset.editing = "false";
  note.dataset.origText = next;
  scheduleSave();
}

// マウスドラッグでノートを移動可能に
function enableDrag(note) {
  let startX, startY, fromLeft, fromTop;
  note.onmousedown = e => {
    if (e.button !== 0) return;
    commit(note);
    startX = e.clientX; startY = e.clientY;
    const cs = getComputedStyle(note);
    fromLeft = parseFloat(cs.left); fromTop = parseFloat(cs.top);
    document.onmousemove = move; document.onmouseup = up;
  };
  const move = e => {
    note.style.left = `${fromLeft + e.clientX - startX}px`;
    note.style.top = `${fromTop + e.clientY - startY}px`;
  };
  const up = () => {
    document.onmousemove = document.onmouseup = null;
    const pageNum = parseInt(note.dataset.page);
    const { x, y, w, h } = domToPdf(note, pageNum);
    note.dataset.x = x; note.dataset.y = y; note.dataset.w = w; note.dataset.h = h;
    scheduleSave();
  };
}

/* ---------- ハイライト ---------- */
// ハイライト追加
function enableHighlightDrawing() {
  const vc = $("viewerContainer");
  let drawing = false, highlight = null, startX, startY, pageNum;

  vc.addEventListener("mousedown", e => {
    if (!highlightMode || e.button !== 0) return;

    const pageDiv = e.target.closest(".page");
    if (!pageDiv) return;
    pageNum = parseInt(pageDiv.dataset.pageNumber);

    const vcRect = vc.getBoundingClientRect();
    startX = e.clientX - vcRect.left + vc.scrollLeft;
    startY = e.clientY - vcRect.top + vc.scrollTop;

    highlight = document.createElement("div");
    highlight.className = "highlight";
    highlight.style.position = "absolute";

    const colorDef = highlightColors[currentHighlightColor] || highlightColors.yellow;
    highlight.style.border = `2px solid ${colorDef.border}`;
    highlight.style.backgroundColor = colorDef.bg;
    highlight.dataset.color = currentHighlightColor;

    highlight.style.left = `${startX}px`;
    highlight.style.top = `${startY}px`;
    highlight.style.width = "0px";
    highlight.style.height = "0px";
    highlight.style.pointerEvents = "auto";
    highlight.dataset.page = pageNum;
    $("noteLayer").appendChild(highlight);

    drawing = true;
  });

  vc.addEventListener("mousemove", e => {
    if (!highlightMode || !drawing) return;
    const vcRect = vc.getBoundingClientRect();
    const currentX = e.clientX - vcRect.left + vc.scrollLeft;
    const currentY = e.clientY - vcRect.top + vc.scrollTop;
    highlight.style.width = `${Math.abs(currentX - startX)}px`;
    highlight.style.height = `${Math.abs(currentY - startY)}px`;
    highlight.style.left = `${Math.min(startX, currentX)}px`;
    highlight.style.top = `${Math.min(startY, currentY)}px`;
  });

  vc.addEventListener("mouseup", e => {
    if (!highlightMode || !drawing) return;
    drawing = false;
    commitHighlight(highlight, pageNum);
    select(highlight);
    highlightMode = false;
    vc.style.cursor = "default";
    hideColorPalette();
  });
}

// ハイライトのPDF座標を計算し保存
function commitHighlight(h, pageNum) {
  if (!h) return;
  if (!pageNum) pageNum = parseInt(h.dataset.page) || 1;
  h.dataset.page = pageNum;
  h.dataset.id = h.dataset.id || `hl-${Date.now()}`;

  const { x, y, w, h: height } = domToPdf(h, pageNum);
  h.dataset.x = x; h.dataset.y = y; h.dataset.w = w; h.dataset.h = height;

  doOp(OP.create(h));
  enableHighlightSelection(h);
}

// クリックで選択・右クリックで色パレットを表示して色変更可能
function enableHighlightSelection(h) {
  h.onclick = e => {
    e.stopPropagation();
    select(h);
  };

  h.oncontextmenu = e => {
    e.preventDefault();
    const palette = createColorPaletteIfNeeded();

    const rect = h.getBoundingClientRect();
    palette.style.left = `${rect.right + 6}px`;
    palette.style.top = `${rect.top}px`;
    palette.style.display = "flex";

    Array.from(palette.children).forEach(btn => {
      btn.onclick = ev => {
        const colorName = btn.dataset.colorName;
        const c = highlightColors[colorName];
        h.dataset.color = colorName;
        h.style.border = `2px solid ${c.border}`;
        h.style.backgroundColor = c.bg;
        palette.style.display = "none";
        saveAllHighlights();
      };
    });
  };
}

/* ---------- 復元処理 ---------- */
// ノート復元
function restoreNotes() {
  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) return;
  const { notes } = JSON.parse(data);

  notes.forEach(n => {
    const note = document.createElement("div");
    note.className = "note";
    note.contentEditable = "true";
    note.textContent = n.text;
    Object.assign(note.dataset, n);

    // 復元時に文字色・サイズを style に反映
    note.style.color = n.color || "black";
    note.style.fontSize = (n.fontSize || "14") + "px";

    note.onclick = e => { e.stopPropagation(); select(note); showNoteTextStylePalette(note); };
    note.onfocus = () => { note.dataset.editing = "true"; note.dataset.origText = note.textContent; };
    note.onblur = () => commit(note);

    enableDrag(note);
    $("noteLayer").appendChild(note);

    if (note.dataset.bubbleAttached === "true") {
      const bubble = document.createElement("div");
      bubble.className = "note-bubble";
      bubble.textContent = "💬";
      bubble.style.position = "absolute";
      bubble.style.fontSize = "22px";
      bubble.style.cursor = "pointer";

      const page = parseInt(note.dataset.page);
      const pageView = PDFViewerApplication.pdfViewer.getPageView(page - 1);
      if (pageView) {
        const vp = pageView.viewport;
        const [viewX, viewY] = vp.convertToViewportPoint(
          parseFloat(note.dataset.x),
          parseFloat(note.dataset.y)
        );
        bubble.style.left = `${Math.max(viewX - 28 + pageView.div.offsetLeft, 0)}px`;
        bubble.style.top = `${viewY + pageView.div.offsetTop}px`;
      } else {
        bubble.style.left = "0px";
        bubble.style.top = "0px";
      }

      bubble.onclick = () => {
        note.style.display = "block";
        note.focus();
        document.querySelectorAll(".note-bubble").forEach(b => b.remove());
        document.querySelectorAll(".note").forEach(n => n.style.display = "block");
        note.dataset.bubbleAttached = "false";
      };

      $("noteLayer").appendChild(bubble);
      note.style.display = "none";
    }
  });
  updateNotePositions();

  if (notes?.length) {
    console.log("📘 復元後のノート一覧:");
    console.table(notes);
  }
}

// ハイライト復元
function restoreHighlights() {
  const data = localStorage.getItem(HIGHLIGHT_KEY);
  if (!data) return;
  const { highlights } = JSON.parse(data);
  highlights.forEach(h => {
    const el = document.createElement("div");
    el.className = "highlight";
    Object.assign(el.dataset, h);
    el.style.position = "absolute";
    const colorName = h.color || "yellow";
    const c = highlightColors[colorName] || highlightColors.yellow;
    el.style.border = `2px solid ${c.border}`;
    el.style.backgroundColor = c.bg;
    el.style.pointerEvents = "auto";
    enableHighlightSelection(el);
    $("noteLayer").appendChild(el);
  });
  updateNotePositions();
  if (highlights?.length) {
    console.log("🖍 復元後のハイライト一覧:");
    console.table(highlights);
  }
}

// PDFズームやページ移動時に PDF座標 → DOM座標 変換して再配置
function updateNotePositions() {
  document.querySelectorAll(".note, .highlight").forEach(el => {
    const page = parseInt(el.dataset.page);
    const pdfX = parseFloat(el.dataset.x);
    const pdfY = parseFloat(el.dataset.y);
    const pdfW = parseFloat(el.dataset.w);
    const pdfH = parseFloat(el.dataset.h);
    const pageView = PDFViewerApplication.pdfViewer.getPageView(page - 1);
    if (!pageView) return;
    const vp = pageView.viewport;
    const [viewX, viewY] = vp.convertToViewportPoint(pdfX, pdfY);
    el.style.left = `${viewX + pageView.div.offsetLeft}px`;
    el.style.top = `${viewY + pageView.div.offsetTop}px`;
    el.style.width = `${pdfW * vp.scale}px`;
    el.style.height = `${pdfH * vp.scale}px`;

    // 吹き出しが紐付いていればノート位置に追従
    if (el.classList.contains("note") && el.dataset.bubbleAttached === "true") {
      const bubble = document.querySelector(`.note-bubble[data-note-id="${el.dataset.id}"]`);
      if (bubble) {
        bubble.style.left = `${Math.max(viewX + pageView.div.offsetLeft - 28, 0)}px`;
        bubble.style.top = `${viewY + pageView.div.offsetTop}px`;
      }
    }
  });
}

/* ---------- カラーパレット（ツールバー横に表示） ---------- */
// テキストボックスのノート色選択（仮）
function showNoteTextStylePalette(note) {
  let palette = document.getElementById("noteTextStylePalette");
  if (!palette) {
    palette = document.createElement("div");
    palette.id = "noteTextStylePalette";
    palette.style.position = "absolute";
    palette.style.display = "flex";
    palette.style.flexDirection = "column"; // 縦方向に並べる
    palette.style.gap = "6px";
    palette.style.padding = "6px";
    palette.style.border = "1px solid #bbb";
    palette.style.background = "#fff";
    palette.style.boxShadow = "0 2px 6px rgba(0,0,0,0.15)";
    palette.style.zIndex = 3000;
    document.body.appendChild(palette);
  }

  palette.innerHTML = "";

  // 1行目：文字サイズ
  const sizeRow = document.createElement("div");
  sizeRow.style.display = "flex";
  sizeRow.style.gap = "6px";
  [12, 14, 16, 18].forEach(size => {
    const btn = document.createElement("button");
    btn.textContent = size + "px";
    btn.onclick = () => { note.style.fontSize = size + "px"; note.dataset.fontSize = size; scheduleSave(); };
    sizeRow.appendChild(btn);
  });
  palette.appendChild(sizeRow);

  // 2行目：文字色
  const colorRow = document.createElement("div");
  colorRow.style.display = "flex";
  colorRow.style.gap = "6px";
  ["black", "red", "blue", "green"].forEach(color => {
    const btn = document.createElement("button");
    btn.style.background = color;
    btn.style.width = "20px"; btn.style.height = "20px";
    btn.style.border = "1px solid #666";
    btn.onclick = () => { note.style.color = color; note.dataset.color = color; scheduleSave(); };
    colorRow.appendChild(btn);
  });
  palette.appendChild(colorRow);

  // note の下に表示
  const rect = note.getBoundingClientRect();
  palette.style.left = `${rect.left}px`;
  palette.style.top = `${rect.bottom + 6}px`;
  palette.style.display = "flex";
}

// ハイライトの色選択
function createColorPaletteIfNeeded() {
  let palette = $("highlightColorPalette");
  if (palette) return palette;

  palette = document.createElement("div");
  palette.id = "highlightColorPalette";
  palette.style.position = "absolute";
  palette.style.display = "none";
  palette.style.gap = "6px";
  palette.style.padding = "6px";
  palette.style.border = "1px solid #bbb";
  palette.style.background = "#fff";
  palette.style.boxShadow = "0 2px 6px rgba(0,0,0,0.15)";
  palette.style.zIndex = 2000;

  // 色ボタンを作る
  Object.keys(highlightColors).forEach(name => {
    const c = highlightColors[name];
    const btn = document.createElement("button");
    btn.title = name;
    btn.style.width = "26px";
    btn.style.height = "26px";
    btn.style.borderRadius = "4px";
    btn.style.border = "1px solid #666";
    btn.style.background = c.bg; // 背景で見せる（透過ボックス色）
    btn.dataset.colorName = name;
    btn.onclick = ev => {
      currentHighlightColor = name;
      highlightMode = true;
      const vc = $("viewerContainer");
      if (vc) vc.style.cursor = "crosshair";
      hideColorPalette();
    };
    palette.appendChild(btn);
  });

  document.body.appendChild(palette);
  return palette;
}

function showColorPaletteNear(element) {
  const palette = createColorPaletteIfNeeded();
  // element の座標を基準に表示
  const rect = element.getBoundingClientRect();
  palette.style.left = `${rect.right + 6}px`;
  palette.style.top = `${rect.top}px`;
  palette.style.display = "flex";
}

// パレット非表示
function hideColorPalette() {
  const palette = $("highlightColorPalette");
  if (palette) palette.style.display = "none";
}

/* ---------- 初期化 ---------- */
function initFull() {
  const vc = $("viewerContainer");

  // ノート追加ボタンの生成，切り替え
  let noteBtn = $("addNoteButton") || (() => {
    const b = document.createElement("button");
    b.id = "addNoteButton"; b.textContent = "📝"; b.className = "toolbarButton noteButton";
    $("toolbarViewerLeft")?.appendChild(b);
    return b;
  })();
  noteBtn.onclick = () => {
    addMode = !addMode; highlightMode = false;
    const vcEl = $("viewerContainer");
    if (vcEl) vcEl.style.cursor = addMode ? "crosshair" : "default";
    hideColorPalette();
  };

  // PDF上のクリックでノート追加 or 選択解除
  vc.addEventListener("click", e => {
    if (addMode) { addNote(e); addMode = false; vc.style.cursor = "default"; }
    else select(null);
  }, true);

  // ハイライト追加ボタンの生成，切り替え
  let hlBtn = $("addHighlightButton") || (() => {
    const b = document.createElement("button");
    b.id = "addHighlightButton"; b.textContent = "🖍"; b.className = "toolbarButton noteButton";
    $("toolbarViewerLeft")?.appendChild(b);
    return b;
  })();
  hlBtn.onclick = () => {
    const palette = $("highlightColorPalette");
    if (!palette) return;

    // すでに表示されていれば非表示にして解除
    if (palette.style.display === "flex") {
      palette.style.display = "none";
      highlightMode = false;
      return;
    }

    // 表示してノートモードはオフ
    highlightMode = false;
    addMode = false;
    showColorPaletteNear(hlBtn);
  };

  // 吹き出しボタンの生成
  const bubbleButton = document.getElementById("bubbleButton");
  if (bubbleButton) {
    bubbleButton.addEventListener("click", toggleAllBubbles);
  }

  // キーボード操作（Delete / Undo / Redo）
  document.addEventListener("keydown", e => {
    const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (e.key === "Delete" && selected) {
      if (selected.classList.contains("note")) {
        doOp(OP.delete(selected, selected.parentElement));
        select(null);
        scheduleSave();
      } else if (selected.classList.contains("highlight")) {
        doOp(OP.delete(selected, selected.parentElement));
        select(null);
        saveAllHighlights();
      }
    }
    if (ctrl && k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    if (ctrl && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
  });

  // ノートレイヤーのサイズをPDF表示に合わせる
  const sync = () => {
    const v = $("viewer");
    const nl = $("noteLayer");
    if (!v || !nl) return;
    nl.style.width = `${v.scrollWidth}px`;
    nl.style.height = `${v.scrollHeight}px`;
  };
  PDFViewerApplication.eventBus.on("pagesinit", sync);
  PDFViewerApplication.eventBus.on("scalechanging", sync);
  window.addEventListener("resize", sync);
  sync();

  // スケール・レンダリングに追従
  PDFViewerApplication.eventBus.on("scalechanging", updateNotePositions);
  PDFViewerApplication.eventBus.on("scalechanged", updateNotePositions);
  PDFViewerApplication.eventBus.on("pagerendered", () => setTimeout(updateNotePositions, 10));
  window.addEventListener("resize", updateNotePositions);

  enableHighlightDrawing();
  createColorPaletteIfNeeded();
  createDeleteButton();
}

// すべてのノートを💬に切り替え
function toggleAllBubbles() {
  const layer = $("noteLayer");
  if (!layer) return;

  const existingBubbles = layer.querySelectorAll(".note-bubble");
  if (existingBubbles.length > 0) {
    existingBubbles.forEach(b => b.remove());
    layer.querySelectorAll(".note").forEach(n => {
      n.style.display = "block";
      n.dataset.bubbleAttached = "false";
    });
    return;
  }

  layer.querySelectorAll(".note").forEach(note => {
    if (note.dataset.bubbleAttached === "true") return;

    const bubble = document.createElement("div");
    bubble.className = "note-bubble";
    bubble.textContent = "💬";
    bubble.style.position = "absolute";
    bubble.style.fontSize = "22px";
    bubble.style.cursor = "pointer";

    const left = parseFloat(note.style.left) || 0;
    const top = parseFloat(note.style.top) || 0;
    bubble.style.left = `${Math.max(left - 28, 0)}px`;
    bubble.style.top = `${top}px`;

    // ノートIDを必ず紐付け
    bubble.dataset.noteId = note.dataset.id;

    bubble.onclick = () => {
      const linkedNote = layer.querySelector(`.note[data-id="${bubble.dataset.noteId}"]`);
      if (!linkedNote) return;
      linkedNote.style.display = "block";
      linkedNote.focus();
      linkedNote.dataset.bubbleAttached = "false";

      layer.querySelectorAll(".note-bubble").forEach(b => b.remove());
      layer.querySelectorAll(".note").forEach(n => n.style.display = "block");
    };

    layer.appendChild(bubble);
    note.style.display = "none";
    note.dataset.bubbleAttached = "true";
  });
}

// 2025/10/20 ノート紐付け関連（試作）
// function linkSelectedTextToNote(note) {
//   const selection = window.getSelection();
//   if (!selection.rangeCount) return;

//   const range = selection.getRangeAt(0);
//   const selectedText = selection.toString();
//   if (!selectedText) return;

//   const rect = range.getBoundingClientRect();
//   note.dataset.linkedText = selectedText;
//   note.dataset.textTop = rect.top + window.scrollY;
//   note.dataset.textLeft = rect.left + window.scrollX;
//   note.dataset.textWidth = rect.width;
//   note.dataset.textHeight = rect.height;

//   console.log("ノートとテキストを紐付けました:", note.dataset);
//   // 必要なら localStorage にも保存
//   scheduleSave();
// }

/* ---------- 削除ボタン（ノート＆ハイライト共通） ---------- */
function createDeleteButton() {
  const btn = document.getElementById("deleteButton"); // ← HTML 側のボタンを取得
  if (!btn) return; // 念のため存在確認

  const updateButtonState = () => {
    if (!selected) {
      btn.disabled = true;
      btn.style.opacity = "0.5";
    } else {
      btn.disabled = false;
      btn.style.opacity = "1";
    }
  };

  // 選択が変わったらボタンの状態を更新
  document.addEventListener("selectionchange", updateButtonState);
  updateButtonState();

  btn.onclick = () => {
    if (!selected) return;

    if (!confirm("本当に削除しますか？")) return;

    if (selected.classList.contains("note")) {
      doOp(OP.delete(selected, selected.parentElement));
      selected.remove();
      select(null);
      scheduleSave();
    } else if (selected.classList.contains("highlight")) {
      doOp(OP.delete(selected, selected.parentElement));
      selected.remove();
      select(null);
      saveAllHighlights();
    }

    updateButtonState();
  };
}

function createNoteTextStylePalette() {
  const palette = document.createElement("div");
  palette.id = "noteTextStylePalette";
  palette.style.position = "absolute";
  palette.style.display = "none";
  palette.style.gap = "6px";
  palette.style.padding = "6px";
  palette.style.border = "1px solid #bbb";
  palette.style.background = "#fff";
  palette.style.boxShadow = "0 2px 6px rgba(0,0,0,0.15)";
  palette.style.zIndex = 3000;
  palette.style.flexWrap = "wrap";     // 2行対応
  palette.style.maxWidth = "200px";    // 最大幅調整
  document.body.appendChild(palette);
  return palette;
}

function positionPalette(palette, note) {
  const rect = note.getBoundingClientRect();
  palette.style.display = "block"; // サイズ計算用
  const paletteRect = palette.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // ノート下に表示
  let left = rect.left;
  let top = rect.bottom + 6;

  // 右端チェック
  if (left + paletteRect.width > viewportWidth) {
    left = Math.max(viewportWidth - paletteRect.width - 6, 6);
  }

  // 下端チェック
  if (top + paletteRect.height > viewportHeight) {
    top = Math.max(rect.top - paletteRect.height - 6, 6); // ノート上に表示
  }

  palette.style.left = `${left}px`;
  palette.style.top = `${top}px`;
}

/* ---------- 起動 ---------- */
(PDFViewerApplication?.initializedPromise
  ?? new Promise(r =>
    window.addEventListener("webviewerloaded", r, { once: true })
  )
)
  .then(() => {
    initFull();
    PDFViewerApplication.eventBus.on("pagesloaded", () => {
      restoreNotes();
      restoreHighlights();
    });
  });
