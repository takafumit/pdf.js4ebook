/* ========================================================
   noteExtension.js – PDF.js (v5.3.31) ノート拡張
   Robust Undo / Redo：create, move, delete, update
   ======================================================== */

/* ---------- グローバル設定 ---------- */
// モードや Undo/Redo ，ローカルストレージ保存関連
let textMode = false;
let highlightMode = false;

// 2025/11/18
let freeHighlightMode = false;
let freeRect = null;
let freeRectStart = null;
let selectedPageView = null;

let selected = null;
let undoStack = [], redoStack = [];
let linkingNote = null; // 2025/10/26 グローバル変数として追加
const HANDLE = 12;

const pdfId = PDFViewerApplication?.url?.split("/").pop() ?? "untitled.pdf";
const TEXT_KEY = `notes::${pdfId}`;
const HIGHLIGHT_KEY = `highlights::${pdfId}`;

/* ---------- 色定義 ---------- */
const highlightColors = {
  yellow: { name: "yellow", border: "rgba(255,255,0,0.5)", bg: "rgba(255,255,0,0.3)" },
  green: { name: "green", border: "rgba(144,238,144,0.5)", bg: "rgba(144,238,144,0.3)" },
  pink: { name: "pink", border: "rgba(255,182,193,0.6)", bg: "rgba(255,182,193,0.4)" },
};
let currentHighlightColor = "yellow";

// 安全な $ ヘルパー（存在しなければ null を返す）
const $ = id => document.getElementById(id);

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

/* ---------- ハイライトを複数行選択したときに1つにまとめるときに使用 ---------- */
function mergeRects(rects, threshold = 3) {
  const rs = rects.map(r => ({
    left: r.left,
    top: r.top,
    right: r.right ?? (r.left + r.width),
    bottom: r.bottom ?? (r.top + r.height),
    width: r.width,
    height: r.height
  }));
  rs.sort((a, b) => a.top - b.top || a.left - b.left);

  const merged = [];
  for (const r of rs) {
    const last = merged[merged.length - 1];
    if (!last) {
      merged.push({ ...r });
      continue;
    }
    const verticalClose = Math.abs(last.top - r.top) <= threshold;
    const horizontalOverlap = !(r.left > last.right + threshold || r.right < last.left - threshold);
    if (verticalClose && horizontalOverlap) {
      // extend last to cover both
      last.left = Math.min(last.left, r.left);
      last.right = Math.max(last.right, r.right);
      last.top = Math.min(last.top, r.top);
      last.bottom = Math.max(last.bottom, r.bottom);
      last.width = last.right - last.left;
      last.height = last.bottom - last.top;
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

/* ---------- 保存処理 ---------- */
function scheduleSave() {
  clearTimeout(window._saveTimer);
  window._saveTimer = setTimeout(() => {
    saveAllNotes();
    saveAllHighlights();
  }, 300);

  // 2025/11/11 自動的にサーバ保存
  saveTimer = setTimeout(() => {
    saveAllToServer();
  }, 300);
}

/* ---------- Undo/Redo ---------- */
const OP = {
  create: (el, parent) => ({ action: "create", note: el, parent }),
  delete: (el, parent) => ({ action: "delete", note: el, parent }),
  move: (el, fromX, fromY, toX, toY) => ({ action: "move", note: el, fromX, fromY, toX, toY }),
  resize: (el, fromW, fromH, toW, toH) => ({ action: "resize", note: el, fromW, fromH, toW, toH }),
  update: (el, prev, next) => ({ action: "update", note: el, prev, next }),
  updateColor: (el, prev, next) => ({ action: "updateColor", note: el, prev, next }),
  updateStyle: (el, prev, next) => ({ action: "updateStyle", note: el, prev, next }),
};

// Undo/Redo 対応のノート操作関数
function exec(op) {
  const note = op.note;
  switch (op.action) {
    case "create":
      console.log("exec create:", note);
      $("noteLayer").appendChild(note);
      break;

    case "delete":
      console.log("removing note:", note);
      note.remove();
      break;

    case "move":
      note.style.left = op.toX + "px";
      note.style.top = op.toY + "px";
      break;

    case "resize":
      note.style.width = op.toW + "px";
      note.style.height = op.toH + "px";
      break;

    case "update":
      note.textContent = op.next;
      break;

    case "updateColor":
      const color = op.next;
      note.dataset.color = color;
      const c = highlightColors[color];
      note.style.backgroundColor = c.bg;
      note.style.border = `1px solid ${c.border}`;
      break;

    case "updateStyle":
      if (op.next.fontSize) {
        note.style.fontSize = op.next.fontSize + "px";
        note.dataset.fontSize = op.next.fontSize;
      }
      if (op.next.color) {
        note.style.color = op.next.color;
        note.dataset.color = op.next.color;
      }
      break;

    default:
      console.warn("Unknown op:", op);
  }
}

// 操作の逆バージョンを作る関数
function invert(op) {
  const inv = { ...op };
  switch (op.action) {
    case "create":
      inv.action = "delete";
      break;
    case "delete":
      inv.action = "create";
      break;
    case "move":
      [inv.fromX, inv.toX] = [op.toX, op.fromX];
      [inv.fromY, inv.toY] = [op.toY, op.fromY];
      break;
    case "resize":
      [inv.fromW, inv.toW] = [op.toW, op.fromW];
      [inv.fromH, inv.toH] = [op.toH, op.fromH];
      break;
    case "update":
    case "updateColor":
      [inv.prev, inv.next] = [op.next, op.prev];
      break;
    case "updateStyle":
      [inv.prev, inv.next] = [op.next, op.prev];
      break;
  }
  return inv;
}

// 操作の実行
function doOp(op) {
  console.log("doOp called:", op);
  exec(op);
  undoStack.push(invert(op));
  redoStack.length = 0;
  scheduleSave();
  if (op.note?.classList.contains("highlight")) saveAllHighlights();
}

// 元に戻す ＆ やり直す
function undo() {
  const op = undoStack.pop();
  if (!op) return;
  console.log("undo op:", op);
  exec(op);
  redoStack.push(invert(op));
  scheduleSave();
}

function redo() {
  const op = redoStack.pop();
  if (!op) return;
  console.log("redo op:", op);
  exec(op);
  undoStack.push(invert(op));
  scheduleSave();
}

/* ---------- 選択処理 ---------- */
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

  if (selected) {
    if (selected.classList.contains("highlight")) {
      selected.style.border = "2px solid rgba(0, 0, 255, 1)";
      selected.style.backgroundColor = "rgba(0, 0, 255, 0.22)";
    }
    if (selected.classList.contains("note")) {
      selected.classList.add("selected");
    }
  }
}

/* ---------- テキストボックス関連 ---------- */
// 1. テキストボックス生成，編集
// addNote(e), commit(note), enableDrag(note), enableResize(note)
function addNote(e) {
  const note = document.createElement("div");
  note.className = "note";
  note.contentEditable = "true";
  note.textContent = "ノート";
  note.dataset.id = `note-${Date.now()}`;

  const noteWidth = 100, noteHeight = 50;
  note.style.width = noteWidth + "px";
  note.style.height = noteHeight + "px";

  note.style.fontSize = "14px";
  note.style.color = "black";
  note.dataset.fontSize = "14";
  note.dataset.color = "black";
  note.dataset.bubbleAttached = "false";

  const viewerContainer = $("viewerContainer");
  const viewerRect = viewerContainer.getBoundingClientRect();
  const clickX = e.clientX;
  const clickY = e.clientY;

  let pageNum = null;
  let targetPageView = null;

  for (let i = 0; i < PDFViewerApplication.pdfViewer._pages.length; i++) {
    const pageView = PDFViewerApplication.pdfViewer.getPageView(i);
    const rect = pageView.div.getBoundingClientRect();
    if (clickY >= rect.top && clickY <= rect.bottom) {
      pageNum = i + 1;
      targetPageView = pageView;
      break;
    }
  }

  if (!targetPageView) {
    pageNum = PDFViewerApplication.pdfViewer.currentPageNumber;
    targetPageView = PDFViewerApplication.pdfViewer.getPageView(pageNum - 1);
  }

  const pageRect = targetPageView.div.getBoundingClientRect();
  const pageX = clickX - pageRect.left;
  const pageY = clickY - pageRect.top;

  const [pdfX, pdfY] = targetPageView.viewport.convertToPdfPoint(pageX, pageY);

  note.style.left = `${pageRect.left - viewerRect.left + pageX + viewerContainer.scrollLeft}px`;
  note.style.top = `${pageRect.top - viewerRect.top + pageY + viewerContainer.scrollTop}px`;

  note.dataset.page = pageNum;
  note.dataset.x = pdfX;
  note.dataset.y = pdfY;
  note.dataset.w = noteWidth / targetPageView.viewport.scale;
  note.dataset.h = noteHeight / targetPageView.viewport.scale;

  $("noteLayer").appendChild(note);
  enableDrag(note);
  enableResize(note);
  note.focus();

  note.dataset.editing = "false";
  note.dataset.origText = note.textContent;
  note.onblur = () => commit(note);

  note.onclick = e => {
    e.stopPropagation();
    select(note);
    showNoteTextStylePalette(note);
  };

  note.addEventListener("input", () => {
    note.dataset.origText = note.textContent;
    scheduleSave();
  });

  // doOp(OP.create(note));
  doOp(OP.create(note, $("noteLayer")));
  console.log("undoStack:", undoStack);
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

// マウスドラッグでテキストボックスを移動可能に
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

    doOp(OP.move(
      note,
      fromLeft,
      fromTop,
      parseFloat(note.style.left),
      parseFloat(note.style.top)
    ));

    scheduleSave();
    saveNotesToServer();
  };
}

// テキストボックスをマウスでドラッグしてリサイズできるようにする処理
function enableResize(note) {
  if (note.querySelector(".note-resize-handle")) return;

  const handle = document.createElement("div");
  handle.className = "note-resize-handle";
  note.appendChild(handle);

  let startX, startY, startWidth, startHeight;
  let prevEditable;

  handle.onmousedown = e => {
    e.stopPropagation();

    document.body.style.userSelect = "none";

    prevEditable = note.contentEditable;
    note.contentEditable = "false";

    startX = e.clientX;
    startY = e.clientY;
    const cs = getComputedStyle(note);
    startWidth = parseFloat(cs.width);
    startHeight = parseFloat(cs.height);

    document.onmousemove = move;
    document.onmouseup = up;
  };

  function move(e) {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    note.style.width = `${startWidth + dx}px`;
    note.style.height = `${startHeight + dy}px`;
  }

  function up() {
    document.onmousemove = document.onmouseup = null;

    const pageNum = parseInt(note.dataset.page);
    const { x, y, w, h } = domToPdf(note, pageNum);
    note.dataset.w = w;
    note.dataset.h = h;

    doOp(OP.resize(
      note,
      startWidth,
      startHeight,
      parseFloat(note.style.width),
      parseFloat(note.style.height)
    ));

    scheduleSave();
    saveNotesToServer();

    note.contentEditable = prevEditable ?? "true";
    document.body.style.userSelect = "auto";
  }

  const vc = $("viewerContainer");
  setTimeout(() => {
    if (textMode && !note.isResizing) {
      vc.style.cursor = "crosshair";
      console.log("テキストボックスモード再開 (条件付き)");
    }
  }, 50);
}

// 2. テキストボックス保存，復元
// saveAllNotes()，restoreNotes()
function saveAllNotes() {
  const notes = [];
  document.querySelectorAll(".note").forEach(note => {
    const pageNum = +note.dataset.page || 1;
    const { x, y, w, h } = domToPdf(note, pageNum);

    if (!note.dataset.id) note.dataset.id = `note-${Date.now()}`;

    notes.push({
      id: note.dataset.id,
      page: pageNum,
      x, y, w, h,
      text: note.textContent,
      bubbleAttached: note.dataset.bubbleAttached === "true",
      fontSize: note.dataset.fontSize || "14",
      color: note.dataset.color || "black",
      linkedText: note.dataset.linkedText || ""
    });
  });
  localStorage.setItem(TEXT_KEY, JSON.stringify({ notes }));

  // if (notes?.length) {
  //   console.log(`📝 現在のテキストボックス一覧 (${notes.length}件):`);
  //   console.table(notes);
  // }
  saveNotesToServer(notes);
}

function restoreNotes() {
  const data = localStorage.getItem(TEXT_KEY);
  if (!data) return;
  const { notes } = JSON.parse(data);

  notes.forEach(n => {
    const note = document.createElement("div");
    note.className = "note";
    note.contentEditable = "true";
    note.textContent = n.text;

    // dataset に linkedText を含めてコピー
    Object.assign(note.dataset, n);

    // linkedText を確認用に console に表示（任意）
    if (note.dataset.linkedText) {
      console.log("復元された linkedText:", note.dataset.linkedText);
    }

    // 復元時に文字色・サイズを style に反映
    note.style.color = n.color || "black";
    note.style.fontSize = (n.fontSize || "14") + "px";

    note.onclick = e => { e.stopPropagation(); select(note); showNoteTextStylePalette(note); };
    note.onfocus = () => { note.dataset.editing = "true"; note.dataset.origText = note.textContent; };
    note.onblur = () => commit(note);

    note.addEventListener("input", () => {
      note.dataset.origText = note.textContent;
      scheduleSave();
    });

    enableDrag(note);
    enableResize(note);
    $("noteLayer").appendChild(note);
  });

  updateNotePositions();

  if (notes?.length) {
    console.log("📝 復元後のテキストボックス一覧:");
    console.table(notes);
  }
}

// 3. テキストボックス表示補助
// showNoteTextStylePalette(note), hideNoteColorPalette()
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
  // 文字サイズの行（S/M/L/XL版）
  const sizeRow = document.createElement("div");
  sizeRow.style.display = "flex";
  sizeRow.style.gap = "6px";

  const sizes = [
    { label: "S", value: 12 },
    { label: "M", value: 14 },
    { label: "L", value: 16 },
    { label: "XL", value: 18 }
  ];

  sizes.forEach(s => {
    const btn = document.createElement("button");
    btn.textContent = s.label;

    btn.onclick = () => {
      const prev = { fontSize: note.dataset.fontSize };
      const next = { fontSize: s.value };

      // Undo 対応
      doOp(OP.updateStyle(note, prev, next));
    };

    sizeRow.appendChild(btn);
  });

  palette.appendChild(sizeRow);


  // 2行目：文字色
  const colorRow = document.createElement("div");
  colorRow.style.display = "flex";
  colorRow.style.gap = "6px";
  ["black", "red", "blue", "green", "orange", "purple"].forEach(color => {
    const btn = document.createElement("button");
    btn.style.background = color;
    btn.style.width = "20px"; btn.style.height = "20px";
    btn.style.border = "1px solid #666";

    btn.onclick = () => {
      const prev = { color: note.dataset.color };
      const next = { color };

      // Undo 対応
      doOp(OP.updateStyle(note, prev, next));
    };

    colorRow.appendChild(btn);
  });

  palette.appendChild(colorRow);

  // 2025/10/26
  // 3行目：紐付けボタン
  const linkBtn = document.createElement("button");
  linkBtn.textContent = "紐付け追加";
  linkBtn.title = "PDFに紐付け";
  linkBtn.onclick = () => {
    linkingNote = note;
    const vc = $("viewerContainer");
    if (vc) vc.style.cursor = "crosshair";
    console.log("ノートをPDFに紐付けする準備完了");
    showLinkStatus("紐付け開始");
    addMode = false;
    highlightMode = false;
    setHighlightSelectable(true);
  };
  palette.appendChild(linkBtn);

  // 4行目：紐付け削除ボタン
  const linkDelBtn = document.createElement("button");
  linkDelBtn.textContent = "紐付け削除";
  linkDelBtn.title = "PDFの紐付け削除";
  linkDelBtn.onclick = e => {
    e.stopPropagation();
    note.dataset.linkedText = "";
    console.log("ノートの紐付けを削除しました:", note.textContent);
    showLinkStatus("紐付け削除完了");
    scheduleSave();
  };
  palette.appendChild(linkDelBtn);

  // 5行目：テキストボックス専用の削除ボタン
  const delBtn = document.createElement("button");
  delBtn.textContent = "× 削除";
  delBtn.style.color = "white";
  delBtn.style.background = "red";
  delBtn.style.border = "none";
  delBtn.style.padding = "4px 8px";
  delBtn.style.borderRadius = "4px";

  delBtn.onclick = (e) => {
    e.stopPropagation();
    doOp(OP.delete(note, note.parentElement));
    select(null);
    palette.remove();
  };

  palette.appendChild(delBtn);

  // note の下に表示
  const rect = note.getBoundingClientRect();
  palette.style.left = `${rect.left}px`;
  palette.style.top = `${rect.bottom + 6}px`;
  palette.style.display = "flex";
}

function hideNoteColorPalette() {
  const palette = $("noteTextStylePalette");
  if (palette) {
    palette.style.display = "none";
  }
}

/* ---------- PDFテキスト上のハイライト関連 ---------- */
// 1. ハイライト追加，選択
// addHighlightFromSelection()，toggleHighlightSelection(hl)
function addHighlightFromSelection() {
  const selection = window.getSelection();
  if (!highlightMode || !selection.rangeCount) return;

  const range = selection.getRangeAt(0);
  const selectedText = selection.toString().trim();
  if (!selectedText) return;

  // 元の全Rectを取得
  const rects = Array.from(range.getClientRects());

  // 不正・極小Rectを除外
  const MIN_WIDTH = 2;
  const MIN_HEIGHT = 2;
  const filteredRects = rects.filter(r => r.width >= MIN_WIDTH && r.height >= MIN_HEIGHT);
  if (filteredRects.length === 0) {
    selection.removeAllRanges();
    return;
  }

  // 近接・重複する矩形をマージ
  const mergedRects = mergeRects(filteredRects, 3);

  // ページ情報（range の先頭コンテナを基準に）
  const pageDiv = range.startContainer?.parentElement?.closest?.(".page");
  const pageNum = pageDiv ? parseInt(pageDiv.dataset.pageNumber) : PDFViewerApplication.pdfViewer.currentPageNumber;
  const pageView = PDFViewerApplication.pdfViewer.getPageView(pageNum - 1);
  const noteLayer = document.getElementById("noteLayer");
  const colorInfo = highlightColors[currentHighlightColor];

  // --- mergedRects 全体を包む1つのハイライト ---
  const left = Math.min(...mergedRects.map(r => r.left));
  const top = Math.min(...mergedRects.map(r => r.top));
  const right = Math.max(...mergedRects.map(r => r.right ?? (r.left + r.width)));
  const bottom = Math.max(...mergedRects.map(r => r.bottom ?? (r.top + r.height)));

  const highlight = document.createElement("div");
  highlight.className = "highlight";
  highlight.dataset.page = pageNum;
  highlight.dataset.color = currentHighlightColor;
  highlight.dataset.id = `hl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  highlight.dataset.text = selectedText;

  // DOM座標 → PDF座標変換
  const pageRect = pageView.div.getBoundingClientRect();
  const domX = left - pageRect.left;
  const domY = top - pageRect.top;
  const [pdfX, pdfY] = pageView.viewport.convertToPdfPoint(domX, domY);
  highlight.dataset.x = pdfX;
  highlight.dataset.y = pdfY;
  highlight.dataset.w = (right - left) / pageView.viewport.scale;
  highlight.dataset.h = (bottom - top) / pageView.viewport.scale;

  // ビューポート座標に配置
  const [viewX, viewY] = pageView.viewport.convertToViewportPoint(pdfX, pdfY);
  highlight.style.position = "absolute";
  highlight.style.left = `${viewX + pageView.div.offsetLeft}px`;
  highlight.style.top = `${viewY + pageView.div.offsetTop}px`;
  highlight.style.width = `${right - left}px`;
  highlight.style.height = `${bottom - top}px`;
  highlight.style.backgroundColor = colorInfo.bg;
  highlight.style.border = `1px solid ${colorInfo.border}`;
  highlight.style.pointerEvents = "auto";
  highlight.style.cursor = "pointer";

  highlight.onclick = ev => {
    ev.stopPropagation();
    toggleHighlightSelection(highlight);
  };

  noteLayer.appendChild(highlight);
  // doOp(OP.create(highlight));
  doOp(OP.create(highlight, $("noteLayer")));
  console.log("undoStack:", undoStack);

  scheduleSave();
  selection.removeAllRanges();
  console.log("🟡 ハイライト追加:", selectedText);

  updateNotePositions();
}

function toggleHighlightSelection(hl) {
  if (selected === hl) {
    select(null);
    hideHighlightColorPalette();
  } else {
    select(hl);
    showHighlightColorPalette(hl, hl);
  }
}

// 2. ハイライトカラーパレット生成と表示（共通化）
// showHighlightColorPalette(base, targetHl = null)，hideHighlightColorPalette()
function showHighlightColorPalette(base, targetHl = null) {
  let palette = $("highlightColorPalette");
  if (!palette) {
    palette = document.createElement("div");
    palette.id = "highlightColorPalette";
    Object.assign(palette.style, {
      position: "absolute",
      display: "flex",
      gap: "6px",
      padding: "6px",
      border: "1px solid #bbb",
      background: "#fff",
      boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
      zIndex: 3000
    });
    document.body.appendChild(palette);
  }

  palette.innerHTML = "";

  Object.keys(highlightColors).forEach(color => {
    const btn = document.createElement("button");
    Object.assign(btn.style, {
      background: highlightColors[color].bg,
      border: `2px solid ${highlightColors[color].border}`,
      width: "24px",
      height: "24px"
    });

    btn.onclick = ev => {
      ev.stopPropagation();

      if (targetHl) {
        // 既存ハイライトの色変更
        const prevColor = targetHl.dataset.color;
        const nextColor = color;
        doOp(OP.updateColor(targetHl, prevColor, nextColor));
        hideHighlightColorPalette();
        saveAllHighlights();
      } else {
        // 新規ハイライト用の色選択
        currentHighlightColor = color;
        console.log("選択色:", color);
        hideHighlightColorPalette();
      }
    };

    palette.appendChild(btn);
  });

  // 既存ハイライト選択時のみ「削除」ボタンを追加
  if (targetHl) {
    const delBtn = document.createElement("button");
    delBtn.textContent = "× 削除";
    delBtn.style.color = "white";
    delBtn.style.background = "red";
    delBtn.style.border = "none";
    delBtn.style.padding = "4px 8px";
    delBtn.style.borderRadius = "4px";

    delBtn.onclick = e => {
      e.stopPropagation(); // パレットが閉じるのを防止

      // Undo対応
      select(null);
      doOp(OP.delete(targetHl, targetHl.parentElement));

      hideHighlightColorPalette();
    };

    palette.appendChild(delBtn);
  }

  const rect = base.getBoundingClientRect();
  palette.style.left = `${rect.left}px`;
  palette.style.top = `${rect.bottom + 6}px`;
  palette.style.display = "flex";

  if (targetHl) {
    const closeOnOutsideClick = e => {
      if (!palette.contains(e.target)) {
        hideNoteColorPalette();
        hideHighlightColorPalette();
        select(null);
        document.removeEventListener("click", closeOnOutsideClick);
      }
    };
    setTimeout(() => document.addEventListener("click", closeOnOutsideClick), 0);
  }
}

function hideHighlightColorPalette() {
  const palette = $("highlightColorPalette");
  if (palette) {
    palette.style.display = "none";
  }
}

// 3.ハイライト保存，復元
// saveAllHighlights()，restoreHighlights()
function saveAllHighlights() {
  const highlights = [];
  document.querySelectorAll(".highlight").forEach(h => {
    const pageNum = parseInt(h.dataset.page);
    const { x, y, w, h: height } = domToPdf(h, pageNum);
    highlights.push({
      id: h.dataset.id,
      page: pageNum,
      color: h.dataset.color,
      x, y, w, h: height,
      text: h.dataset.text || ""
    });
  });
  localStorage.setItem(HIGHLIGHT_KEY, JSON.stringify({ highlights }));

  // if (highlights?.length) {
  //   console.log(`💡 現在のハイライト一覧 (${highlights.length}件):`);
  //   console.table(highlights);
  // }
  saveHighlightsToServer(highlights);
}

function restoreHighlights() {
  const data = localStorage.getItem(HIGHLIGHT_KEY);
  if (!data) return;
  const { highlights } = JSON.parse(data);
  if (!highlights?.length) return;

  const noteLayer = document.getElementById("noteLayer");
  if (!noteLayer) return;

  highlights.forEach(h => {
    const pageView = PDFViewerApplication.pdfViewer.getPageView(h.page - 1);
    if (!pageView) return;
    const vp = pageView.viewport;

    const highlight = document.createElement("div");
    highlight.className = "highlight";
    highlight.dataset.page = h.page;
    highlight.dataset.color = h.color || "yellow";
    highlight.dataset.id = h.id;
    highlight.dataset.x = h.x;
    highlight.dataset.y = h.y;
    highlight.dataset.w = h.w;
    highlight.dataset.h = h.h;
    highlight.dataset.text = h.text || "";

    const [viewX, viewY] = vp.convertToViewportPoint(h.x, h.y);
    highlight.style.position = "absolute";
    highlight.style.left = `${viewX + pageView.div.offsetLeft}px`;
    highlight.style.top = `${viewY + pageView.div.offsetTop}px`;
    highlight.style.width = `${h.w * vp.scale}px`;
    highlight.style.height = `${h.h * vp.scale}px`;

    const colorInfo = highlightColors[h.color] || highlightColors.yellow;
    highlight.style.backgroundColor = colorInfo.bg;
    highlight.style.border = `1px solid ${colorInfo.border}`;
    highlight.style.pointerEvents = "auto";
    highlight.style.cursor = "pointer";

    highlight.onclick = ev => {
      ev.stopPropagation();
      toggleHighlightSelection(highlight);
    };
    noteLayer.appendChild(highlight);
  });

  if (highlights?.length) {
    console.log("🖍️ 復元後のハイライト一覧:");
    console.table(highlights);
  }
  console.log("🟢 ハイライト復元完了:", highlights.length, "件");
}

// 2025/11/18
// /* ---------- 矩形選択のハイライト関連 ---------- */
function createFreeHighlight(rectEl, pageView) {
  const rr = rectEl.getBoundingClientRect();

  // --- tiny（誤作成）ハイライトを防止 ---
  const MIN_SIZE = 10;  // 好きに変えてOK（10px以下は無視）
  if (rr.width < MIN_SIZE || rr.height < MIN_SIZE) {
    console.log("⚠ tiny rect ignored");
    return;
  }

  const layer = document.getElementById("noteLayer");
  const vp = pageView.viewport;
  const pageNum = pageView.id;  // pageView.id = page number

  // rectElの画面座標
  const r = rectEl.getBoundingClientRect();

  // ページの画面座標
  const pageRect = pageView.div.getBoundingClientRect();

  // rectElのページ内ローカル座標
  const domX = r.left - pageRect.left;
  const domY = r.top - pageRect.top;

  // PDF座標に変換
  const [pdfX, pdfY] = vp.convertToPdfPoint(domX, domY);

  // --- ハイライト要素 ---
  const highlight = document.createElement("div");
  highlight.className = "highlight";
  highlight.dataset.page = pageNum;
  highlight.dataset.color = currentHighlightColor;
  highlight.dataset.id = `hl-free-${Date.now()}`;

  highlight.dataset.x = pdfX;
  highlight.dataset.y = pdfY;
  highlight.dataset.w = r.width / vp.scale;
  highlight.dataset.h = r.height / vp.scale;
  highlight.dataset.text = "";

  // --- PDF座標 → viewport座標 ---
  const [viewX, viewY] = vp.convertToViewportPoint(pdfX, pdfY);

  highlight.style.position = "absolute";
  highlight.style.left = `${viewX + pageView.div.offsetLeft}px`;
  highlight.style.top = `${viewY + pageView.div.offsetTop}px`;
  highlight.style.width = `${r.width}px`;
  highlight.style.height = `${r.height}px`;

  const colorInfo = highlightColors[currentHighlightColor];
  highlight.style.backgroundColor = colorInfo.bg;
  highlight.style.border = `1px solid ${colorInfo.border}`;
  highlight.style.cursor = "pointer";

  highlight.onclick = ev => {
    ev.stopPropagation();
    toggleHighlightSelection(highlight);
  };

  layer.appendChild(highlight);
  makeHighlightDraggableAndResizable(highlight, pageView);
  doOp(OP.create(highlight, layer));
  saveAllHighlights();
}

// 矩形選択ハイライトの移動，大きさ変更対応
function makeHighlightDraggableAndResizable(highlight, pageView) {
  const textLayer = pageView.div.querySelector(".textLayer");

  // --- ドラッグ ---
  let startX, startY, startLeft, startTop;
  highlight.onmousedown = e => {
    if (e.button !== 0) return;
    e.stopPropagation();

    if (textLayer) textLayer.style.userSelect = "none";

    startX = e.clientX;
    startY = e.clientY;
    const cs = getComputedStyle(highlight);
    startLeft = parseFloat(cs.left);
    startTop = parseFloat(cs.top);

    document.onmousemove = move;
    document.onmouseup = up;
  };

  function move(e) {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    highlight.style.left = `${startLeft + dx}px`;
    highlight.style.top = `${startTop + dy}px`;
  }

  function up() {
    document.onmousemove = document.onmouseup = null;

    if (textLayer) textLayer.style.userSelect = "";

    // PDF座標に変換してデータ属性更新
    const vp = pageView.viewport;
    const domX = parseFloat(highlight.style.left) - pageView.div.offsetLeft;
    const domY = parseFloat(highlight.style.top) - pageView.div.offsetTop;
    const [pdfX, pdfY] = vp.convertToPdfPoint(domX, domY);
    highlight.dataset.x = pdfX;
    highlight.dataset.y = pdfY;

    doOp(OP.move(
      highlight,
      startLeft,
      startTop,
      parseFloat(highlight.style.left),
      parseFloat(highlight.style.top)
    ));

    saveAllHighlights();
    saveHighlightsToServer();
  }

  // --- リサイズ用ハンドル ---
  const handle = document.createElement("div");
  handle.className = "highlight-resize-handle";
  Object.assign(handle.style, {
    position: "absolute",
    width: "8px",
    height: "8px",
    right: "0px",
    bottom: "0px",
    cursor: "se-resize",
    backgroundColor: "rgba(226, 226, 226, 1)",
    zIndex: 10000
  });
  highlight.appendChild(handle);

  let startWidth, startHeight;
  handle.onmousedown = e => {
    e.stopPropagation();

    if (textLayer) textLayer.style.userSelect = "none";

    startX = e.clientX;
    startY = e.clientY;
    startWidth = parseFloat(getComputedStyle(highlight).width);
    startHeight = parseFloat(getComputedStyle(highlight).height);
    document.onmousemove = resizeMove;
    document.onmouseup = resizeUp;
  };

  function resizeMove(e) {
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    highlight.style.width = `${startWidth + dx}px`;
    highlight.style.height = `${startHeight + dy}px`;
  }

  function resizeUp() {
    document.onmousemove = document.onmouseup = null;

    if (textLayer) textLayer.style.userSelect = "";

    // PDF座標に変換してデータ属性更新
    const vp = pageView.viewport;
    const pageRect = pageView.div.getBoundingClientRect();
    const domX = parseFloat(highlight.style.left) - pageView.div.offsetLeft;
    const domY = parseFloat(highlight.style.top) - pageView.div.offsetTop;
    const [pdfX, pdfY] = vp.convertToPdfPoint(domX, domY);
    highlight.dataset.x = pdfX;
    highlight.dataset.y = pdfY;
    highlight.dataset.w = parseFloat(highlight.style.width) / vp.scale;
    highlight.dataset.h = parseFloat(highlight.style.height) / vp.scale;

    doOp(OP.resize(
      highlight,
      startWidth,
      startHeight,
      parseFloat(highlight.style.width),
      parseFloat(highlight.style.height)
    ));

    saveAllHighlights();
    saveHighlightsToServer();
  }
}

/* ---------- 共通復元，再配置 ---------- */
// updateNotePositions()
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

    if (el.classList.contains("highlight") && el.dataset.text === "" && !el.dataset.draggable) {
      makeHighlightDraggableAndResizable(el, pageView);
      el.dataset.draggable = "true";
    }
  });
}

/* ---------- 初期化，イベント登録 ---------- */
// initFull()，document.addEventListener("mouseup", …)
function initFull() {
  const vc = $("viewerContainer");
  const noteBtn = $("addNoteButton");
  const highlightBtn = $("addHighlightButton");
  const freeHighlightBtn = $("addFreeHighlightButton");

  // --- モードリセット関数 ---
  function resetModes(except = "") {
    if (except !== "note") {
      textMode = false;
      noteBtn.classList.remove("toggled");
    }
    if (except !== "highlight") {
      highlightMode = false;
      highlightBtn.classList.remove("toggled");
      hideHighlightColorPalette();
    }
    if (except !== "free") {
      freeHighlightMode = false;
      freeHighlightBtn.classList.remove("toggled");
    }
  }

  // --- ノートボタン ---
  noteBtn.onclick = () => {
    hideNoteColorPalette();
    hideHighlightColorPalette();

    resetModes("note");

    textMode = !textMode;
    noteBtn.classList.toggle("toggled", textMode);
    vc.style.cursor = textMode ? "crosshair" : "default";
  };

  // --- ハイライトボタン ---
  highlightBtn.onclick = () => {
    hideNoteColorPalette();

    resetModes("highlight");

    highlightMode = !highlightMode;
    highlightBtn.classList.toggle("toggled", highlightMode);
    vc.style.cursor = highlightMode ? "text" : "default";

    if (highlightMode) showHighlightColorPalette(highlightBtn);
  };

  // --- フリーハイライトボタン ---
  freeHighlightBtn.onclick = (ev) => {
    hideNoteColorPalette();
    hideHighlightColorPalette();

    resetModes("free");

    freeHighlightMode = !freeHighlightMode;
    freeHighlightBtn.classList.toggle("toggled", freeHighlightMode);

    vc.style.cursor = freeHighlightMode ? "crosshair" : "default";

    if (freeHighlightMode) showHighlightColorPalette(ev.target, null);
  };

  // --- ページクリック処理 ---
  vc.addEventListener("click", e => {
    hideNoteColorPalette();
    hideHighlightColorPalette();

    if (e.target.closest(".noteColorPalette, .highlightColorPalette")) return;
    if (e.target.classList.contains("note-resize-handle")) return;

    if (textMode && !linkingNote && !e.target.closest(".note")) {
      addNote(e);
    } else if (!highlightMode) {
      select(null);
    }
  }, true);

  // --- 矩形選択（フリーハイライト用） ---
  vc.addEventListener("mousedown", e => {
    if (!freeHighlightMode || e.button !== 0) return;

    const textLayer = vc.querySelector(".textLayer");
    if (textLayer) textLayer.style.userSelect = "none";

    let targetPage = null;
    for (const p of document.querySelectorAll(".page")) {
      const pr = p.getBoundingClientRect();
      if (e.clientY >= pr.top && e.clientY <= pr.bottom) {
        targetPage = p;
        break;
      }
    }
    if (!targetPage) return;

    const pageNum = parseInt(targetPage.dataset.pageNumber);
    selectedPageView = PDFViewerApplication.pdfViewer.getPageView(pageNum - 1);
    const pageRect = selectedPageView.div.getBoundingClientRect();

    freeRectStart = { x: e.clientX - pageRect.left, y: e.clientY - pageRect.top };
    freeRect = document.createElement("div");
    Object.assign(freeRect.style, {
      position: "absolute",
      left: freeRectStart.x + "px",
      top: freeRectStart.y + "px",
      width: "0px",
      height: "0px",
      border: "1px dashed #00f",
      background: "rgba(0,0,255,0.15)",
      zIndex: 9999
    });
    selectedPageView.div.appendChild(freeRect);

    document.onmousemove = ev => {
      if (!freeRect) return;
      const pr = selectedPageView.div.getBoundingClientRect();
      const localX = ev.clientX - pr.left;
      const localY = ev.clientY - pr.top;
      const w = localX - freeRectStart.x;
      const h = localY - freeRectStart.y;
      freeRect.style.width = Math.abs(w) + "px";
      freeRect.style.height = Math.abs(h) + "px";
      freeRect.style.left = (w < 0 ? localX : freeRectStart.x) + "px";
      freeRect.style.top = (h < 0 ? localY : freeRectStart.y) + "px";
    };

    document.onmouseup = () => {
      document.onmousemove = document.onmouseup = null;
      if (textLayer) textLayer.style.userSelect = "";
      if (!freeRect) return;
      createFreeHighlight(freeRect, selectedPageView);
      freeRect.remove();
      freeRect = null;
    };
  });

  // --- キー操作、削除、Undo/Redo ---
  document.addEventListener("keydown", e => {
    const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();

    if (e.key === "Delete" && selected) {
      if (selected.classList.contains("note")) {
        doOp(OP.delete(selected, selected.parentElement));
        select(null);
        const palette = document.getElementById("noteTextStylePalette");
        if (palette) palette.remove();
        saveAllNotes();
      } else if (selected.classList.contains("highlight")) {
        doOp(OP.delete(selected, selected.parentElement));
        select(null);
        saveAllHighlights();
        hideNoteColorPalette();
        hideHighlightColorPalette();
      }
    }

    if (ctrl && k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    if (ctrl && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); redo(); }

    if (ctrl && e.key.toLowerCase() === "f") {
      e.preventDefault();
      e.stopPropagation();
      openSearchPanel();
    }
  });

  // --- その他初期化処理 ---
  const bubbleBtn = $("bubbleButton");
  if (bubbleBtn) bubbleBtn.onclick = toggleBubbleMode;

  if (vc) {
    vc.addEventListener("scroll", () => {
      hideNoteColorPalette();
      hideHighlightColorPalette();
    });
  }

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

  PDFViewerApplication.eventBus.on("scalechanging", updateNotePositions);
  PDFViewerApplication.eventBus.on("scalechanged", updateNotePositions);
  PDFViewerApplication.eventBus.on("pagerendered", () => setTimeout(updateNotePositions, 10));
  window.addEventListener("resize", updateNotePositions);

  createDeleteButton();
  window.addEventListener("beforeunload", () => {
    document.querySelectorAll(".note").forEach(note => {
      commit(note);
      saveNotesToServer();
    });
  });
}

/* ---------- PDF.js イベント連携 ---------- */
PDFViewerApplication.eventBus.on("sidebarviewchanged", () => {
  updateNotePositions();
  setTimeout(updateNotePositions, 100);
});

const viewerContainer = document.getElementById("viewerContainer");
if (viewerContainer) {
  new ResizeObserver(() => updateNotePositions()).observe(viewerContainer);
}

/* ---------- ハイライト選択範囲確認 & ノート紐付け ---------- */
document.addEventListener("mouseup", () => {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();

  // ハイライト処理
  if (highlightMode && selectedText) {
    console.log("選択範囲を確認:", selectedText);
    addHighlightFromSelection();
  }

  // ノート紐付け処理
  if (linkingNote && selectedText) {
    // 紐付けモードを終了するタイミング
    textMode = false;
    highlightMode = false;

    // 紐付けテキストを保存
    linkingNote.dataset.linkedText = selectedText;
    console.log("ノートに紐付け:", selectedText);
    showLinkStatus("紐付け終了");

    linkingNote = null;

    // マウスカーソルを戻す
    const vc = $("viewerContainer");
    if (vc) vc.style.cursor = "default";

    // ハイライト操作を再び有効化
    setHighlightSelectable(false);

    // 選択解除 & 保存
    selection.removeAllRanges();
    saveAllNotes();
  }
});

/* ---------- 紐付けモード制御 ---------- */
function setHighlightSelectable(selectable) {
  const highlights = document.querySelectorAll(".highlight");
  highlights.forEach(h => {
    // 紐付けモード中だけ透過させる（PDF下のテキストを選択できるように）
    h.style.pointerEvents = selectable ? "none" : "auto";
  });
}

/* ---------- テキストボックス・ハイライト情報表示ボタン ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("showButton");
  if (!btn) return;

  btn.addEventListener("click", showSidebar);
});

function showSidebar() {
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

/* ---------- 一括削除ボタン ---------- */
function createDeleteButton() {
  const btn = document.getElementById("deleteButton");
  if (!btn) return;

  btn.onclick = () => {
    if (!confirm("すべてのテキストボックスとハイライトを削除します。\n削除後は元に戻せません。よろしいですか？")) return;

    const notes = [...document.querySelectorAll(".note")];
    const highlights = [...document.querySelectorAll(".highlight")];

    notes.forEach(note => {
      doOp(OP.delete(note, note.parentElement));
      note.remove();
    });

    highlights.forEach(hl => {
      doOp(OP.delete(hl, hl.parentElement));
      hl.remove();
    });

    select(null);

    scheduleSave();
  };
}

/* ---------- 吹き出しボタン関連 ---------- */
// toggleBubbleMode(), updateBubbleMode()
function toggleBubbleMode() {
  const noteLayer = $("noteLayer");
  if (!noteLayer) return;

  const isBubbleMode = noteLayer.dataset.bubbleMode === "true";
  noteLayer.dataset.bubbleMode = (!isBubbleMode).toString();

  localStorage.setItem('bubbleMode', (!isBubbleMode).toString());

  document.querySelectorAll(".note-bubble").forEach(b => b.remove());
  document.querySelectorAll(".note").forEach(n => {
    n.style.display = "block";
    n.dataset.bubbleAttached = "false";
  });

  if (!isBubbleMode) {
    const noteBtn = $("addNoteButton");
    const highlightBtn = $("addHighlightButton");

    textMode = false;
    noteBtn.classList.remove("toggled");

    highlightMode = false;
    if (highlightBtn) highlightBtn.classList.remove("toggled");

    document.querySelectorAll(".note").forEach(note => {
      if (note.dataset.bubbleAttached === "true") return;

      const bubble = document.createElement("div");
      bubble.className = "note-bubble";
      bubble.textContent = "💬";
      bubble.style.position = "absolute";
      bubble.style.fontSize = "22px";
      bubble.style.cursor = "pointer";
      bubble.dataset.noteId = note.dataset.id;

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
      }

      bubble.onclick = () => {
        note.style.display = "block";
        note.focus();
        bubble.remove();
        note.dataset.bubbleAttached = "false";
      };

      noteLayer.appendChild(bubble);
      note.style.display = "none";
      note.dataset.bubbleAttached = "true";
    });

    requestAnimationFrame(updateBubblePositions);
    setTimeout(updateBubblePositions, 200);
  }
}

function updateBubblePositions() {
  const layer = $("noteLayer");
  if (!layer) return;

  document.querySelectorAll(".note-bubble").forEach(bubble => {
    const noteId = bubble.dataset.noteId;
    const note = document.querySelector(`.note[data-id="${noteId}"]`);
    if (!note) return;

    const page = parseInt(note.dataset.page);
    const pageView = PDFViewerApplication.pdfViewer.getPageView(page - 1);
    if (!pageView) return;

    const vp = pageView.viewport;
    const [viewX, viewY] = vp.convertToViewportPoint(
      parseFloat(note.dataset.x),
      parseFloat(note.dataset.y)
    );

    bubble.style.left = `${viewX - 28 + pageView.div.offsetLeft}px`;
    bubble.style.top = `${viewY + pageView.div.offsetTop}px`;
  });
}

// 💬イベント処理
window.addEventListener("resize", updateBubblePositions);
PDFViewerApplication.eventBus.on("scalechanging", updateBubblePositions);
PDFViewerApplication.eventBus.on("scalechanged", updateBubblePositions);

// 💬サイドバー対応
PDFViewerApplication.eventBus.on("sidebarviewchanged", () => {
  updateBubblePositions();
  setTimeout(updateBubblePositions, 100);
});

if (viewerContainer) {
  new ResizeObserver(() => updateBubblePositions()).observe(viewerContainer);
}

PDFViewerApplication.eventBus.on("pagerendered", () => {
  const noteLayer = $("noteLayer");
  if (noteLayer.dataset.bubbleMode === "true") {
    updateBubblePositions();
  }
});

/* ---------- メッセージ表示するための関数 ---------- */
// showLinkStatus(text)
function showLinkStatus(text) {
  let label = $("linkStatusLabel");
  if (!label) {
    label = document.createElement("div");
    label.id = "linkStatusLabel";
    document.body.appendChild(label);
    label.style.position = "fixed";
    label.style.top = "10px";
    label.style.left = "50%";
    label.style.transform = "translateX(-50%)";
    label.style.padding = "8px 16px";
    label.style.background = "rgba(0,0,0,0.7)";
    label.style.color = "#fff";
    label.style.borderRadius = "4px";
    label.style.fontSize = "16px";
    label.style.zIndex = 9999;
    label.style.pointerEvents = "none";
    label.style.transition = "opacity 0.3s";
  }
  label.textContent = text;
  label.style.opacity = "1";

  setTimeout(() => {
    label.style.opacity = "0";
  }, 2500);
}

// 2025/11/12
/* ---------- 検索機能 ---------- */
document.getElementById("findButton").addEventListener("click", () => {
  openSearchPanel();
});

function openSearchPanel() {
  let popup = document.getElementById("searchPopup");
  if (popup) {
    popup.remove();
    return;
  }

  popup = document.createElement("div");
  popup.id = "searchPopup";
  popup.style.position = "fixed";
  popup.style.top = "50px";
  popup.style.right = "50px";
  popup.style.width = "350px";
  popup.style.maxHeight = "500px";
  popup.style.background = "#fff";
  popup.style.border = "1px solid #ccc";
  popup.style.boxShadow = "0 2px 10px rgba(0,0,0,0.3)";
  popup.style.zIndex = "10000";
  popup.style.padding = "10px";
  popup.style.overflow = "auto";
  popup.style.fontSize = "14px";

  // 閉じるボタン
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "×";
  closeBtn.style.position = "absolute";
  closeBtn.style.top = "4px";
  closeBtn.style.right = "4px";
  closeBtn.style.border = "none";
  closeBtn.style.background = "transparent";
  closeBtn.style.cursor = "pointer";
  closeBtn.style.fontSize = "16px";
  closeBtn.onclick = () => popup.remove();
  popup.appendChild(closeBtn);

  // 検索入力 + ボタン用コンテナ
  const inputContainer = document.createElement("div");
  inputContainer.style.display = "flex";
  inputContainer.style.alignItems = "center";
  inputContainer.style.marginTop = "24px";
  inputContainer.style.marginBottom = "8px";

  // 検索入力
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "検索...";
  input.style.flex = "1"; // 横幅いっぱいに広げる
  input.style.padding = "4px";
  inputContainer.appendChild(input);

  // 検索ボタン
  const searchBtn = document.createElement("button");
  searchBtn.textContent = "検索";
  searchBtn.style.marginLeft = "8px";
  searchBtn.style.padding = "4px 8px";
  searchBtn.style.cursor = "pointer";
  searchBtn.onclick = () => performSearch(input.value, results);
  inputContainer.appendChild(searchBtn);

  // popup にコンテナを追加
  popup.appendChild(inputContainer);

  // 検索対象チェックボックス
  const checkContainer = document.createElement("div");
  checkContainer.style.marginBottom = "8px";

  const targets = [
    { label: "PDF本文", id: "searchPDF", checked: true },
    { label: "テキストボックス", id: "searchNotes", checked: true },
    { label: "ハイライト", id: "searchHighlights", checked: true },
  ];

  targets.forEach(t => {
    const label = document.createElement("label");
    label.style.marginRight = "10px";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.id = t.id;
    cb.checked = t.checked;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(" " + t.label));
    checkContainer.appendChild(label);

    // change イベント追加
    cb.addEventListener("change", () => {
      performSearch(input.value, results);
    });
  });

  popup.appendChild(checkContainer);

  // 結果表示
  const results = document.createElement("div");
  results.id = "searchResults";
  results.style.maxHeight = "400px";
  results.style.overflowY = "auto";
  results.style.borderTop = "1px solid #ccc";
  results.style.paddingTop = "4px";
  popup.appendChild(results);

  document.body.appendChild(popup);

  input.addEventListener("input", () => performSearch(input.value, results));
  input.focus();
}

async function performSearch(keyword, results) {
  results.innerHTML = "";
  if (!keyword) return;
  const lowerKeyword = keyword.toLowerCase();

  const searchPDF = document.getElementById("searchPDF").checked;
  const searchNotes = document.getElementById("searchNotes").checked;
  const searchHighlights = document.getElementById("searchHighlights").checked;

  // テキストボックス検索
  if (searchNotes) {
    document.querySelectorAll(".note").forEach(note => {
      const text = note.textContent || "";
      if (text.toLowerCase().includes(lowerKeyword)) {
        const div = document.createElement("div");
        div.textContent = `[テキストボックス] ${text}`;
        div.style.cursor = "pointer";
        div.style.padding = "2px 4px";
        div.onclick = () => scrollTotext(note);
        results.appendChild(div);
      }
    });
  }

  // ハイライト検索
  if (searchHighlights) {
    document.querySelectorAll(".highlight").forEach(hl => {
      const text = hl.dataset.text || "";
      if (text.toLowerCase().includes(lowerKeyword)) {
        const div = document.createElement("div");
        div.textContent = `[ハイライト] ${text}`;
        div.style.cursor = "pointer";
        div.style.padding = "2px 4px";
        div.onclick = () => scrollToHighlight(hl);
        results.appendChild(div);
      }
    });
  }

  // PDF本文検索
  if (searchPDF) {
    const pdf = PDFViewerApplication.pdfDocument;
    if (!pdf) return;
    const numPages = pdf.numPages;

    for (let i = 1; i <= numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map(item => item.str).join(" ");
      if (text.toLowerCase().includes(lowerKeyword)) {
        const div = document.createElement("div");
        div.textContent = `[PDF ${i}ページ] ...${text.slice(0, 100)}...`;
        div.style.cursor = "pointer";
        div.style.padding = "2px 4px";
        div.onclick = () => scrollToPage(i);
        results.appendChild(div);
      }
    }
  }
}

// テキストボックスにジャンプ
function scrollTotext(note) {
  const pageNum = parseInt(note.dataset.page) - 1;
  const pageView = PDFViewerApplication.pdfViewer.getPageView(pageNum);
  if (!pageView) return;
  const vp = pageView.viewport;
  const [viewX, viewY] = vp.convertToViewportPoint(note.dataset.x, note.dataset.y);
  document.getElementById("viewerContainer").scrollTop =
    pageView.div.offsetTop + viewY;
}

// ハイライトにジャンプ
function scrollToHighlight(hl) {
  const pageNum = parseInt(hl.dataset.page) - 1;
  const pageView = PDFViewerApplication.pdfViewer.getPageView(pageNum);
  if (!pageView) return;
  const vp = pageView.viewport;
  const [viewX, viewY] = vp.convertToViewportPoint(hl.dataset.x, hl.dataset.y);
  document.getElementById("viewerContainer").scrollTop =
    pageView.div.offsetTop + viewY;
}

// PDFページにジャンプ
function scrollToPage(pageNum) {
  const pageView = PDFViewerApplication.pdfViewer.getPageView(pageNum - 1);
  if (!pageView) return;
  document.getElementById("viewerContainer").scrollTop = pageView.div.offsetTop;
}

/* ---------- サーバ保存，復元処理 ---------- */
// saveNotesToServer(), saveHighlightsToServer(), saveAllToServer()
// restoreNotesFromData(notes), restoreHighlightsFromData(highlights)
// loadNotesFromServer(), loadHighlightsFromServer(), loadAllFromServer()

// サーバーにテキストボックス保存
function saveNotesToServer() {
  const notes = Array.from(document.querySelectorAll(".note")).map(note => ({
    id: note.dataset.id,
    page: parseInt(note.dataset.page),
    x: parseFloat(note.dataset.x),
    y: parseFloat(note.dataset.y),
    w: parseFloat(note.style.width),
    h: parseFloat(note.style.height),
    text: note.textContent,
    bubbleAttached: note.dataset.bubbleAttached === "true",
    fontSize: note.dataset.fontSize || "14",
    color: note.dataset.color || "black",
    linkedText: note.dataset.linkedText || ""
  }));

  fetch("http://localhost:3000/notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes })
  })
    .then(res => res.json())
    .then(data => console.log("📝 テキストボックスの情報をサーバーに保存:", data))
    .catch(err => console.error("テキストボックス保存エラー:", err));
}

// サーバーにハイライト保存
function saveHighlightsToServer() {
  const highlights = Array.from(document.querySelectorAll(".highlight")).map(h => ({
    id: h.dataset.id,
    page: parseInt(h.dataset.page),
    x: parseFloat(h.dataset.x),
    y: parseFloat(h.dataset.y),
    w: parseFloat(h.dataset.w),
    h: parseFloat(h.dataset.h),
    text: h.dataset.text || "",
    color: h.dataset.color || "yellow"
  }));

  fetch("http://localhost:3000/highlights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ highlights })
  })
    .then(res => res.json())
    .then(data => console.log("🖍️ ハイライトの情報をサーバーに保存:", data))
    .catch(err => console.error("ハイライト保存エラー:", err));
}

// まとめて保存
function saveAllToServer() {
  saveNotesToServer();
  saveHighlightsToServer();
}

// ボタンから直接保存
document.getElementById("saveAnnotationButton").addEventListener("click", () => {
  saveAllToServer();
  showLinkStatus("ローカルホストに保存しました");
});

// テキストボックス復元関数
function restoreNotesFromData(notes) {
  const noteLayer = document.getElementById("noteLayer");
  if (!noteLayer) return;

  // 既存テキストボックスをクリア
  noteLayer.innerHTML = "";

  notes.forEach(n => {
    const note = document.createElement("div");
    note.className = "note";
    note.contentEditable = "true";
    note.textContent = n.text;

    // dataset に linkedText などをコピー
    Object.assign(note.dataset, n);

    note.style.color = n.color || "black";
    note.style.fontSize = (n.fontSize || "14") + "px";
    note.style.width = n.w + "px";
    note.style.height = n.h + "px";

    // ページ対応と座標変換
    const pageView = PDFViewerApplication.pdfViewer.getPageView(n.page - 1);
    if (pageView) {
      const viewport = pageView.viewport;
      const [x, y] = viewport.convertToViewportPoint(n.x, n.y);
      note.style.left = x + "px";
      note.style.top = (y - n.h) + "px"; // PDFの原点が左下
    }

    // イベントやドラッグ・リサイズは既存関数をそのまま
    note.onclick = e => { e.stopPropagation(); select(note); showNoteTextStylePalette(note); };
    note.onfocus = () => { note.dataset.editing = "true"; note.dataset.origText = note.textContent; };
    note.onblur = () => commit(note);

    note.addEventListener("input", () => {
      note.dataset.origText = note.textContent;
      saveAllNotes();
    });

    enableDrag(note);
    enableResize(note);
    noteLayer.appendChild(note);
  });

  // ローカルストレージに自動保存
  localStorage.setItem(TEXT_KEY, JSON.stringify({ notes }));
  updateNotePositions();

  if (notes?.length) {
    console.log("📝 復元後のテキストボックス一覧:");
    console.table(notes);
  }
}

// --- ハイライト復元 ---
function restoreHighlightsFromData(highlights) {
  if (!highlights?.length) return;
  const noteLayer = document.getElementById("noteLayer");
  if (!noteLayer) return;

  // 既存のハイライトをクリア
  noteLayer.querySelectorAll(".highlight").forEach(h => h.remove());

  highlights.forEach(h => {
    const pageView = PDFViewerApplication.pdfViewer.getPageView(h.page - 1);
    if (!pageView) return;

    const vp = pageView.viewport;

    const highlight = document.createElement("div");
    highlight.className = "highlight";
    highlight.dataset.page = h.page;
    highlight.dataset.color = h.color || "yellow";
    highlight.dataset.id = h.id;
    highlight.dataset.x = h.x;
    highlight.dataset.y = h.y;
    highlight.dataset.w = h.w;
    highlight.dataset.h = h.h;
    highlight.dataset.text = h.text || "";

    // PDF座標 → 表示座標に変換
    const [viewX, viewY] = vp.convertToViewportPoint(h.x, h.y);

    highlight.style.position = "absolute";
    highlight.style.left = `${viewX + pageView.div.offsetLeft}px`;
    highlight.style.top = `${viewY + pageView.div.offsetTop}px`;
    highlight.style.width = `${h.w * vp.scale}px`;
    highlight.style.height = `${h.h * vp.scale}px`;

    // 色・枠線・操作設定
    const colorInfo = highlightColors[h.color] || highlightColors.yellow;
    highlight.style.backgroundColor = colorInfo.bg;
    highlight.style.border = `1px solid ${colorInfo.border}`;
    highlight.style.pointerEvents = "auto";
    highlight.style.cursor = "pointer";

    highlight.onclick = ev => {
      ev.stopPropagation();
      toggleHighlightSelection(highlight);
    };

    noteLayer.appendChild(highlight);
  });

  // ローカルストレージに自動保存
  localStorage.setItem(HIGHLIGHT_KEY, JSON.stringify({ highlights }));

  console.log("🖍️ 復元後のハイライト一覧:");
  console.table(highlights);
  console.log("🟢 ハイライト復元完了:", highlights.length, "件");
}

// サーバーからテキストボックスを取得して復元
function loadNotesFromServer() {
  fetch("http://localhost:3000/notes")
    .then(res => res.json())
    .then(data => {
      if (!Array.isArray(data)) return;
      restoreNotesFromData(data);
      console.log("📝 テキストボックスをサーバーから復元しました:", data.length, "件");
    })
    .catch(err => console.error("テキストボックス取得エラー:", err));
}

// サーバーからハイライトを取得して復元
function loadHighlightsFromServer() {
  fetch("http://localhost:3000/highlights")
    .then(res => res.json())
    .then(data => {
      if (!Array.isArray(data)) return;
      restoreHighlightsFromData(data);
      console.log("🖍️ ハイライトをサーバーから復元しました:", data.length, "件");
    })
    .catch(err => console.error("ハイライト取得エラー:", err));
}

// まとめて復元
function loadAllFromServer() {
  loadNotesFromServer();
  loadHighlightsFromServer();
}

// ボタンから復元する場合
document.getElementById("loadAnnotationButton").addEventListener("click", () => {
  loadAllFromServer();
  showLinkStatus("ローカルホストから復元しました");
});

/* ---------- 起動 ---------- */
(PDFViewerApplication?.initializedPromise
  ?? new Promise(r =>
    window.addEventListener("webviewerloaded", r, { once: true })
  )
)
  .then(() => {
    initFull();
    PDFViewerApplication.eventBus.on("pagesloaded", () => {
      // ローカルストレージから復元
      // restoreNotes();
      // restoreHighlights();

      // 2025/11/11 注釈をサーバーから復元
      loadAllFromServer();
    });
  });