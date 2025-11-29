import { select, $, } from './noteExtension.js';
import { saveAllNotes } from './noteMode.js';
import { makeHighlightDraggableAndResizable, saveAllHighlights } from './highlightMode.js';
import { saveAllToServer } from './serverStorage.js';
import { OP, doOp } from './undoRedoManager.js';
import { saveAllFreehands, deleteGroupLocally } from './freehandMode.js';

/* ---------- 保存処理 ---------- */
export function scheduleSave() {
  clearTimeout(window._saveTimer);
  window._saveTimer = setTimeout(() => {
    saveAllNotes();
    saveAllHighlights();
    saveAllFreehands();
    saveAllToServer();
  }, 300);
}

/* ---------- 共通復元，再配置 ---------- */
// updateNotePositions()
export function updateNotePositions() {
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

/* ---------- 一括削除ボタン ---------- */
export function createDeleteButton() {
  const btn = document.getElementById("deleteButton");
  if (!btn) return;

  btn.onclick = () => {
    if (!confirm("すべての注釈を削除します。\n削除後は元に戻せません。よろしいですか？")) return;

    const elements = [
      ...document.querySelectorAll(".note"),
      ...document.querySelectorAll(".highlight"),
      ...document.querySelectorAll(".freehand-group")
    ];
    elements.forEach(hl => {
      doOp(OP.delete(hl, hl.parentElement));
      if (hl.classList.contains('freehand-group')) {
        deleteGroupLocally(hl.dataset.id);
      }
      hl.remove();
    });
    const freeSvg = document.querySelector("#noteLayer .freehandLayer");
    if (freeSvg) {
      while (freeSvg.firstChild) freeSvg.removeChild(freeSvg.firstChild);
    }

    select(null);
    scheduleSave();
  };
}

/* ---------- メッセージ表示するための関数 ---------- */
// showLinkStatus(text)
export function showLinkStatus(text) {
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
  }, 5000);
}