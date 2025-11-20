import { state, select, domToPdf, $, TEXT_KEY, setHighlightSelectable } from './noteExtension.js';
import { scheduleSave, showLinkStatus } from './noteAndHighlightManager.js';
import { saveNotesToServer } from './serverStorage.js';
import { OP, doOp } from './undoRedoManager.js';


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
    console.log("undoStack:", state.undoStack);
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

        const toLeft = parseFloat(note.style.left);
        const toTop = parseFloat(note.style.top);

        if (fromLeft !== toLeft || fromTop !== toTop) {
            doOp(OP.move(note, fromLeft, fromTop, toLeft, toTop));
        }

        scheduleSave();
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
        // const { w, h } = domToPdf(note, pageNum);

        // note.dataset.w = w;
        // note.dataset.h = h;

        const pageView = PDFViewerApplication.pdfViewer.getPageView(pageNum - 1);
        const vp = pageView.viewport;

        // DOMサイズを PDF 単位で dataset に保存
        note.dataset.w = parseFloat(note.style.width) / vp.scale;
        note.dataset.h = parseFloat(note.style.height) / vp.scale;

        doOp(OP.resize(
            note,
            startWidth,
            startHeight,
            parseFloat(note.style.width),
            parseFloat(note.style.height)
        ));

        scheduleSave();

        note.contentEditable = prevEditable ?? "true";
        document.body.style.userSelect = "auto";
    }

    const vc = $("viewerContainer");
    setTimeout(() => {
        if (state.textMode && !note.isResizing) {
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
        state.linkingNote = note;
        state.textMode = false;
        state.highlightMode = false;
        state.freeHighlightMode = false;
        const vc = $("viewerContainer");
        if (vc) vc.style.cursor = "crosshair";
        console.log("ノートをPDFに紐付けする準備完了");
        showLinkStatus("紐付け開始");
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

export {
    addNote,
    commit,
    enableDrag,
    enableResize,
    saveAllNotes,
    showNoteTextStylePalette,
    hideNoteColorPalette,
}