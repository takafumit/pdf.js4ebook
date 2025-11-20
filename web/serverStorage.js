/* ---------- サーバ保存，復元処理 ---------- */
// saveNotesToServer(), saveHighlightsToServer(), saveAllToServer()
// restoreNotesFromData(notes), restoreHighlightsFromData(highlights)
// loadNotesFromServer(), loadHighlightsFromServer(), loadAllFromServer()

import { select, showLinkStatus, updateNotePositions } from './noteExtension.js';
import { enableDrag, enableResize, commit, saveAllNotes, showNoteTextStylePalette } from './noteMode.js';
import { toggleHighlightSelection } from './highlightMode.js';

/* ---------- グローバル設定 ---------- */
const pdfId = PDFViewerApplication?.url?.split("/").pop() ?? "untitled.pdf";
const TEXT_KEY = `notes::${pdfId}`;
const HIGHLIGHT_KEY = `highlights::${pdfId}`;

/* ---------- 色定義 ---------- */
const highlightColors = {
  yellow: { name: "yellow", border: "rgba(255,255,0,0.5)", bg: "rgba(255,255,0,0.3)" },
  green: { name: "green", border: "rgba(144,238,144,0.5)", bg: "rgba(144,238,144,0.3)" },
  pink: { name: "pink", border: "rgba(255,182,193,0.6)", bg: "rgba(255,182,193,0.4)" },
};

// サーバーにテキストボックス保存
function saveNotesToServer() {
  const notes = Array.from(document.querySelectorAll(".note")).map(note => {
    const page = parseInt(note.dataset.page);
    const pageView = PDFViewerApplication.pdfViewer.getPageView(page - 1);
    const vp = pageView.viewport;

    return {
      id: note.dataset.id,
      page,
      x: parseFloat(note.dataset.x),
      y: parseFloat(note.dataset.y),

      w: parseFloat(note.style.width) / vp.scale,
      h: parseFloat(note.style.height) / vp.scale,

      text: note.textContent,
      bubbleAttached: note.dataset.bubbleAttached === "true",
      fontSize: note.dataset.fontSize || "14",
      color: note.dataset.color || "black",
      linkedText: note.dataset.linkedText || ""
    };
  });

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

export {
  saveNotesToServer,
  saveHighlightsToServer,
  saveAllToServer,
  restoreNotesFromData,
  restoreHighlightsFromData,
  loadNotesFromServer,
  loadHighlightsFromServer,
  loadAllFromServer
};

/*
5. MySQL データベース設定
MySQL に接続し、データベースおよびテーブルを作成する。
mysql -u root -p
CREATE DATABASE pdf_notes_db;
USE pdf_notes_db;

CREATE TABLE notes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  page INT NOT NULL,
  x FLOAT NOT NULL,
  y FLOAT NOT NULL,
  w FLOAT NOT NULL,
  h FLOAT NOT NULL,
  text TEXT,
  color VARCHAR(20),
  fontSize VARCHAR(10),
  linkedText VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE highlights (
  id INT AUTO_INCREMENT PRIMARY KEY,
  page INT NOT NULL,
  x FLOAT NOT NULL,
  y FLOAT NOT NULL,
  w FLOAT NOT NULL,
  h FLOAT NOT NULL,
  text TEXT,
  color VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

6. サーバーの起動と確認
サーバーを起動するには以下のコマンドを実行する。
node index.js
成功すると次のメッセージが表示される。
MySQL に接続しました！
Server running at http://localhost:3000
ブラウザで http://localhost:3000 にアクセスすると「PDFサーバーが起動しました！」と表示される。

*/