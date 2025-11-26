/* ---------- 吹き出しボタン関連 ---------- */
// toggleBubbleMode(), updateBubbleMode()

/* ---------- グローバル設定 ---------- */
import { state, $ } from './noteExtension.js';

export function toggleBubbleMode() {
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

    state.textMode = false;
    noteBtn.classList.remove("toggled");

    state.highlightMode = false;
    state.freeHighlightMode = false;
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

export function updateBubblePositions() {
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
