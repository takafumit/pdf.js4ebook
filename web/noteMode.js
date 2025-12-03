import { state, select, domToPdf, $, TEXT_KEY, setHighlightSelectable } from './noteExtension.js';
import { scheduleSave, showLinkStatus } from './annotationManager.js';
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
  note.dataset.attribute = "";
  note.dataset.linkedNoteId = "";
  // 🔴 削除: note.dataset.parentNoteId = ""; 

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
// ページを跨ぐ移動も対応
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

    // テキストボックスの現在の画面上の位置を取得
    const noteRect = note.getBoundingClientRect();

    // テキストボックスの中心座標を計算 (ページ判定の基準とする)
    const noteCenterY = noteRect.top + (noteRect.height / 2);

    let newPageNum = parseInt(note.dataset.page); // 元のページ番号を保持
    let targetPageView = null;
    const viewer = PDFViewerApplication.pdfViewer;

    // 全てのページビューをループし、中心座標がどのページに属するかを判定
    for (let i = 0; i < viewer._pages.length; i++) {
      const pageView = viewer.getPageView(i);
      const rect = pageView.div.getBoundingClientRect();

      // Y座標（縦方向）の範囲内にあるかを中心にチェック
      if (noteCenterY >= rect.top && noteCenterY <= rect.bottom) {
        targetPageView = pageView;
        newPageNum = i + 1; // 新しいページ番号を更新
        break;
      }
    }

    // ページが見つかった場合のみ、DOMとデータセットを操作
    if (targetPageView) {
      const originalPageNum = parseInt(note.dataset.page);

      // ページ番号が変更された場合、データセットを更新
      if (originalPageNum !== newPageNum) {
        note.dataset.page = newPageNum;
      }

      // ページを跨いだ移動に対応するための DOM移動
      const currentNoteLayer = note.parentElement;
      // 新しいページビューの注釈レイヤーを取得
      const targetNoteLayer = targetPageView.div.querySelector('.annotationLayer #noteLayer');

      if (targetNoteLayer && currentNoteLayer !== targetNoteLayer) {

        // DOM移動に伴う座標の再計算 (新しい親レイヤーからの相対位置に修正)
        const targetRect = targetNoteLayer.getBoundingClientRect();

        const newLeft = noteRect.left - targetRect.left;
        const newTop = noteRect.top - targetRect.top;

        note.style.left = `${newLeft}px`;
        note.style.top = `${newTop}px`;

        // DOMを移動
        targetNoteLayer.appendChild(note);
      }
    }

    // PDF座標の再計算 (domToPdfは現在のDOMサイズと位置を使ってdatasetを更新します)
    const { x, y, w, h } = domToPdf(note, newPageNum);
    note.dataset.x = x;
    note.dataset.y = y;
    // w, h は dataset に保存されている PDF 単位のサイズです

    // 🚨 スケール変更によるサイズ変動を防ぐための再設定
    const newScale = targetPageView.viewport.scale;
    const pdfW = parseFloat(note.dataset.w);
    const pdfH = parseFloat(note.dataset.h);

    // dataset の PDF 単位のサイズを使って、DOMのサイズを現在のスケールで正確に再設定
    // これにより、DOM移動後のブラウザによるサイズ変化やスクロールによるズレを打ち消します。
    note.style.width = `${pdfW * newScale}px`;
    note.style.height = `${pdfH * newScale}px`;

    const toLeft = parseFloat(note.style.left);
    const toTop = parseFloat(note.style.top);

    // Undo/Redo操作を記録
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
      linkedText: note.dataset.linkedText || "",
      attribute: note.dataset.attribute || "",
      linkedNoteId: note.dataset.linkedNoteId || "",
    });
  });
  localStorage.setItem(TEXT_KEY, JSON.stringify({ notes }));

  // if (notes?.length) {
  //   console.log(`📝 現在のテキストボックス一覧 (${notes.length}件):`);
  //   console.table(notes);
  // }
  saveNotesToServer(notes);
}

// ⭐️【追加】特定のIDを持つノートDOM要素を取得するヘルパー関数 ⭐️
/**
 * 特定の data-id を持つノート要素（DOM）を取得する
 * @param {string} itemId 検索したいノートの一意のID
 * @returns {HTMLElement | null} ノート要素、または見つからなかった場合は null
 */
function getNoteElementById(itemId) {
  // 属性セレクタを使用して、data-idが一致する要素を探す
  const selector = `.note[data-id="${itemId}"]`;
  return document.querySelector(selector);
}

// ⭐️【修正】テキストボックス削除時に他のテキストボックスの紐付けをクリーンアップする関数 ⭐️
/**
 * 削除されたテキストボックスのIDを紐付け先として参照している他のテキストボックスのDOM属性をクリーンアップする
 *
 * 別のテキストボックスが、削除されたテキストボックスを linkedNoteId (紐付け先) として参照している場合のみクリアします。
 * @param {string} deletedNoteId 削除されたテキストボックスのID
 */
function cleanupLinksAfterDeletion(deletedNoteId) {
  if (!deletedNoteId) return;

  // 1. 削除されたテキストボックスを linkedNoteId (テキストボックス間紐付け先) として参照しているテキストボックスをクリーンアップ
  const linkedSelector = `[data-linked-note-id="${deletedNoteId}"]`;
  document.querySelectorAll(linkedSelector).forEach(el => {
    el.dataset.linkedNoteId = "";
    // PDF紐付けとテキストボックス間紐付けの両方がなくなったらリンクステータスもクリアする
    if (!el.dataset.linkedText) {
      showLinkStatus(`テキストボックス間 ${el.dataset.id} の紐付けを解除しました。`);
    }
  });
  scheduleSave();
}


// 4. ⭐️【既存】紐付け中の線を表示するためのヘルパー関数 ⭐️

// SVG要素を作成する関数
function createLinkSVG() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.id = "linkLineSVG";
  svg.style.position = "absolute";
  svg.style.top = "0";
  svg.style.left = "0";
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.pointerEvents = "none"; // マウスイベントを透過させる
  svg.style.zIndex = "5000"; // 他の要素の上に表示
  return svg;
}

// 線を描画・更新する関数
function updateLinkLine(startNote, endPoint) {
  const svg = state.linkSVG;
  if (!svg || !startNote) return;

  const startRect = startNote.getBoundingClientRect();
  const startX = startRect.left + startRect.width / 2;
  const startY = startRect.top + startRect.height / 2;

  let endX, endY;
  if (endPoint) {
    // 終点がマウスカーソルの場合
    endX = endPoint.x;
    endY = endPoint.y;
  } else {
    // 終点が未確定の場合（マウスイベントで常に更新されることを期待）
    return;
  }

  // 既存のline要素を取得または作成
  let line = svg.querySelector("#activeLinkLine");
  if (!line) {
    line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.id = "activeLinkLine";
    line.setAttribute("stroke", "gray");
    line.setAttribute("stroke-width", "2");
    svg.appendChild(line);
  }

  // 座標を設定
  line.setAttribute("x1", startX);
  line.setAttribute("y1", startY);
  line.setAttribute("x2", endX);
  line.setAttribute("y2", endY);
}

// SVGを削除する関数
function removeLinkSVG() {
  if (state.linkSVG) {
    state.linkSVG.remove();
    state.linkSVG = null;
    state.linkStartNote = null;
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
    palette.style.flexDirection = "column";
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
  sizeRow.style.width = "100%";

  const sizes = [
    { label: "S", value: 12 },
    { label: "M", value: 14 },
    { label: "L", value: 16 },
    { label: "XL", value: 18 }
  ];

  sizes.forEach(s => {
    const btn = document.createElement("button");
    btn.textContent = s.label;
    btn.style.flexGrow = 1;
    btn.style.width = `${100 / sizes.length}%`;

    btn.onclick = () => {
      const prev = { fontSize: note.dataset.fontSize };
      const next = { fontSize: s.value };

      doOp(OP.updateStyle(note, prev, next));
    };
    sizeRow.appendChild(btn);
  });
  palette.appendChild(sizeRow);

  // 2行目：文字色
  const colorRow = document.createElement("div");
  colorRow.style.display = "flex";
  colorRow.style.gap = "6px";
  colorRow.style.width = "100%";
  const colors = ["black", "red", "blue", "green", "orange", "purple"];
  colors.forEach(color => {
    const btn = document.createElement("button");
    btn.style.background = color;
    btn.style.width = `${100 / colors.length}%`;
    btn.style.height = "20px";
    btn.style.border = "1px solid #666";

    btn.onclick = () => {
      const prev = { color: note.dataset.color };
      const next = { color };
      doOp(OP.updateStyle(note, prev, next));
    };
    colorRow.appendChild(btn);
  });
  palette.appendChild(colorRow);

  // 3行目：属性追加
  const attributeRow = document.createElement("div");
  attributeRow.style.display = "flex";
  attributeRow.style.gap = "6px";
  attributeRow.style.marginTop = "6px";

  // 属性の選択肢を定義
  const attributes = [
    { label: "補足", value: "detail", color: "#4a90e2" },
    { label: "疑問", value: "question", color: "#ff8c00" },
    { label: "考え", value: "reflection", color: "#32cd32" },
    { label: "その他", value: "other", color: "#808080" }
  ];

  attributes.forEach(attr => {
    const btn = document.createElement("button");
    btn.textContent = attr.label;
    btn.style.padding = "4px 8px";
    btn.style.border = `1px solid ${attr.color}`;
    btn.style.backgroundColor = note.dataset.attribute === attr.value ? attr.color : 'white';
    btn.style.color = note.dataset.attribute === attr.value ? 'white' : 'black';

    btn.onclick = () => {
      const currentAttr = note.dataset.attribute;
      let nextAttr = attr.value;
      if (currentAttr === attr.value) {
        nextAttr = "";
      }

      const prev = { attribute: currentAttr || "" };
      const next = { attribute: nextAttr };
      doOp(OP.updateStyle(note, prev, next));

      note.dataset.attribute = nextAttr;
      showNoteTextStylePalette(note);
    };
    attributeRow.appendChild(btn);
  });
  palette.appendChild(attributeRow);

  // 4行目：紐付け追加ボタン
  const linkRow = document.createElement("div");
  linkRow.style.display = "flex";
  linkRow.style.gap = "6px";
  linkRow.style.marginTop = "6px";
  linkRow.style.width = "100%";

  const linkBtn = document.createElement("button");
  linkBtn.textContent = "紐付け追加";
  linkBtn.title = "PDF/別のテキストボックスに紐付け";
  linkBtn.style.flexGrow = 1;
  linkBtn.style.width = "100%"; // 削除ボタンを下に移動したので幅を広げる
  linkBtn.onclick = () => {
    const noteBtn = $("addNoteButton");
    const highlightBtn = $("addHighlightButton");
    const freeHighlightBtn = $("addFreeHighlightButton");
    const freehandBtn = $("addFreehandButton");

    noteBtn.classList.remove("toggled");
    highlightBtn.classList.remove("toggled");
    freeHighlightBtn.classList.remove("toggled");
    freehandBtn.classList.remove("toggled");

    state.linkingNote = note;
    state.textMode = false;
    state.highlightMode = false;
    state.freeHighlightMode = false;

    // ⭐️ 紐付け開始時に線のSVGを準備 ⭐️
    const svg = createLinkSVG();
    document.body.appendChild(svg);
    state.linkSVG = svg;
    state.linkStartNote = note;

    const vc = $("viewerContainer");
    if (vc) vc.style.cursor = "crosshair";
    console.log("テキストボックスをPDFまたは別のテキストボックスに紐付けする準備完了");
    showLinkStatus("紐付け開始: PDFテキストを選択するか、別のテキストボックスをクリック");
    setHighlightSelectable(true);
  };
  linkRow.appendChild(linkBtn);
  palette.appendChild(linkRow);

  // --------------------------------------------
  // 💡 5行目：紐付け確認＆削除UIを新設 (ここから修正)
  // --------------------------------------------
  const confirmDelRow = document.createElement("div");
  confirmDelRow.style.display = "flex";
  confirmDelRow.style.flexDirection = "column";
  confirmDelRow.style.gap = "6px";
  confirmDelRow.style.marginTop = "6px";
  confirmDelRow.style.width = "100%";

  // 紐付けテキストまたはテキストボックスのIDの存在を確認
  const hasLinkedText = note.dataset.linkedText && note.dataset.linkedText.trim() !== "";
  const hasLinkedNote = note.dataset.linkedNoteId && note.dataset.linkedNoteId.trim() !== "";

  // === 紐付け確認ボタン ===
  const confirmBtn = document.createElement("button");
  confirmBtn.textContent = "🔗 紐付け確認";
  confirmBtn.title = "紐付けられているPDFテキストまたはテキストボックスのIDを確認";
  confirmBtn.style.padding = "4px 8px";
  confirmBtn.style.borderRadius = "4px";

  // ボタンの状態を制御
  confirmBtn.disabled = !hasLinkedText && !hasLinkedNote;
  if (hasLinkedText || hasLinkedNote) {
    confirmBtn.style.backgroundColor = '#4a90e2';
    confirmBtn.style.color = 'white';
    confirmBtn.title = "紐付けを確認";
  } else {
    confirmBtn.style.backgroundColor = '#f0f0f0';
    confirmBtn.style.color = '#999';
    confirmBtn.title = "紐付けがありません";
  }

  confirmBtn.onclick = (e) => {
    e.stopPropagation();
    let message = "";
    if (hasLinkedText) {
      message += "🔗 PDF上の紐付けテキスト:\n" + note.dataset.linkedText + "\n\n";
    }

    if (hasLinkedNote) {
      const linkedId = note.dataset.linkedNoteId;
      // linkedIdを使って、DOMから紐付け先のテキストボックス要素を探す
      const linkedNoteElement = document.querySelector(`[data-id="${linkedId}"]`);

      let linkedNoteContent = "（紐付け先のテキストボックスが見つかりません）";

      if (linkedNoteElement) {
        // 紐付け先の要素が見つかったら、textContentからノート内容を取得
        linkedNoteContent = linkedNoteElement.textContent;
      }
      message += "🔗 テキストボックス間の紐付けID:\n" + linkedId + "\n\n";
      // 取得したノート内容をメッセージに追加
      message += "📝 紐付け先のノート:\n" + linkedNoteContent + "\n";
    }

    if (message) {
      alert(message.trim());
    }
  };
  confirmDelRow.appendChild(confirmBtn);

  // === 削除オプションのチェックボックスと実行ボタン ===
  // PDF紐付け解除チェックボックス
  if (hasLinkedText) {
    // 初期値はチェック済みにする (true)
    const pdfCheck = createCheckbox("pdf-link-del", "PDF上の紐付けを削除 (linkedText)", true);
    confirmDelRow.appendChild(pdfCheck);
  }

  // テキストボックス間紐付け解除チェックボックス
  if (hasLinkedNote) {
    // 初期値はチェック済みにする (true)
    const noteCheck = createCheckbox("note-link-del", "テキストボックス間の紐付けを削除 (linkedNoteId)", true);
    confirmDelRow.appendChild(noteCheck);
  }

  // 削除実行ボタン
  if (hasLinkedText || hasLinkedNote) {
    const executeDelBtn = document.createElement("button");
    executeDelBtn.textContent = "☑️ 選択した紐付けを削除";
    executeDelBtn.style.marginTop = "4px";
    executeDelBtn.style.backgroundColor = 'red';
    executeDelBtn.style.color = 'white';
    executeDelBtn.style.padding = "4px 8px";
    executeDelBtn.style.borderRadius = "4px";

    executeDelBtn.onclick = (e) => {
      e.stopPropagation();
      let changeMade = false;

      // DOMから現在のチェック状態を取得
      const pdfCheckbox = confirmDelRow.querySelector('#pdf-link-del');
      const noteCheckbox = confirmDelRow.querySelector('#note-link-del');

      const shouldDeletePDF = pdfCheckbox?.checked;
      const shouldDeleteNote = noteCheckbox?.checked;

      if (!shouldDeletePDF && !shouldDeleteNote) {
        alert("削除する項目が選択されていません。");
        return;
      }

      // PDF紐付け削除
      if (hasLinkedText && shouldDeletePDF) {
        note.dataset.linkedText = "";
        changeMade = true;
      }

      // テキストボックス間紐付け削除
      if (hasLinkedNote && shouldDeleteNote) {
        note.dataset.linkedNoteId = "";
        changeMade = true;
      }

      if (changeMade) {
        showLinkStatus("選択した紐付けを解除しました。");
        showNoteTextStylePalette(note);
        scheduleSave();
      } else {
        showLinkStatus("紐付けは変更されませんでした。");
      }
    };
    confirmDelRow.appendChild(executeDelBtn);
  }
  palette.appendChild(confirmDelRow);

  // 6行目：テキストボックス専用の削除ボタン (元の delBtn)
  const delBtn = document.createElement("button");
  delBtn.textContent = "× テキストボックスの削除";
  delBtn.style.color = "white";
  delBtn.style.background = "red";
  delBtn.style.border = "none";
  delBtn.style.padding = "4px 8px";
  delBtn.style.borderRadius = "4px";

  delBtn.onclick = (e) => {
    e.stopPropagation();
    const deletedId = note.dataset.id;
    if (deletedId) {
      cleanupLinksAfterDeletion(deletedId);
    }

    doOp(OP.delete(note, note.parentElement));
    select(null);
    palette.remove();
    removeLinkSVG();

    scheduleSave();
  };
  palette.appendChild(delBtn);

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

/**
 * カスタムチェックボックス要素とラベルを生成するヘルパー関数
 * @param {string} id - チェックボックスのID
 * @param {string} labelText - ラベルとして表示するテキスト
 * @param {boolean} checked - 初期状態でチェックするかどうか
 * @returns {HTMLDivElement} ラベルとチェックボックスを含むコンテナ要素
 */
function createCheckbox(id, labelText, checked = false) {
  const container = document.createElement("div");
  container.style.display = "flex";
  container.style.alignItems = "center";
  container.style.gap = "4px";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = id;
  input.checked = checked;

  const label = document.createElement("label");
  label.htmlFor = id;
  label.textContent = labelText;
  label.style.fontSize = "12px";

  container.appendChild(input);
  container.appendChild(label);
  return container;
}

export {
  addNote,
  commit,
  enableDrag,
  enableResize,
  saveAllNotes,
  showNoteTextStylePalette,
  hideNoteColorPalette,
  updateLinkLine,
  removeLinkSVG,
  getNoteElementById,
  cleanupLinksAfterDeletion,
}