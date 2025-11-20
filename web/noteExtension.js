/* ========================================================
   noteExtension.js – PDF.js (v5.3.31) ノート拡張
   Robust Undo / Redo：create, move, delete, update
   ======================================================== */

import {
  saveNotesToServer,
  saveAllToServer,
  loadAllFromServer
} from './serverStorage.js';

import {
  openSearchPanel
} from './searchManager.js';

import {
  showSidebar
} from './sidebarManager.js';

import {
  toggleBubbleMode,
  updateBubblePositions
} from './noteBubble.js';

import {
  addHighlightFromSelection,
  showHighlightColorPalette,
  hideHighlightColorPalette,
  saveAllHighlights,
  createFreeHighlight,
  makeHighlightDraggableAndResizable
} from './highlightMode.js';

import {
  addNote,
  commit,
  saveAllNotes,
  hideNoteColorPalette,
} from './noteMode.js';

/* ---------- グローバル設定 ---------- */
// モードや Undo/Redo ，ローカルストレージ保存関連
// noteExtension.js
export const state = {
  textMode: false,
  highlightMode: false,

  // 2025/11/18
  freeHighlightMode: false,
  freerect: null,
  freerectStare: null,
  selectedPageView: null,

  selected: null,
  undoStack: [],
  redoStack: [],
  linkingNote: null
};

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
  state.undoStack.push(invert(op));
  state.redoStack.length = 0;
  scheduleSave();
  if (op.note?.classList.contains("highlight")) saveAllHighlights();
}

// 元に戻す ＆ やり直す
function undo() {
  const op = state.undoStack.pop();
  if (!op) return;
  console.log("undo op:", op);
  exec(op);
  state.redoStack.push(invert(op));
  scheduleSave();
}

function redo() {
  const op = state.redoStack.pop();
  if (!op) return;
  console.log("redo op:", op);
  exec(op);
  state.undoStack.push(invert(op));
  scheduleSave();
}

/* ---------- 選択処理 ---------- */
function select(n) {
  if (state.selected) {
    if (state.selected.classList.contains("highlight")) {
      const colorName = state.selected.dataset.color || "yellow";
      const c = highlightColors[colorName] || highlightColors.yellow;
      state.selected.style.border = `2px solid ${c.border}`;
      state.selected.style.backgroundColor = c.bg;
    }
    if (state.selected.classList.contains("note")) {
      state.selected.classList.remove("selected");
    }
  }
  state.selected = n;

  if (state.selected) {
    if (state.selected.classList.contains("highlight")) {
      state.selected.style.border = "2px solid rgba(0, 0, 255, 1)";
      state.selected.style.backgroundColor = "rgba(0, 0, 255, 0.22)";
    }
    if (state.selected.classList.contains("note")) {
      state.selected.classList.add("selected");
    }
  }
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
      state.textMode = false;
      noteBtn.classList.remove("toggled");
    }
    if (except !== "highlight") {
      state.highlightMode = false;
      highlightBtn.classList.remove("toggled");
      hideHighlightColorPalette();
    }
    if (except !== "free") {
      state.freeHighlightMode = false;
      freeHighlightBtn.classList.remove("toggled");
    }
  }

  // --- ノートボタン ---
  noteBtn.onclick = () => {
    hideNoteColorPalette();
    hideHighlightColorPalette();

    resetModes("note");

    state.textMode = !state.textMode;
    noteBtn.classList.toggle("toggled", state.textMode);
    vc.style.cursor = state.textMode ? "crosshair" : "default";
  };

  // --- ハイライトボタン ---
  highlightBtn.onclick = () => {
    hideNoteColorPalette();

    resetModes("highlight");

    state.highlightMode = !state.highlightMode;
    highlightBtn.classList.toggle("toggled", state.highlightMode);
    vc.style.cursor = state.highlightMode ? "text" : "default";

    if (state.highlightMode) showHighlightColorPalette(highlightBtn);
  };

  // --- フリーハイライトボタン ---
  freeHighlightBtn.onclick = (ev) => {
    hideNoteColorPalette();
    hideHighlightColorPalette();

    resetModes("free");

    state.freeHighlightMode = !state.freeHighlightMode;
    freeHighlightBtn.classList.toggle("toggled", state.freeHighlightMode);

    vc.style.cursor = state.freeHighlightMode ? "crosshair" : "default";

    if (state.freeHighlightMode) showHighlightColorPalette(ev.target, null);
  };

  // --- ページクリック処理 ---
  vc.addEventListener("click", e => {
    hideNoteColorPalette();
    hideHighlightColorPalette();

    if (e.target.closest(".noteColorPalette, .highlightColorPalette")) return;
    if (e.target.classList.contains("note-resize-handle")) return;

    if (state.textMode && !state.linkingNote && !e.target.closest(".note")) {
      addNote(e);
    } else if (!state.highlightMode) {
      select(null);
    }
  }, true);

  // --- 矩形選択（フリーハイライト用） ---
  vc.addEventListener("mousedown", e => {
    if (!state.freeHighlightMode || e.button !== 0) return;

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
    state.selectedPageView = PDFViewerApplication.pdfViewer.getPageView(pageNum - 1);
    const pageRect = state.selectedPageView.div.getBoundingClientRect();

    state.freerectStare = { x: e.clientX - pageRect.left, y: e.clientY - pageRect.top };
    state.freerect = document.createElement("div");
    Object.assign(state.freerect.style, {
      position: "absolute",
      left: state.freerectStare.x + "px",
      top: state.freerectStare.y + "px",
      width: "0px",
      height: "0px",
      border: "1px dashed #00f",
      background: "rgba(0,0,255,0.15)",
      zIndex: 9999
    });
    state.selectedPageView.div.appendChild(state.freerect);

    document.onmousemove = ev => {
      if (!state.freerect) return;
      const pr = state.selectedPageView.div.getBoundingClientRect();
      const localX = ev.clientX - pr.left;
      const localY = ev.clientY - pr.top;
      const w = localX - state.freerectStare.x;
      const h = localY - state.freerectStare.y;
      state.freerect.style.width = Math.abs(w) + "px";
      state.freerect.style.height = Math.abs(h) + "px";
      state.freerect.style.left = (w < 0 ? localX : state.freerectStare.x) + "px";
      state.freerect.style.top = (h < 0 ? localY : state.freerectStare.y) + "px";
    };

    document.onmouseup = () => {
      document.onmousemove = document.onmouseup = null;
      if (textLayer) textLayer.style.userSelect = "";
      if (!state.freerect) return;
      createFreeHighlight(state.freerect, state.selectedPageView);
      state.freerect.remove();
      state.freerect = null;
    };
  });

  // --- キー操作、削除、Undo/Redo ---
  document.addEventListener("keydown", e => {
    const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();

    if (e.key === "Delete" && state.selected) {
      if (state.selected.classList.contains("note")) {
        doOp(OP.delete(state.selected, state.selected.parentElement));
        select(null);
        const palette = document.getElementById("noteTextStylePalette");
        if (palette) palette.remove();
        saveAllNotes();
      } else if (state.selected.classList.contains("highlight")) {
        doOp(OP.delete(state.selected, state.selected.parentElement));
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

/* ---------- ハイライト選択範囲確認 & ノート紐付け ---------- */
document.addEventListener("mouseup", () => {
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();

  // ハイライト処理
  if (state.highlightMode && selectedText) {
    console.log("選択範囲を確認:", selectedText);
    addHighlightFromSelection();
  }

  // ノート紐付け処理
  if (state.linkingNote && selectedText) {
    // 紐付けモードを終了するタイミング
    // 紐付けテキストを保存
    state.linkingNote.dataset.linkedText = selectedText;
    console.log("ノートに紐付け:", selectedText);
    showLinkStatus("紐付け終了");

    state.linkingNote = null;

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

// /* ---------- テキストボックス・ハイライト情報表示ボタン ---------- */
document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("showButton");
  if (!btn) return;

  btn.addEventListener("click", showSidebar);
});

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

// /* ---------- 吹き出しボタン関連 ---------- */
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

// /* ---------- 検索機能起動 ---------- */
document.getElementById("findButton").addEventListener("click", () => {
  openSearchPanel();
});

export {
  HANDLE,

  // PDF・ローカルストレージ関連
  pdfId,
  TEXT_KEY,
  HIGHLIGHT_KEY,

  // 色関連
  highlightColors,

  // ヘルパー関数
  $,
  domToPdf,
  mergeRects,
  scheduleSave,

  // Undo/Redo 操作
  OP,
  exec,
  invert,
  doOp,
  undo,
  redo,

  // 選択処理
  select,

  // ノート操作
  updateNotePositions,
  setHighlightSelectable,
  showLinkStatus
};

/* ---------- 起動 ---------- */
(PDFViewerApplication?.initializedPromise
  ?? new Promise(r =>
    window.addEventListener("webviewerloaded", r, { once: true })
  )
)
  .then(() => {
    initFull();
    PDFViewerApplication.eventBus.on("pagesloaded", () => {
      loadAllFromServer();
    });
  });