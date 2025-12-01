/* ========================================================
   noteExtension.js – PDF.js (v5.3.31) ノート拡張
   Robust Undo / Redo：create, move, delete, update
   ======================================================== */

import { saveNotesToServer, loadAllFromServer } from './serverStorage.js';
import { openSearchPanel } from './searchManager.js';
import { showSidebar } from './sidebarManager.js';
import { toggleBubbleMode, updateBubblePositions } from './noteBubble.js';
import { addHighlight, showHighlightColorPalette, hideHighlightColorPalette, saveAllHighlights, createFreeHighlight } from './highlightMode.js';
// ⭐️【修正】noteMode.js から必要な関数をインポート
import { addNote, commit, saveAllNotes as saveAllNotesToMode, hideNoteColorPalette, updateLinkLine, removeLinkSVG } from './noteMode.js';
import { updateNotePositions, createDeleteButton, showLinkStatus } from './annotationManager.js';
import { OP, doOp, undo, redo } from './undoRedoManager.js';
import { freehandMode } from './freehandMode.js';
import { setupTopicViewButton } from './topicView.js';

/* ---------- グローバル設定 ---------- */
// モードや Undo/Redo ，ローカルストレージ保存関連
export const state = {
  textMode: false,
  highlightMode: false,
  freeHighlightMode: false,
  freehandMode: false,
  freerect: null,
  freerectStare: null,
  selectedPageView: null,

  selected: null,
  undoStack: [],
  redoStack: [],
  linkingNote: null,
  // ⭐️【追加】紐付け中の線の管理 ⭐️
  linkSVG: null,       
  linkStartNote: null
};

export const HANDLE = 12;
export const pdfId = PDFViewerApplication?.url?.split("/").pop() ?? "untitled.pdf";
export const TEXT_KEY = `notes::${pdfId}`;
export const HIGHLIGHT_KEY = `highlights::${pdfId}`;
export const FREEHAND_KEY = `freehands::${pdfId}`;

/* ---------- 色定義 ---------- */
export const highlightColors = {
  yellow: { name: "yellow", border: "rgba(255,255,0,0.5)", bg: "rgba(255,255,0,0.3)" },
  green: { name: "green", border: "rgba(144,238,144,0.5)", bg: "rgba(144,238,144,0.3)" },
  pink: { name: "pink", border: "rgba(255,182,193,0.6)", bg: "rgba(255,182,193,0.4)" },
};

// 安全な $ ヘルパー（存在しなければ null を返す）
export const $ = id => document.getElementById(id);

/* ---------- DOM → PDF座標変換 ---------- */
export function domToPdf(el, pageNum) {
  const pageView = PDFViewerApplication.pdfViewer.getPageView(pageNum - 1);
  const vp = pageView.viewport;
  const rect = el.getBoundingClientRect();
  const pageRect = pageView.div.getBoundingClientRect();

  const domX = rect.left - pageRect.left;
  const domY = rect.top - pageRect.top;

  const [pdfX, pdfY] = vp.convertToPdfPoint(domX, domY);
  return { x: pdfX, y: pdfY, w: rect.width / vp.scale, h: rect.height / vp.scale };
}

/* ---------- 選択処理 ---------- */
export function select(n) {
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

// ⚠️ noteMode.js の saveAllNotes との整合性を取るためのラッパー
export function saveAllNotes() {
    saveAllNotesToMode();
}


/* ---------- 初期化，イベント登録 ---------- */
// initFull()，document.addEventListener("mouseup", …)
function initFull() {
  const vc = $("viewerContainer");
  const noteBtn = $("addNoteButton");
  const highlightBtn = $("addHighlightButton");
  const freeHighlightBtn = $("addFreeHighlightButton");
  const freehandBtn = $("addFreehandButton");

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
    if (except !== "freehand") {
      state.freehandMode = false;
      freehandBtn.classList.remove("toggled");
      freehandMode.disable();
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

    if (state.highlightMode) {
      showHighlightColorPalette(highlightBtn);
    } else {
      hideHighlightColorPalette();
    }
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

  freehandMode.init();
  freehandBtn.onclick = () => {
    resetModes("freehand");

    state.freehandMode = !state.freehandMode;
    freehandBtn.classList.toggle("toggled", state.freehandMode);

    if (state.freehandMode) {
      freehandMode.enable();
    } else {
      freehandMode.disable();
    }
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
      } else if (state.selected.classList.contains("freehand-group")) {
        const group = state.selected;
        const groupData = {
          ...group.dataset,
          paths: Array.from(group.querySelectorAll('path')).map(p => p.getAttribute('d'))
        };
        doOp(OP.deleteFreehand(group, group.parentElement, groupData));
        freehandMode.hideColorPalette();
        select(null);
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

/* ---------- ⭐️【修正】ハイライト選択範囲確認 & ノート紐付け (マウスアップ) ⭐️ ---------- */
document.addEventListener("mouseup", (event) => { // event パラメータを追加
  const selection = window.getSelection();
  const selectedText = selection.toString().trim();

  // ハイライト処理
  if (state.highlightMode && selectedText) {
    console.log("選択範囲を確認:", selectedText);
    addHighlight();
  }

  // ノート紐付け処理
  if (state.linkingNote) {
    let target = null;
    let linkedContent = "";
    let linkType = ""; 
    let targetNoteId = "";

    // 1. PDFのテキスト選択による紐付け
    if (selectedText) {
      target = selection; 
      linkedContent = selectedText;
      linkType = "pdf";
    }
    // 2. ⭐️【追加】他のテキストボックスへのクリックによる紐付け ⭐️
    else {
      const clickedElement = event.target;
      const startNote = state.linkingNote;

      if (
        clickedElement.classList.contains("note") &&
        clickedElement !== startNote
      ) {
        target = clickedElement; 
        targetNoteId = clickedElement.dataset.id;
        linkedContent = "ノート: " + targetNoteId; 
        linkType = "note";
      }
    }

    if (target) {
      // 紐付けが成功した場合
      const startNote = state.linkingNote;
      
      if (linkType === "pdf") {
        startNote.dataset.linkedText = linkedContent;
        startNote.dataset.linkedNoteId = ""; // ノート間紐付けIDをクリア
      } else if (linkType === "note") {
        startNote.dataset.linkedText = "";
        startNote.dataset.linkedNoteId = targetNoteId; // リンク先のノートIDを保存
      }

      console.log(`ノートに紐付け (${linkType}):`, linkedContent);
      const displayText = linkType === 'note' ? `別のテキストボックス (ID: ${targetNoteId})` : `「${linkedContent}」`;
      showLinkStatus(`${displayText}に紐付け`);

      // 共通の後処理
      state.linkingNote = null;
      const vc = $("viewerContainer");
      if (vc) vc.style.cursor = "default";
      setHighlightSelectable(false);
      selection.removeAllRanges();
      saveAllNotes();
      removeLinkSVG(); // 紐付け完了時に線とSVGを削除
    } else if (state.linkingNote) {
      // 紐付け対象が見つからなかった場合（キャンセル）
      console.log("紐付けをキャンセルしました");
      showLinkStatus("紐付けをキャンセル");

      // 共通の後処理
      state.linkingNote = null;
      const vc = $("viewerContainer");
      if (vc) vc.style.cursor = "default";
      setHighlightSelectable(false);
      removeLinkSVG(); // 紐付けキャンセル時に線とSVGを削除
    }
  }
});

/* ---------- ⭐️【追加】マウス移動イベント: 紐付け中の線を表示 ⭐️ ---------- */
document.addEventListener("mousemove", (e) => {
  if (state.linkingNote && state.linkSVG) {
    updateLinkLine(state.linkStartNote, { x: e.clientX, y: e.clientY });
  }
});

/* ---------- 紐付けモード制御 ---------- */
export function setHighlightSelectable(selectable) {
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

// /* ---------- トピックビューボタン ---------- */
document.addEventListener("DOMContentLoaded", () => {
  setupTopicViewButton();
});

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

PDFViewerApplication.eventBus.on("sidebarviewchanged", () => {
  freehandMode.redrawAll();
  setTimeout(freehandMode.redrawAll, 100);
});

if (viewerContainer) {
  new ResizeObserver(() => freehandMode.redrawAll()).observe(viewerContainer);
}

PDFViewerApplication.eventBus.on("pagerendered", () => {
  const noteLayer = $("noteLayer");
  if (noteLayer.dataset.bubbleMode === "true") {
    updateBubblePositions();
  }
});

document.getElementById("noteLayer").addEventListener("click", (e) => {
  // freehand-group 上のクリックなら何もしない
  if (e.target.closest(".freehand-group")) return;

  // ハイライトなど他のノート要素がある場合も除外したければ必要に応じてここで判定

  // 選択解除
  select(null);

  // パレットも消す
  if (freehandMode.hideColorPalette) {
    freehandMode.hideColorPalette();
  }
});

// /* ---------- 検索機能起動 ---------- */
document.getElementById("findButton").addEventListener("click", () => {
  openSearchPanel();
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
      loadAllFromServer();
    });
  });