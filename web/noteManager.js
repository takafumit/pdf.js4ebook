// /* ---------- ノート管理 (グローバルオブジェクト形式) ---------- */
// window.NoteManager = (() => {
//     /* ---------- ヘルパー ---------- */
//     const $ = id => document.getElementById(id);

//     function domToPdf(el, pageNum) {
//         const pageView = PDFViewerApplication.pdfViewer.getPageView(pageNum - 1);
//         const vp = pageView.viewport;
//         const rect = el.getBoundingClientRect();
//         const pageRect = pageView.div.getBoundingClientRect();
//         const domX = rect.left - pageRect.left;
//         const domY = rect.top - pageRect.top;
//         const [pdfX, pdfY] = vp.convertToPdfPoint(domX, domY);
//         return { x: pdfX, y: pdfY, w: rect.width / vp.scale, h: rect.height / vp.scale };
//     }

//     function scheduleSave() {
//         clearTimeout(window._saveTimer);
//         window._saveTimer = setTimeout(() => {
//             NoteManager.saveAllNotes();
//             if (window.saveAllHighlights) saveAllHighlights();
//         }, 300);
//     }

//     /* ---------- Undo/Redo ---------- */
//     const undoStack = [], redoStack = [];
//     const OP = {
//         create: el => ({ action: "create", note: el }),
//         delete: (el, parent) => ({ action: "delete", note: el, parent }),
//         move: (el, fromX, fromY, toX, toY) => ({ action: "move", note: el, fromX, fromY, toX, toY }),
//         update: (el, prev, next) => ({ action: "update", note: el, prev, next }),
//         updateColor: (el, prev, next) => ({ action: "updateColor", note: el, prev, next })
//     };

//     function exec(op, reverse = false) {
//         const { action, note } = op;
//         switch (action) {
//             case "create": reverse ? note.remove() : $("noteLayer").appendChild(note); break;
//             case "delete": reverse ? op.parent.appendChild(note) : note.remove(); break;
//             case "move":
//                 note.style.left = (reverse ? op.fromX : op.toX) + "px";
//                 note.style.top = (reverse ? op.fromY : op.toY) + "px";
//                 break;
//             case "update": note.textContent = reverse ? op.prev : op.next; break;
//             case "updateColor": {
//                 const color = reverse ? op.prev : op.next;
//                 note.dataset.color = color;
//                 const c = NoteManager.highlightColors[color];
//                 note.style.backgroundColor = c.bg;
//                 note.style.border = `1px solid ${c.border}`;
//                 break;
//             }
//         }
//     }

//     function invert(op) {
//         const inv = { ...op };
//         switch (op.action) {
//             case "create": inv.action = "delete"; inv.parent = op.note.parentElement; break;
//             case "delete": inv.action = "create"; break;
//             case "move": [inv.fromX, inv.toX] = [inv.toX, inv.fromX];[inv.fromY, inv.toY] = [op.toY, op.fromY]; break;
//             case "update": [inv.prev, inv.next] = [op.next, op.prev]; break;
//             case "updateColor": [inv.prev, inv.next] = [op.next, op.prev]; break;
//         }
//         return inv;
//     }

//     function doOp(op) {
//         exec(op);
//         undoStack.push(invert(op));
//         redoStack.length = 0;
//         scheduleSave();
//     }

//     function undo() { const op = undoStack.pop(); if (!op) return; exec(op, true); redoStack.push(invert(op)); scheduleSave(); }
//     function redo() { const op = redoStack.pop(); if (!op) return; exec(op); undoStack.push(invert(op)); scheduleSave(); }

//     /* ---------- ハイライト色 ---------- */
//     const highlightColors = {
//         yellow: { name: "yellow", border: "rgba(255,255,0,0.5)", bg: "rgba(255,255,0,0.3)" },
//         green: { name: "green", border: "rgba(144,238,144,0.5)", bg: "rgba(144,238,144,0.3)" },
//         pink: { name: "pink", border: "rgba(255,182,193,0.6)", bg: "rgba(255,182,193,0.4)" },
//     };

//     let selected = null;
//     let linkingNote = null;

//     /* ---------- ノート関連 ---------- */
//     // 1. ノート生成，編集
//     // addNote(e), commit(note), enableDrag(note), enableResize(note)
//     function addNote(e) {
//         const note = document.createElement("div");
//         note.className = "note";
//         note.contentEditable = "true";
//         note.textContent = "ノート";
//         note.dataset.id = `note-${Date.now()}`;

//         const noteWidth = 100, noteHeight = 50;
//         note.style.width = noteWidth + "px";
//         note.style.height = noteHeight + "px";

//         note.style.fontSize = "14px";
//         note.style.color = "black";
//         note.dataset.fontSize = "14";
//         note.dataset.color = "black";
//         note.dataset.bubbleAttached = "false";

//         const viewerContainer = $("viewerContainer");
//         const viewerRect = viewerContainer.getBoundingClientRect();
//         const clickX = e.clientX;
//         const clickY = e.clientY;

//         let pageNum = null;
//         let targetPageView = null;

//         for (let i = 0; i < PDFViewerApplication.pdfViewer._pages.length; i++) {
//             const pageView = PDFViewerApplication.pdfViewer.getPageView(i);
//             const rect = pageView.div.getBoundingClientRect();
//             if (clickY >= rect.top && clickY <= rect.bottom) {
//                 pageNum = i + 1;
//                 targetPageView = pageView;
//                 break;
//             }
//         }

//         if (!targetPageView) {
//             pageNum = PDFViewerApplication.pdfViewer.currentPageNumber;
//             targetPageView = PDFViewerApplication.pdfViewer.getPageView(pageNum - 1);
//         }

//         const pageRect = targetPageView.div.getBoundingClientRect();
//         const pageX = clickX - pageRect.left;
//         const pageY = clickY - pageRect.top;

//         const [pdfX, pdfY] = targetPageView.viewport.convertToPdfPoint(pageX, pageY);

//         note.style.left = `${pageRect.left - viewerRect.left + pageX + viewerContainer.scrollLeft}px`;
//         note.style.top = `${pageRect.top - viewerRect.top + pageY + viewerContainer.scrollTop}px`;

//         note.dataset.page = pageNum;
//         note.dataset.x = pdfX;
//         note.dataset.y = pdfY;
//         note.dataset.w = noteWidth / targetPageView.viewport.scale;
//         note.dataset.h = noteHeight / targetPageView.viewport.scale;

//         $("noteLayer").appendChild(note);
//         enableDrag(note);
//         enableResize(note);
//         note.focus();

//         note.dataset.editing = "false";
//         note.dataset.origText = note.textContent;
//         note.onblur = () => commit(note);

//         note.onclick = e => {
//             e.stopPropagation();
//             select(note);
//             showNoteTextStylePalette(note);
//         };

//         note.addEventListener("input", () => {
//             note.dataset.origText = note.textContent;
//             scheduleSave();
//         });

//         doOp(OP.create(note));
//     }

//     // フォーカスを外したときに編集内容を確定し，Undo履歴に登録
//     function commit(note) {
//         if (!note || note.dataset.editing !== "true") return;
//         const prev = note.dataset.origText, next = note.textContent;
//         if (prev !== next) doOp(OP.update(note, prev, next));
//         note.dataset.editing = "false";
//         note.dataset.origText = next;
//         scheduleSave();
//     }

//     // マウスドラッグでノートを移動可能に
//     function enableDrag(note) {
//         let startX, startY, fromLeft, fromTop;
//         note.onmousedown = e => {
//             if (e.button !== 0) return;
//             commit(note);
//             startX = e.clientX; startY = e.clientY;
//             const cs = getComputedStyle(note);
//             fromLeft = parseFloat(cs.left); fromTop = parseFloat(cs.top);
//             document.onmousemove = move; document.onmouseup = up;
//         };
//         const move = e => {
//             note.style.left = `${fromLeft + e.clientX - startX}px`;
//             note.style.top = `${fromTop + e.clientY - startY}px`;
//         };
//         const up = () => {
//             document.onmousemove = document.onmouseup = null;
//             const pageNum = parseInt(note.dataset.page);
//             const { x, y, w, h } = domToPdf(note, pageNum);
//             note.dataset.x = x; note.dataset.y = y; note.dataset.w = w; note.dataset.h = h;
//             scheduleSave();
//         };
//     }

//     function enableResize(note) {
//         if (note.querySelector(".note-resize-handle")) return;

//         const handle = document.createElement("div");
//         handle.className = "note-resize-handle";
//         note.appendChild(handle);

//         let startX, startY, startWidth, startHeight;
//         let prevEditable;

//         handle.onmousedown = e => {
//             e.stopPropagation();

//             document.body.style.userSelect = "none";

//             prevEditable = note.contentEditable;
//             note.contentEditable = "false";

//             startX = e.clientX;
//             startY = e.clientY;
//             const cs = getComputedStyle(note);
//             startWidth = parseFloat(cs.width);
//             startHeight = parseFloat(cs.height);

//             document.onmousemove = move;
//             document.onmouseup = up;
//         };

//         function move(e) {
//             const dx = e.clientX - startX;
//             const dy = e.clientY - startY;
//             note.style.width = `${startWidth + dx}px`;
//             note.style.height = `${startHeight + dy}px`;
//         }

//         function up() {
//             document.onmousemove = document.onmouseup = null;

//             const pageNum = parseInt(note.dataset.page);
//             const { x, y, w, h } = domToPdf(note, pageNum);
//             note.dataset.w = w;
//             note.dataset.h = h;
//             scheduleSave();

//             note.contentEditable = prevEditable ?? "true";
//             document.body.style.userSelect = "auto";
//         }

//         const vc = $("viewerContainer");
//         setTimeout(() => {
//             if (addMode && !note.isResizing) {
//                 vc.style.cursor = "crosshair";
//                 console.log("ノートモード再開 (条件付き)");
//             }
//         }, 50);
//     }

//     // 2. ノート保存，復元
//     // saveAllNotes()，restoreNotes()
//     function saveAllNotes() {
//         const notes = [];
//         document.querySelectorAll(".note").forEach(note => {
//             const pageNum = +note.dataset.page || 1;
//             const { x, y, w, h } = domToPdf(note, pageNum);

//             if (!note.dataset.id) note.dataset.id = `note-${Date.now()}`;

//             notes.push({
//                 id: note.dataset.id,
//                 page: pageNum,
//                 x, y, w, h,
//                 text: note.textContent,
//                 bubbleAttached: note.dataset.bubbleAttached === "true",
//                 fontSize: note.dataset.fontSize || "14",
//                 color: note.dataset.color || "black",
//                 linkedText: note.dataset.linkedText || ""
//             });
//         });
//         localStorage.setItem(STORAGE_KEY, JSON.stringify({ notes }));

//         // if (notes?.length) {
//         //   console.log(`📝 現在のノート一覧 (${notes.length}件):`);
//         //   console.table(notes);
//         // }
//     }

//     function restoreNotes() {
//         const data = localStorage.getItem(STORAGE_KEY);
//         if (!data) return;
//         const { notes } = JSON.parse(data);

//         notes.forEach(n => {
//             const note = document.createElement("div");
//             note.className = "note";
//             note.contentEditable = "true";
//             note.textContent = n.text;

//             // dataset に linkedText を含めてコピー
//             Object.assign(note.dataset, n);

//             // linkedText を確認用に console に表示（任意）
//             if (note.dataset.linkedText) {
//                 console.log("復元された linkedText:", note.dataset.linkedText);
//             }

//             // 復元時に文字色・サイズを style に反映
//             note.style.color = n.color || "black";
//             note.style.fontSize = (n.fontSize || "14") + "px";

//             note.onclick = e => { e.stopPropagation(); select(note); showNoteTextStylePalette(note); };
//             note.onfocus = () => { note.dataset.editing = "true"; note.dataset.origText = note.textContent; };
//             note.onblur = () => commit(note);

//             note.addEventListener("input", () => {
//                 note.dataset.origText = note.textContent;
//                 scheduleSave();
//             });

//             enableDrag(note);
//             enableResize(note);
//             $("noteLayer").appendChild(note);
//         });

//         updateNotePositions();

//         if (notes?.length) {
//             console.log("📝 復元後のノート一覧:");
//             console.table(notes);
//         }
//     }

//     // 3. ノート表示補助
//     // showNoteTextStylePalette(note), hideNoteColorPalette()
//     function showNoteTextStylePalette(note) {
//         let palette = document.getElementById("noteTextStylePalette");
//         if (!palette) {
//             palette = document.createElement("div");
//             palette.id = "noteTextStylePalette";
//             palette.style.position = "absolute";
//             palette.style.display = "flex";
//             palette.style.flexDirection = "column"; // 縦方向に並べる
//             palette.style.gap = "6px";
//             palette.style.padding = "6px";
//             palette.style.border = "1px solid #bbb";
//             palette.style.background = "#fff";
//             palette.style.boxShadow = "0 2px 6px rgba(0,0,0,0.15)";
//             palette.style.zIndex = 3000;
//             document.body.appendChild(palette);
//         }
//         palette.innerHTML = "";

//         // 1行目：文字サイズ
//         // 文字サイズの行（S/M/L/XL版）
//         const sizeRow = document.createElement("div");
//         sizeRow.style.display = "flex";
//         sizeRow.style.gap = "6px";

//         const sizes = [
//             { label: "S", value: 12 },
//             { label: "M", value: 14 },
//             { label: "L", value: 16 },
//             { label: "XL", value: 18 }
//         ];

//         sizes.forEach(s => {
//             const btn = document.createElement("button");
//             btn.textContent = s.label;
//             btn.onclick = () => {
//                 note.style.fontSize = s.value + "px";
//                 note.dataset.fontSize = s.value;
//                 scheduleSave();
//             };
//             sizeRow.appendChild(btn);
//         });

//         palette.appendChild(sizeRow);


//         // 2行目：文字色
//         const colorRow = document.createElement("div");
//         colorRow.style.display = "flex";
//         colorRow.style.gap = "6px";
//         ["black", "red", "blue", "green", "orange", "purple"].forEach(color => {
//             const btn = document.createElement("button");
//             btn.style.background = color;
//             btn.style.width = "20px"; btn.style.height = "20px";
//             btn.style.border = "1px solid #666";
//             btn.onclick = () => { note.style.color = color; note.dataset.color = color; scheduleSave(); };
//             colorRow.appendChild(btn);
//         });
//         palette.appendChild(colorRow);

//         // 2025/10/26
//         // 3行目：紐付けボタン
//         const linkBtn = document.createElement("button");
//         linkBtn.textContent = "紐付け追加";
//         linkBtn.title = "PDFに紐付け";
//         linkBtn.onclick = () => {
//             linkingNote = note;
//             const vc = $("viewerContainer");
//             if (vc) vc.style.cursor = "crosshair";
//             console.log("ノートをPDFに紐付けする準備完了");
//             showLinkStatus("紐付け開始");
//         };
//         palette.appendChild(linkBtn);

//         // 4行目：紐付け削除ボタン
//         const linkDelBtn = document.createElement("button");
//         linkDelBtn.textContent = "紐付け削除";
//         linkDelBtn.title = "PDFの紐付け削除";
//         linkDelBtn.onclick = e => {
//             e.stopPropagation();
//             note.dataset.linkedText = "";
//             console.log("ノートの紐付けを削除しました:", note.textContent);
//             showLinkStatus("紐付け削除完了");
//             scheduleSave();
//         };
//         palette.appendChild(linkDelBtn);

//         // note の下に表示
//         const rect = note.getBoundingClientRect();
//         palette.style.left = `${rect.left}px`;
//         palette.style.top = `${rect.bottom + 6}px`;
//         palette.style.display = "flex";
//     }

//     function hideNoteColorPalette() {
//         const palette = $("noteTextStylePalette");
//         if (palette) {
//             palette.style.display = "none";
//         }
//     }

//     return {
//         addNote,
//         commit,
//         enableDrag,
//         enableResize,
//         saveAllNotes,
//         restoreNotes,
//         showNoteTextStylePalette,
//         hideNoteColorPalette,
//         undo,
//         redo,
//         highlightColors,
//         linkingNote,
//         selected
//     };
// })();