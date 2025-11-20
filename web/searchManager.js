/* ---------- 検索機能 ---------- */
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

export {
  openSearchPanel,
  performSearch,
  scrollTotext,
  scrollToHighlight,
  scrollToPage
};