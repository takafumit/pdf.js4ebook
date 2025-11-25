// freehandMode.js

import { state, select, FREEHAND_KEY, domToPdf } from "./noteExtension.js";
import { doOp, OP } from './undoRedoManager.js';

/* ---------- 定義と設定 ---------- */
const strokes = [];

export const freehandColors = {
  black: "#000000",
  red: "#ff0000",
  blue: "#0000ff",
  green: "#00aa00"
};
const defaultColorKey = "red";

export const freehandMode = {
  isDrawing: false,
  currentStroke: null,
  selectedPath: null,
  currentColor: defaultColorKey, // 現在の描画色を保持

  /* ---------- モード制御 ---------- */
  enable() {
    state.freehandMode = true;
    const vc = document.getElementById("viewerContainer");
    if (vc) vc.style.cursor = "crosshair";
    console.log("freehand enabled");

    // モード有効時に色選択パレットを表示
    this.showPreDrawColorPalette();
  },

  disable() {
    state.freehandMode = false;
    this.isDrawing = false;
    this.currentStroke = null;

    this.hideColorPalette();

    // 無効化されたタイミングで、描いたストロークを矩形グループ化する
    if (strokes.length > 0) {
      // ストローク配列をクリアし、グループ化
      this.createGroupFromStrokes(strokes.splice(0));
    }

    // グループ化されなかった一時的なパスがあればクリア
    const freeSvg = document.querySelector("#noteLayer .freehandLayer");
    if (freeSvg) {
      while (freeSvg.firstChild) freeSvg.removeChild(freeSvg.firstChild);
    }

    // カーソルをデフォルトに戻す
    const vc = document.getElementById("viewerContainer");
    if (vc) vc.style.cursor = "default";
    console.log("freehand disabled");
  },

  /* ---------- 初期化 ---------- */
  init() {
    const vc = document.getElementById("viewerContainer");
    if (!vc) return;

    vc.addEventListener("mousedown", e => this._down(e));
    vc.addEventListener("mousemove", e => this._move(e));
    vc.addEventListener("mouseup", e => this._up(e));

    document.addEventListener("click", e => this._handleOutsideClick(e));

    // 画面の拡大縮小、リサイズに対応するために redrawAll をフック
    if (typeof PDFViewerApplication !== 'undefined' && PDFViewerApplication.eventBus) {
      PDFViewerApplication.eventBus.on("scalechanging", () => this.redrawAll());
      PDFViewerApplication.eventBus.on("scalechanged", () => this.redrawAll());
      PDFViewerApplication.eventBus.on("pagerendered", () => this.redrawAll());
    }

    // SVGレイヤーの確保
    this.ensureSvgLayer();
  },

  /* ---------- 描画処理 ---------- */
  _down(e) {
    // パレットまたは既存の要素をクリックした場合は描画を開始しない
    if (!state.freehandMode || e.button !== 0 || e.target.closest(".note, .highlight, .freehand-group, #freehandColorPalette")) return;

    // 🚨 修正ポイント: 描画開始でパレットを非表示にする
    this.hideColorPalette();

    // PDFビューアのページ要素を取得
    const pageDiv = e.target.closest(".page");
    const pageNum = pageDiv ? parseInt(pageDiv.dataset.pageNumber) : (typeof PDFViewerApplication !== 'undefined' ? PDFViewerApplication.pdfViewer.currentPageNumber : 1);

    e.preventDefault();
    e.stopPropagation();

    const noteLayer = document.getElementById("noteLayer");
    if (!noteLayer) return;

    // noteLayer からの相対座標
    const rect = noteLayer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    this.isDrawing = true;
    // ページ番号と一時パスをストロークに保持
    this.currentStroke = { points: [{ x, y }], page: pageNum, colorKey: this.currentColor };

    this.ensureSvgLayer();
    // 描画開始時にパス要素を作成
    this.currentStroke.pathEl = this.createSvgPath(this.currentStroke.points, freehandColors[this.currentColor]);
  },

  _move(e) {
    if (!this.isDrawing || !this.currentStroke) return;

    const noteLayer = document.getElementById("noteLayer");
    const rect = noteLayer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    this.currentStroke.points.push({ x, y });
    this.updateSvgPath(this.currentStroke.pathEl, this.currentStroke.points);
  },

  _up(e) {
    if (!this.isDrawing) return;

    // 描画されたストロークを永続的なデータとして保存
    if (this.currentStroke && this.currentStroke.points.length > 1) {
      // 描画が有効な場合、ストロークを確定リストに追加
      strokes.push(this.currentStroke);

      // SVG要素のpointerEventsを'auto'に変更し、クリック可能にする (グループ化前)
      if (this.currentStroke.pathEl) {
        this.currentStroke.pathEl.setAttribute("pointer-events", "auto");
      }

    } else if (this.currentStroke && this.currentStroke.pathEl) {
      // 短すぎる描画の場合、作成したパス要素を削除
      const svg = document.querySelector("#noteLayer .freehandLayer");
      if (svg) svg.removeChild(this.currentStroke.pathEl);
    }

    this.isDrawing = false;
    this.currentStroke = null;

    // 🚨 修正ポイント: 描画モードが有効な場合でも、描画終了後にパレットを再表示しない
  },

  /* ---------- SVGレイヤー管理 (変更なし) ---------- */
  ensureSvgLayer() {
    const noteLayer = document.getElementById("noteLayer");
    if (!noteLayer) return;

    let svg = noteLayer.querySelector(".freehandLayer");
    if (svg) return;

    const svgNS = "http://www.w3.org/2000/svg";
    svg = document.createElementNS(svgNS, "svg");
    svg.classList.add("freehandLayer");

    const rect = noteLayer.getBoundingClientRect();
    Object.assign(svg.style, {
      position: "absolute",
      left: "0px",
      top: "0px",
      width: rect.width + "px",
      height: rect.height + "px",
      pointerEvents: "none",
      zIndex: 1000
    });

    noteLayer.appendChild(svg);
  },

  createSvgPath(points, color = freehandColors[defaultColorKey]) {
    const svg = document.querySelector("#noteLayer .freehandLayer");
    if (!svg) return null;

    const svgNS = "http://www.w3.org/2000/svg";
    const path = document.createElementNS(svgNS, "path");
    path.setAttribute("stroke", color);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke-width", 2);
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.style.pointerEvents = "none";

    svg.appendChild(path);
    this.updateSvgPath(path, points);
    return path;
  },

  updateSvgPath(path, points) {
    if (points.length === 0) return;
    const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
    path.setAttribute("d", d);
  },

  /* ---------- グループ化処理 (変更なし) ---------- */
  createGroupFromStrokes(strokesArray) {
    if (!strokesArray || strokesArray.length === 0) return;

    const noteLayer = document.getElementById("noteLayer");
    if (!noteLayer || typeof PDFViewerApplication === 'undefined') return;

    // 1) 全ストロークのバウンディングボックスを計算 (DOM座標, noteLayer相対)
    const bbox = this.computeBoundingBox(strokesArray);

    // ストローク配列は全て同じ色（最初のストロークの色を使う）
    const groupColorKey = strokesArray[0].colorKey || defaultColorKey;
    const groupColor = freehandColors[groupColorKey];

    // PDF座標変換の準備
    const pageNum = strokesArray[0].page;
    const pageView = PDFViewerApplication.pdfViewer.getPageView(pageNum - 1);
    if (!pageView) return;

    const vp = pageView.viewport;
    const noteLayerRect = noteLayer.getBoundingClientRect();
    const pageRect = pageView.div.getBoundingClientRect();

    // DOM座標の bbox からページ内ローカル座標を計算
    const domX = bbox.left - (pageRect.left - noteLayerRect.left);
    const domY = bbox.top - (pageRect.top - noteLayerRect.top);

    // PDF座標に変換
    const [pdfX, pdfY] = vp.convertToPdfPoint(domX, domY);
    const pdfW = bbox.width / vp.scale;
    const pdfH = bbox.height / vp.scale;

    // ビューポート座標への配置を再計算
    const [viewX, viewY] = vp.convertToViewportPoint(pdfX, pdfY);

    // 2) グループ要素（div）を作成し、SVGを内部に置く
    const group = document.createElement("div");
    group.className = "freehand-group";
    group.dataset.id = `fh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // PDF座標とページ番号、色を格納
    Object.assign(group.dataset, {
      page: pageNum,
      x: pdfX, y: pdfY,
      w: pdfW, h: pdfH,
      color: groupColorKey // 確定した色をデータセットに保存
    });

    Object.assign(group.style, {
      position: "absolute",
      left: `${viewX + pageView.div.offsetLeft}px`,
      top: `${viewY + pageView.div.offsetTop}px`,
      width: `${bbox.width}px`,
      height: `${bbox.height}px`,
      border: `1px solid rgba(0,0,0,0.2)`,
      background: `rgba(255,255,255,0.0)`,
      cursor: "move",
      zIndex: 2000,
      pointerEvents: "auto"
    });

    // SVG を作る
    const svgNS = "http://www.w3.org/2000/svg";
    const innerSvg = document.createElementNS(svgNS, "svg");
    innerSvg.setAttribute("width", bbox.width);
    innerSvg.setAttribute("height", bbox.height);
    innerSvg.style.display = "block";
    innerSvg.style.pointerEvents = "none";
    innerSvg.setAttribute("viewBox", `0 0 ${pdfW} ${pdfH}`);
    group.appendChild(innerSvg);

    // 各ストローク（パス要素）をグループのSVG内に移動（座標をオフセット）
    strokesArray.forEach(s => {
      // 描画中に使ったパス要素を取得
      if (s.pathEl && s.pathEl.parentElement) {
        const pathEl = s.pathEl;

        // 1. 座標をグループの左上基準に再計算し、D属性を更新
        const d = s.points.map((p, i) => {
          const groupRelativeX = p.x - bbox.left;
          const groupRelativeY = p.y - bbox.top;

          // DOMピクセルを PDFポイント単位に変換
          const pdfXpt = groupRelativeX / vp.scale;
          const pdfYpt = groupRelativeY / vp.scale;

          return `${i === 0 ? "M" : "L"}${pdfXpt},${pdfYpt}`;
        }).join(" ");
        pathEl.setAttribute("d", d);

        // 2. パス要素の色を設定（グループの色）
        pathEl.setAttribute("stroke", groupColor);
        pathEl.setAttribute("stroke-width", 2);
        pathEl.setAttribute("fill", "none");
        pathEl.style.pointerEvents = "none";

        // 3. パス要素を freehandLayer から innerSvg へ移動
        innerSvg.appendChild(pathEl);
      }
    });

    // 選択/クリック処理
    group.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (state.selected === group) {
        select(null);
        this.hideColorPalette();
      } else {
        select(group);
        this._applySelectedStyle(group);
        this.showColorPalette(group); // グループ選択時のパレット表示
      }
    });

    noteLayer.appendChild(group);

    // 3) グループをドラッグ・リサイズ可能にする（pageViewを渡す）
    this.makeGroupDraggableAndResizable(group, pageView);

    // 4) カスタムイベントを dispatch
    document.dispatchEvent(new CustomEvent("freehand:groupCreated", { detail: { group, strokes: strokesArray } }));

    // 5) freehandLayer に残っているパスはもう無いので、このクリーンアップは通常空です。
    const freeSvg = document.querySelector("#noteLayer .freehandLayer");
    if (freeSvg) {
      while (freeSvg.firstChild) freeSvg.removeChild(freeSvg.firstChild);
    }

    const pathsData = strokesArray.map(s => {
      return s.points.map((p, i) => {
        const groupRelativeX = p.x - bbox.left;
        const groupRelativeY = p.y - bbox.top;

        // PDF座標（ViewBox座標）に変換
        const pdfXpt = groupRelativeX / vp.scale;
        const pdfYpt = groupRelativeY / vp.scale;

        return `${i === 0 ? "M" : "L"}${pdfXpt},${pdfYpt}`;
      }).join(" ");
    });

    const singleGroupData = {
      id: group.dataset.id,
      page: pageNum,
      x: pdfX,
      y: pdfY,
      w: pdfW,
      h: pdfH,
      color: groupColorKey,
      paths: pathsData
    };

    // 既存のフリーハンドデータを取得し、新しいグループデータを追加して保存し直す
    saveGroupLocally(singleGroupData);
    const parent = noteLayer;
    doOp(OP.createFreehand(group, parent, singleGroupData));
  },

  computeBoundingBox(strokesArray) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    strokesArray.forEach(s => {
      s.points.forEach(p => {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
      });
    });
    const PAD = 6;
    minX = Math.max(0, minX - PAD);
    minY = Math.max(0, minY - PAD);
    maxX += PAD;
    maxY += PAD;
    return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
  },

  /* ---------- ドラッグ・リサイズ処理 (変更なし) ---------- */
  makeGroupDraggableAndResizable(group, pageView) {
    let startX, startY, startLeft, startTop, startWidth, startHeight;
    const vp = pageView.viewport;
    const pageOffsetLeft = pageView.div.offsetLeft;
    const pageOffsetTop = pageView.div.offsetTop;

    // --- ドラッグ ---
    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (e.target.classList.contains("freehand-resize-handle")) return;

      // 選択されたグループのスタイルを適用
      select(group);
      this._applySelectedStyle(group);
      this.hideColorPalette(); // ドラッグ開始でパレットを閉じる

      startX = e.clientX;
      startY = e.clientY;
      startLeft = parseFloat(getComputedStyle(group).left);
      startTop = parseFloat(getComputedStyle(group).top);

      group.dataset.startLeft = startLeft;
      group.dataset.startTop = startTop;
      group.dataset.startPdfX = group.dataset.x;
      group.dataset.startPdfY = group.dataset.y;

      document.onmousemove = onMove;
      document.onmouseup = onUp;
    };

    function onMove(e) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      group.style.left = `${startLeft + dx}px`;
      group.style.top = `${startTop + dy}px`;
    }

    const self = this;
    function onUp(e) {
      document.onmousemove = document.onmouseup = null;

      const prevPdfX = parseFloat(group.dataset.startPdfX);
      const prevPdfY = parseFloat(group.dataset.startPdfY);

      // ページ番号を取得
      const pageNum = parseInt(group.dataset.page);

      // 【🔥🔥🔥 修正点 🔥🔥🔥】domToPdf を使って正確な PDF 座標を取得する
      const { x: pdfX, y: pdfY } = domToPdf(group, pageNum);

      // 既存のDOM座標を取得 (Undo/Redo用)
      const toLeft = parseFloat(group.style.left);
      const toTop = parseFloat(group.style.top);
      const fromLeft = parseFloat(group.dataset.startLeft);
      const fromTop = parseFloat(group.dataset.startTop);

      // PDF座標更新
      group.dataset.x = pdfX;
      group.dataset.y = pdfY;

      // 🚨 注意: domToPdfはw, hも返しますが、移動時はサイズは変わらないので、
      // w, hのdataset更新は不要か、または group.dataset.w/h を使うべきです。
      // サイズも再計算する場合は { x: pdfX, y: pdfY, w: pdfW, h: pdfH } のように受け取ります。

      // ... (続く doOp と saveGroupLocally のロジック) ...

      if (prevPdfX !== pdfX || prevPdfY !== pdfY) {
        doOp(OP.moveFreehand(
          group,
          fromLeft, fromTop, toLeft, toTop, // DOM座標はUndo用
          prevPdfX, prevPdfY, pdfX, pdfY    // PDF座標はデータ保存用
        ));
      }

      // 位置変更をローカルストレージに保存
      const savedPaths = Array.from(group.querySelectorAll('path')).map(p => p.getAttribute('d'));
      const groupData = {
        id: group.dataset.id,
        page: pageNum,
        x: pdfX, // ✅ 更新されたPDF座標
        y: pdfY, // ✅ 更新されたPDF座標
        w: parseFloat(group.dataset.w),
        h: parseFloat(group.dataset.h),
        color: group.dataset.color,
        paths: savedPaths
      };
      saveGroupLocally(groupData);
    }

    group.addEventListener("mousedown", onMouseDown);

    // --- リサイズハンドル（右下） ---
    const handle = document.createElement("div");
    handle.className = "freehand-resize-handle";
    Object.assign(handle.style, {
      position: "absolute",
      width: "10px",
      height: "10px",
      right: "0px",
      bottom: "0px",
      cursor: "se-resize",
      backgroundColor: "rgba(200,200,200,0.9)",
      zIndex: 10001
    });
    group.appendChild(handle);

    handle.onmousedown = (e) => {
      e.stopPropagation();
      select(group);
      self._applySelectedStyle(group);
      self.hideColorPalette(); // リサイズ開始でパレットを閉じる

      startX = e.clientX;
      startY = e.clientY;
      startWidth = parseFloat(getComputedStyle(group).width);
      startHeight = parseFloat(getComputedStyle(group).height);

      handle.dataset.startPdfW = group.dataset.w;
      handle.dataset.startPdfH = group.dataset.h;

      document.onmousemove = doResize;
      document.onmouseup = endResize;
    };

    function doResize(e) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const newW = Math.max(20, startWidth + dx);
      const newH = Math.max(20, startHeight + dy);

      group.style.width = `${newW}px`;
      group.style.height = `${newH}px`;

      // SVG のサイズを連動させる
      const innerSvg = group.querySelector('svg');
      if (innerSvg) {
        innerSvg.setAttribute('width', newW);
        innerSvg.setAttribute('height', newH);
      }
    }

    function endResize() {
      document.onmousemove = document.onmouseup = null;

      const prevW = startWidth;
      const prevH = startHeight;
      const prevPdfW = parseFloat(handle.dataset.startPdfW);
      const prevPdfH = parseFloat(handle.dataset.startPdfH);

      const prevPaths = Array.from(group.querySelectorAll('path')).map(p => p.getAttribute('d'));

      const currentWidth = parseFloat(group.style.width);
      const currentHeight = parseFloat(group.style.height);
      const toW = currentWidth;
      const toH = currentHeight;

      const scaleX = currentWidth / startWidth;
      const scaleY = currentHeight / startHeight;

      const pdfW = prevPdfW * scaleX;
      const pdfH = prevPdfH * scaleY;
      const toPdfW = pdfW;
      const toPdfH = pdfH;

      // PDF座標に変換してデータセット更新
      group.dataset.w = pdfW;
      group.dataset.h = pdfH;

      // viewBox を更新
      const innerSvg = group.querySelector('svg');
      if (innerSvg) {
        innerSvg.setAttribute("viewBox", `0 0 ${pdfW} ${pdfH}`);
      }

      // パスのD属性をスケールに応じて更新
      group.querySelectorAll('path').forEach(path => {
        const d = path.getAttribute('d');
        const newD = d.replace(/([ML])([\d.]+),([\d.]+)/g, (match, cmd, x, y) => {
          const newX = parseFloat(x) * scaleX;
          const newY = parseFloat(y) * scaleY;
          return `${cmd}${newX},${newY}`;
        });
        path.setAttribute('d', newD);
      });

      const nextPaths = Array.from(group.querySelectorAll('path')).map(p => p.getAttribute('d'));

      if (prevW !== toW || prevH !== toH) {
        doOp(OP.resizeFreehand(
          group,
          prevW, prevH, toW, toH,
          prevPdfW, prevPdfH, toPdfW, toPdfH,
          prevPaths, // 👈 追加
          nextPaths  // 👈 追加
        ));
      }

      const savedPaths = Array.from(group.querySelectorAll('path')).map(p => p.getAttribute('d'));
      const groupData = {
        id: group.dataset.id,
        page: parseInt(group.dataset.page),
        x: parseFloat(group.dataset.x),
        y: parseFloat(group.dataset.y),
        w: pdfW,
        h: pdfH,
        color: group.dataset.color,
        paths: savedPaths
      };

      saveGroupLocally(groupData);
      self.updateGroupElements(group);
    }
  },

  /* ---------- 選択・パレット処理 ---------- */
  _handleOutsideClick(e) {
    // 🚨 修正ポイント: freehandModeが有効な場合は、パレット外をクリックしてもパレットを閉じず、描画可能状態を維持する
    if (state.freehandMode) {
      const isPalette = e.target.closest("#freehandColorPalette");
      // パレット内でクリックされた場合は伝播を止めるだけで、描画を妨げない
      if (isPalette) {
        e.stopPropagation();
      }
      return;
    }

    // freehandModeが無効（通常モード）の場合:
    if (!state.selected) return;

    // グループまたはパレット内をクリックした場合は、選択解除しない
    const isGroup = e.target.closest(".freehand-group");
    const isPalette = e.target.closest("#freehandColorPalette");

    if (isGroup || isPalette) {
      return;
    }

    select(null); // 選択状態を解除
    this.hideColorPalette(); // パレットを非表示にする
  },

  _applySelectedStyle(group) {
    group.classList.add("selected-freehand-group");
  },

  // 描画モード有効時に表示する色選択パレット
  showPreDrawColorPalette() {
    this.hideColorPalette();
    const palette = document.createElement("div");
    palette.id = "freehandColorPalette";
    Object.assign(palette.style, {
      position: "absolute",
      display: "flex",
      gap: "6px",
      padding: "6px",
      border: "1px solid #bbb",
      background: "#fff",
      boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
      zIndex: 100000,
      cursor: "default"
    });

    // 画面中央上部付近に表示
    const top = 50;
    palette.style.top = `${top}px`;
    palette.style.left = `50%`;
    palette.style.transform = `translateX(-50%)`;

    // カラーボタン
    Object.entries(freehandColors).forEach(([key, color]) => {
      const btn = document.createElement("button");
      Object.assign(btn.style, {
        background: color,
        // 描画色によって枠線を変更
        border: this.currentColor === key ? "3px solid black" : "2px solid #333",
        width: "24px",
        height: "24px",
        borderRadius: "4px",
        cursor: "pointer",
        transition: "border 0.1s"
      });
      btn.onclick = ev => {
        ev.stopPropagation();
        // 選択された色に this.currentColor を更新
        this.currentColor = key;

        // 選択状態を視覚的にフィードバックするためにパレットを再描画
        this.showPreDrawColorPalette();

        // カーソルを crosshair に戻す
        const vc = document.getElementById("viewerContainer");
        if (vc) vc.style.cursor = "crosshair";
      };
      btn.dataset.colorKey = key;
      palette.appendChild(btn);
    });

    document.body.appendChild(palette);
  },

  // 既存の showColorPalette (グループ選択後)
  showColorPalette(baseEl) {
    this.hideColorPalette();
    const palette = document.createElement("div");
    palette.id = "freehandColorPalette";
    Object.assign(palette.style, {
      position: "absolute",
      display: "flex",
      gap: "6px",
      padding: "6px",
      border: "1px solid #bbb",
      background: "#fff",
      boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
      zIndex: 100000
    });

    // 削除ボタンを追加
    const delBtn = document.createElement("button");
    delBtn.textContent = "× 削除";
    Object.assign(delBtn.style, {
      color: "white",
      background: "red",
      border: "none",
      padding: "4px 8px",
      borderRadius: "4px",
      cursor: "pointer",
      marginRight: "10px"
    });
    delBtn.onclick = e => {
      e.stopPropagation();
      this.hideColorPalette();

      if (baseEl) {
        const id = baseEl.dataset.id;

        const parent = baseEl.parentElement; // 親要素 (noteLayer) を取得

        // 【✅ 修正: 削除前のデータを取得】
        const deletedGroupData = { // freehandMode.js: saveGroupLocally と同じ形式のデータを復元用に作成
          id: baseEl.dataset.id,
          page: parseInt(baseEl.dataset.page),
          x: parseFloat(baseEl.dataset.x),
          y: parseFloat(baseEl.dataset.y),
          w: parseFloat(baseEl.dataset.w),
          h: parseFloat(baseEl.dataset.h),
          color: baseEl.dataset.color,
          paths: Array.from(baseEl.querySelectorAll('path')).map(p => p.getAttribute('d'))
        };

        baseEl.remove();
        select(null);

        deleteGroupLocally(id);

        // 【✅ 追記: doOp で削除操作を記録】
        doOp(OP.deleteFreehand(baseEl, parent, deletedGroupData)); // Undo/Redo のためにデータを渡す
        freehandMode.redrawAll();
      }
    };

    palette.appendChild(delBtn);

    // カラーボタン
    const currentGroupColorKey = baseEl.dataset.color || defaultColorKey;
    Object.entries(freehandColors).forEach(([key, color]) => {
      const btn = document.createElement("button");
      Object.assign(btn.style, {
        background: color,
        border: currentGroupColorKey === key ? "3px solid black" : "2px solid #333",
        width: "24px",
        height: "24px",
        borderRadius: "4px",
        cursor: "pointer",
        transition: "border 0.1s"
      });
      btn.onclick = ev => {
        ev.stopPropagation();

        const group = state.selected;
        if (group && group.classList.contains("freehand-group")) {
          // 変更前の色を記録
          const prevColorKey = group.dataset.color; // 【✅ 追加】
          const newColorKey = key;                   // 【✅ 追加】

          // 変更がない場合は何もしない (オプション)
          if (prevColorKey === newColorKey) {
            this.hideColorPalette();
            return;
          }

          const paths = group.querySelectorAll("path");
          paths.forEach(p => p.setAttribute("stroke", color));

          // 選択スタイルとデータセットを更新
          group.dataset.color = key;

          // グループの色が変更されたら、次に描画する色も更新しておく
          this.currentColor = key;

          this._applySelectedStyle(group);

          doOp(OP.updateFreehandColor(group, prevColorKey, newColorKey));

          const savedPaths = Array.from(group.querySelectorAll('path')).map(p => p.getAttribute('d'));
          const groupData = {
            id: group.dataset.id,
            page: parseInt(group.dataset.page),
            x: parseFloat(group.dataset.x),
            y: parseFloat(group.dataset.y),
            w: parseFloat(group.dataset.w),
            h: parseFloat(group.dataset.h),
            color: key,
            paths: savedPaths
          };
          saveGroupLocally(groupData);

          document.dispatchEvent(
            new CustomEvent("freehand:colorChanged", { detail: { group, color: key } })
          );
        }
        this.hideColorPalette();
      };
      palette.appendChild(btn);
    });

    const r = baseEl.getBoundingClientRect();
    palette.style.left = `${r.left}px`;
    palette.style.top = `${r.bottom + 6}px`;
    document.body.appendChild(palette);

    // 外クリックで非表示
    const closeOnOutsideClick = e => {
      if (!palette.contains(e.target) && !e.target.closest(".freehand-group")) {
        this.hideColorPalette();
        select(null);
        document.removeEventListener("click", closeOnOutsideClick);
      }
    };
    setTimeout(() => document.addEventListener("click", closeOnOutsideClick), 0);
  },

  hideColorPalette() {
    const p = document.getElementById("freehandColorPalette");
    if (p) p.remove();
  },

  /* ---------- 再描画処理 (変更なし) ---------- */
  redrawAll() {
    if (typeof PDFViewerApplication === 'undefined' || !PDFViewerApplication.pdfViewer) return;

    document.querySelectorAll(".freehand-group").forEach(group => {
      const pageNum = parseInt(group.dataset.page);
      const pdfX = parseFloat(group.dataset.x);
      const pdfY = parseFloat(group.dataset.y);
      const pdfW = parseFloat(group.dataset.w);
      const pdfH = parseFloat(group.dataset.h);

      const pageView = PDFViewerApplication.pdfViewer.getPageView(pageNum - 1);
      if (!pageView) return;

      const vp = pageView.viewport;

      // 1. PDF座標 -> ビューポート座標（DOM要素の位置）
      const [viewX, viewY] = vp.convertToViewportPoint(pdfX, pdfY);

      // 2. DOM要素の配置を更新
      group.style.left = `${viewX + pageView.div.offsetLeft}px`;
      group.style.top = `${viewY + pageView.div.offsetTop}px`;

      // 3. DOM要素のサイズを更新 (現在のスケールで表示)
      const domW = pdfW * vp.scale;
      const domH = pdfH * vp.scale;
      group.style.width = `${domW}px`;
      group.style.height = `${domH}px`;

      // 4. 内部のSVGサイズも更新 (viewBoxが設定されているためパスも追従)
      const innerSvg = group.querySelector('svg');
      if (innerSvg) {
        innerSvg.setAttribute('width', domW);
        innerSvg.setAttribute('height', domH);
      }

      group.querySelectorAll('path').forEach(path => {
        path.setAttribute("stroke-width", 2 / vp.scale);
      });

      // 選択中の場合は枠線を更新
      if (state.selected === group) {
        this._applySelectedStyle(group);
      }
    });

    document.querySelectorAll(".freehand-group").forEach(group => {
      const pageNum = parseInt(group.dataset.page);

      // ページビューが取得できない場合はスキップ
      const pageView = PDFViewerApplication.pdfViewer.getPageView(pageNum - 1);
      if (!pageView) return;

      // makeGroupDraggableAndResizable が呼ばれていない場合、ここで初期化
      if (!group.querySelector(".freehand-resize-handle")) {
        this.makeGroupDraggableAndResizable(group, pageView);
      }

      // noteLayer の子要素になっていない場合、再挿入
      const noteLayer = pageView.div.querySelector('.annotationLayer #noteLayer');
      if (noteLayer && !noteLayer.contains(group)) {
        noteLayer.appendChild(group);
      }
    });
  },

  // 【✅ 追加】グループ要素に関連するUI要素を更新する関数
  updateGroupElements(group) {
    // 1. リサイズハンドルの位置を更新 (右下)
    const handle = group.querySelector(".freehand-resize-handle");
    if (handle) {
      handle.style.right = "0px";
      handle.style.bottom = "0px";
    }

    // 2. パレットの位置を更新
    // 選択状態にあればパレットを再表示して位置を更新
    if (state.selected === group) {
      this.showColorPalette(group);
    }

    // 3. 再描画 (PDF Viewer のスケール変更などに対応)
    this.redrawAll();
  }
};

export function deleteGroupLocally(groupId) {
  const raw = localStorage.getItem(FREEHAND_KEY);
  if (!raw) return;

  let currentData = JSON.parse(raw);
  currentData.freehands = currentData.freehands.filter(g => g.id !== groupId);

  localStorage.setItem(FREEHAND_KEY, JSON.stringify(currentData));
}

export function saveGroupLocally(newGroupData) {
  let currentData = { freehands: [] };
  const raw = localStorage.getItem(FREEHAND_KEY);

  if (raw) {
    try {
      currentData = JSON.parse(raw);
    } catch (e) {
      console.error("既存データのパースエラー。新規作成します。", e);
    }
  }

  // 現在の配列から、同じIDのグループがあれば削除し、新しいグループを追加する
  currentData.freehands = currentData.freehands.filter(g => g.id !== newGroupData.id);
  currentData.freehands.push(newGroupData);

  try {
    localStorage.setItem(FREEHAND_KEY, JSON.stringify(currentData));
  } catch (e) {
    console.error("💾 グループ保存失敗:", e);
  }
}

export function restoreFreehands() {
  const raw = localStorage.getItem(FREEHAND_KEY);
  if (!raw) return;

  let parsed;

  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error("❌ ERROR: JSON形式が不正です。:", e);
    }
  }

  const freehands = parsed.freehands;
  if (!Array.isArray(freehands) || freehands.length === 0) return;

  const noteLayer = document.getElementById("noteLayer");
  if (!noteLayer) return;

  freehands.forEach(fh => {
    const pageView = PDFViewerApplication.pdfViewer.getPageView(fh.page - 1);
    if (!pageView) return;

    const vp = pageView.viewport;
    const [viewX, viewY] = vp.convertToViewportPoint(fh.x, fh.y);

    const group = document.createElement("div");
    group.className = "freehand-group";
    Object.assign(group.dataset, { ...fh });

    Object.assign(group.style, {
      position: "absolute",
      left: `${viewX + pageView.div.offsetLeft}px`,
      top: `${viewY + pageView.div.offsetTop}px`,
      width: `${fh.w * vp.scale}px`,
      height: `${fh.h * vp.scale}px`,
      cursor: "move",
      pointerEvents: "auto",
      zIndex: 2000,
      border: `1px solid rgba(0,0,0,0.2)`
    });

    const svgNS = "http://www.w3.org/2000/svg";
    const innerSvg = document.createElementNS(svgNS, "svg");
    innerSvg.setAttribute("width", fh.w * vp.scale);
    innerSvg.setAttribute("height", fh.h * vp.scale);
    innerSvg.setAttribute("viewBox", `0 0 ${fh.w} ${fh.h}`);
    innerSvg.style.pointerEvents = "none";

    const pathsToRestore = Array.isArray(fh.paths) ? fh.paths : [];
    if (pathsToRestore.length === 0) {
      return;
    }

    pathsToRestore.forEach(pathDataString => {
      if (typeof pathDataString !== 'string' || pathDataString.length < 5) return;

      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("d", pathDataString);
      path.setAttribute("stroke", freehandColors[fh.color] || freehandColors.red);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke-width", 2 / vp.scale);
      path.style.pointerEvents = "none";
      innerSvg.appendChild(path);
    });

    group.appendChild(innerSvg);

    group.addEventListener("click", ev => {
      ev.stopPropagation();
      select(group);
      freehandMode.showColorPalette(group); // グループ選択時のパレット表示
    });

    noteLayer.appendChild(group);
    freehandMode.makeGroupDraggableAndResizable(group, pageView);
  });

  // 復元された中で最後に処理されたグループの色を、次の描画色として設定
  if (freehands.length > 0) {
    const lastGroup = freehands[freehands.length - 1];
    freehandMode.currentColor = lastGroup.color || defaultColorKey;
  }
}

export function saveAllFreehands() {
  const freehandsData = [];
  const noteLayer = document.getElementById("noteLayer");

  // noteLayer が存在しない、またはDOMがまだ準備されていない場合は処理をスキップ
  if (!noteLayer) {
    console.warn("⚠️ Cannot save all freehands: #noteLayer not found.");
    return;
  }

  // DOM上の全てのフリーハンドグループを取得
  const allGroups = noteLayer.querySelectorAll('.freehand-group');

  allGroups.forEach(group => {
    // saveGroupLocally と同様に、DOM要素の dataset と path の 'd' 属性からデータを抽出
    const savedPaths = Array.from(group.querySelectorAll('path')).map(p => p.getAttribute('d'));

    freehandsData.push({
      id: group.dataset.id,
      page: parseInt(group.dataset.page),
      x: parseFloat(group.dataset.x),
      y: parseFloat(group.dataset.y),
      w: parseFloat(group.dataset.w),
      h: parseFloat(group.dataset.h),
      color: group.dataset.color,
      paths: savedPaths
    });
  });

  // 最終的に localStorage に保存するデータ構造を作成
  const finalData = { freehands: freehandsData };

  try {
    localStorage.setItem(FREEHAND_KEY, JSON.stringify(finalData));
    console.log(`✅ Saved ${freehandsData.length} freehand groups to localStorage (FREEHAND_KEY).`);
  } catch (e) {
    console.error("💾 全グループのローカル保存失敗:", e);
  }
}