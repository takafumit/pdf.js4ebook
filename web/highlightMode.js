import { state, select, domToPdf, $, highlightColors, HIGHLIGHT_KEY } from './noteExtension.js';
import { hideNoteColorPalette } from './noteMode.js';
import { updateNotePositions, scheduleSave } from './noteAndHighlightManager.js';
import { saveHighlightsToServer } from './serverStorage.js';
import { OP, doOp } from './undoRedoManager.js';


let currentHighlightColor = "yellow";

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

/* ---------- PDFテキスト上のハイライト関連 ---------- */
// 1. ハイライト追加，選択
// addHighlight()，toggleHighlightSelection(hl)
function addHighlight() {
  const selection = window.getSelection();
  if (!state.highlightMode || !selection.rangeCount) return;

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
  console.log("undoStack:", state.undoStack);

  scheduleSave();
  selection.removeAllRanges();
  console.log("🟡 ハイライト追加:", selectedText);

  updateNotePositions();
}

function toggleHighlightSelection(hl) {
  if (state.selected === hl) {
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

    // ----------------------------------------------------
    // ページ移動とDOM更新ロジック (テキストボックスと同様)

    // ハイライトの現在の画面上の位置を取得
    const highlightRect = highlight.getBoundingClientRect();

    // ハイライトの中心座標を計算 (ページ判定の基準とする)
    const highlightCenterY = highlightRect.top + (highlightRect.height / 2);

    let newPageNum = parseInt(highlight.dataset.page); // 元のページ番号を保持
    let targetPageView = null;
    const viewer = PDFViewerApplication.pdfViewer;

    // 全てのページビューをループし、中心座標がどのページに属するかを判定
    for (let i = 0; i < viewer._pages.length; i++) {
      const pv = viewer.getPageView(i);
      const rect = pv.div.getBoundingClientRect();

      // Y座標（縦方向）の範囲内にあるかを中心にチェック
      if (highlightCenterY >= rect.top && highlightCenterY <= rect.bottom) {
        targetPageView = pv;
        newPageNum = i + 1; // 新しいページ番号を更新
        break;
      }
    }

    // ページが見つかった場合のみ、DOMとデータセットを操作
    if (targetPageView) {
      const originalPageNum = parseInt(highlight.dataset.page);

      // ページ番号が変更された場合、データセットを更新
      if (originalPageNum !== newPageNum) {
        highlight.dataset.page = newPageNum;
      }

      // ページを跨いだ移動に対応するための DOM移動
      const currentHighlightLayer = highlight.parentElement;
      // 注釈レイヤーを取得 (#noteLayer に入っていることを前提)
      const targetHighlightLayer = targetPageView.div.querySelector('.annotationLayer #noteLayer');

      if (targetHighlightLayer && currentHighlightLayer !== targetHighlightLayer) {

        // DOM移動に伴う座標の再計算 (新しい親レイヤーからの相対位置に修正)
        const targetRect = targetHighlightLayer.getBoundingClientRect();

        const newLeft = highlightRect.left - targetRect.left;
        const newTop = highlightRect.top - targetRect.top;

        highlight.style.left = `${newLeft}px`;
        highlight.style.top = `${newTop}px`;

        // DOMを移動
        targetHighlightLayer.appendChild(highlight);
      }
    }

    // 1. 最新のページ番号（移動後のデータセット）を取得
    const finalPageNum = parseInt(highlight.dataset.page);

    // 2. そのページ番号に対応する最新の pageView オブジェクトを PDFViewerApplication から取得
    const finalPageView = PDFViewerApplication.pdfViewer.getPageView(finalPageNum - 1);

    // 3. 取得した finalPageView を使って PDF座標に変換
    const vp = finalPageView.viewport;

    // ページのオフセットを引いてDOM座標を計算 (元のロジックを維持)
    const domX = parseFloat(highlight.style.left) - finalPageView.div.offsetLeft;
    const domY = parseFloat(highlight.style.top) - finalPageView.div.offsetTop;

    const [pdfX, pdfY] = vp.convertToPdfPoint(domX, domY);
    highlight.dataset.x = pdfX;
    highlight.dataset.y = pdfY;

    // width/height のデータセットも更新（リロード時にサイズが維持されるように）
    highlight.dataset.w = parseFloat(highlight.style.width) / vp.scale;
    highlight.dataset.h = parseFloat(highlight.style.height) / vp.scale;

    const toLeft = parseFloat(highlight.style.left);
    const toTop = parseFloat(highlight.style.top);

    if (startLeft !== toLeft || startTop !== toTop) {
      doOp(OP.move(highlight, startLeft, startTop, toLeft, toTop));
    }

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

export {
  addHighlight,
  toggleHighlightSelection,
  showHighlightColorPalette,
  hideHighlightColorPalette,
  saveAllHighlights,
  createFreeHighlight,
  makeHighlightDraggableAndResizable
};
