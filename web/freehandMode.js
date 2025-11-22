// freehandMode.js

import { state, select, FREEHAND_KEY } from "./noteExtension.js";
// Undo/Redo のために必要であればコメントアウトを解除してください
// import { OP, doOp } from "./undoRedoManager.js"; 
// import { saveFreehandToServer } from './serverStorage.js';

/* ---------- 定義と設定 ---------- */
const strokes = [];

const freehandColors = {
    black: "#000000",
    red: "#ff0000",
    blue: "#0000ff",
    green: "#00aa00"
};
const defaultColorKey = "red";

const currentColor = defaultColorKey;

export const freehandMode = {
    isDrawing: false,
    currentStroke: null,
    selectedPath: null,

    /* ---------- モード制御 ---------- */
    enable() {
        state.freehandMode = true;
        const vc = document.getElementById("viewerContainer");
        if (vc) vc.style.cursor = "crosshair";
        console.log("freehand enabled");
    },

    disable() {
        state.freehandMode = false;
        this.isDrawing = false;
        this.currentStroke = null;

        // モード無効時にパレットを非表示にする
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
        // PDFViewerApplication は外部ライブラリ (pdf.js) のグローバルオブジェクトを想定
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
        if (!state.freehandMode || e.button !== 0 || e.target.closest(".note, .highlight, .freehand-group, #freehandColorPalette")) return;

        // PDFビューアのページ要素を取得
        const pageDiv = e.target.closest(".page");
        // PDFViewerApplication の存在チェック
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
        this.currentStroke = { points: [{ x, y }], page: pageNum, colorKey: currentColor };

        this.ensureSvgLayer();
        // 描画開始時にパス要素を作成し、currentStrokeに保持
        this.currentStroke.pathEl = this.createSvgPath(this.currentStroke.points, freehandColors[currentColor]);
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
    },

    /* ---------- SVGレイヤー管理 ---------- */
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

    /* ---------- グループ化処理 ---------- */
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
        innerSvg.setAttribute("viewBox", `0 0 ${bbox.width} ${bbox.height}`);
        group.appendChild(innerSvg);

        // 各ストローク（パス要素）をグループのSVG内に移動（座標をオフセット）
        strokesArray.forEach(s => {
            // 描画中に使ったパス要素を取得
            if (s.pathEl && s.pathEl.parentElement) {
                const pathEl = s.pathEl;

                // 1. 座標をグループの左上基準に再計算し、D属性を更新
                const d = s.points.map((p, i) => {
                    const px = p.x - bbox.left;
                    const py = p.y - bbox.top;
                    return `${i === 0 ? "M" : "L"}${px},${py}`;
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
                this.showColorPalette(group);
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

        console.log("freehand group created:", group.dataset.id);
        // saveFreehandToServer(group);
        const pathsData = strokesArray.map(s =>
            s.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ")
        );

        const singleGroupData = {
            id: group.dataset.id,
            page: pageNum,
            x: pdfX,
            y: pdfY,
            w: pdfW,
            h: pdfH,
            color: groupColorKey,
            // 複数のパスデータを配列として保存する
            paths: pathsData // ⬅️ ここを配列にする
        };

        // 既存のフリーハンドデータを取得し、新しいグループデータを追加して保存し直す
        saveGroupLocally(singleGroupData);
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

    /* ---------- ドラッグ・リサイズ処理 ---------- */
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

            startX = e.clientX;
            startY = e.clientY;
            startLeft = parseFloat(getComputedStyle(group).left);
            startTop = parseFloat(getComputedStyle(group).top);

            // TODO: Undo/Redo のための移動前位置を保存
            document.onmousemove = onMove;
            document.onmouseup = onUp;
        };

        function onMove(e) {
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            group.style.left = `${startLeft + dx}px`;
            group.style.top = `${startTop + dy}px`;
        }

        const self = this; // onUp/onMove 内で freehandMode のメソッドを呼ぶために必要
        function onUp(e) {
            document.onmousemove = document.onmouseup = null;

            // PDF座標に変換してデータセット更新
            const domX = parseFloat(group.style.left) - pageOffsetLeft;
            const domY = parseFloat(group.style.top) - pageOffsetTop;
            const [pdfX, pdfY] = vp.convertToPdfPoint(domX, domY);

            // PDF座標更新
            group.dataset.x = pdfX;
            group.dataset.y = pdfY;

            // TODO: Undo/Redo (OP.move) と保存のロジックをここに追加
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
            select(group); // リサイズ時も選択状態にする
            self._applySelectedStyle(group);

            startX = e.clientX;
            startY = e.clientY;
            startWidth = parseFloat(getComputedStyle(group).width);
            startHeight = parseFloat(getComputedStyle(group).height);

            // TODO: Undo/Redo のためのリサイズ前サイズを保存

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

            // SVG のサイズを連動させる（viewBoxが設定されているため、内部のパスが自動で拡大縮小する）
            const innerSvg = group.querySelector('svg');
            if (innerSvg) {
                innerSvg.setAttribute('width', newW);
                innerSvg.setAttribute('height', newH);
            }
        }

        function endResize() {
            document.onmousemove = document.onmouseup = null;

            const currentWidth = parseFloat(group.style.width);
            const currentHeight = parseFloat(group.style.height);

            // PDF座標に変換してデータセット更新
            group.dataset.w = currentWidth / vp.scale;
            group.dataset.h = currentHeight / vp.scale;

            // TODO: Undo/Redo (OP.resize) と保存のロジックをここに追加
        }
    },

    /* ---------- 選択・パレット処理 ---------- */
    _handleOutsideClick(e) {
        // 現在選択されているグループがない場合は何もしない
        if (!state.selected) return;

        // 1. クリックされた要素が、以下のいずれかに該当するかチェックする:
        //    a) 選択されているフリーハンドグループ (.freehand-group)
        //    b) カラーパレット (#freehandColorPalette)
        //    c) 描画を許可する要素（.pageなど）

        const isGroup = e.target.closest(".freehand-group");
        const isPalette = e.target.closest("#freehandColorPalette");

        if (isGroup || isPalette) {
            // グループまたはパレット内をクリックした場合は、選択解除しない
            return;
        }

        select(null); // 選択状態を解除 (state.selected を null にする関数を想定)
        this.hideColorPalette(); // パレットを非表示にする
    },

    _applySelectedStyle(group) {
        // リサイズハンドルも表示するために、選択状態を示すクラスを追加
        group.classList.add("selected-freehand-group");
    },

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
            // TODO: doOp(OP.delete(baseEl, baseEl.parentElement));
            if (baseEl && baseEl.parentElement) {
                baseEl.parentElement.removeChild(baseEl);
                select(null);
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
                    const paths = group.querySelectorAll("path");
                    paths.forEach(p => p.setAttribute("stroke", color));

                    // 選択スタイルとデータセットを更新
                    group.dataset.color = key;
                    this._applySelectedStyle(group);

                    document.dispatchEvent(
                        new CustomEvent("freehand:colorChanged", { detail: { group, color: key } })
                    );

                    // TODO: doOp(OP.updateColor(group, prevColor, key));
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

    /* ---------- 再描画処理 ---------- */
    redrawAll() {
        console.log("🔥 redrawAll が実行されました！");
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
                console.log(`🔨 ページ ${pageNum} のグループにドラッグ機能を初期化しました。`);
            }

            // **最も重要なチェック:**
            // noteLayer の子要素になっていない場合、PDFビューアがDOMをクリアした可能性があるため再挿入
            // ページの noteLayer を取得し直す
            const noteLayer = pageView.div.querySelector('.annotationLayer #noteLayer');
            if (noteLayer && !noteLayer.contains(group)) {
                noteLayer.appendChild(group);
                console.log(`✅ ページ ${pageNum} のグループを noteLayer に再挿入しました！`);
            }
        });
    }
};

// フリーハンドをローカルストレージに保存
// export function saveFreehandsLocally(freehands) {
//     try {
//         localStorage.setItem(FREEHAND_KEY, JSON.stringify({ freehands }));
//         console.log("📝 フリーハンド保存成功:", freehands.length, "件");
//     } catch (e) {
//         console.error("💾 フリーハンド保存失敗:", e);
//     }
// }
export function saveGroupLocally(newGroupData) {
    let currentData = { freehands: [] };
    const raw = localStorage.getItem(FREEHAND_KEY);

    // 既存のデータを取得（ストロークではなくグループの配列を想定）
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
        console.log("📝 グループ保存成功:", currentData.freehands.length, "件のグループ");
    } catch (e) {
        console.error("💾 グループ保存失敗:", e);
    }
}

export function restoreFreehands() {
    const raw = localStorage.getItem(FREEHAND_KEY);
    console.log(FREEHAND_KEY, raw);
    if (!raw) return;

    // let parsed;
    // try {
    //     parsed = JSON.parse(raw);
    // } catch {
    //     return;
    // }

    let parsed;

    if (raw) {
        console.log(`✅ ${FREEHAND_KEY} のデータが見つかりました。`);
        console.log("------------------------------------------");

        // 2. 取得した生データ（文字列）を出力
        console.log("Raw String Data:", raw);

        try {
            // 3. JSONとしてパース（構造化）を試みる
            parsed = JSON.parse(raw);

            console.log("Parsed JSON Object:", parsed);

            // 4. データの中身（例: freehands配列の長さ）を出力
            const freehandCount = parsed.freehands ? parsed.freehands.length : 0;
            console.log("復元されるフリーハンドの数:", freehandCount);

        } catch (e) {
            // 5. JSONパースに失敗した場合のエラーを出力
            console.error("❌ ERROR: JSON形式が不正です。:", e);
        }
    } else {
        console.log(`❌ ${FREEHAND_KEY} のデータは localStorage に見つかりませんでした。`);
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
            border: "2px solid blue"
        });

        const svgNS = "http://www.w3.org/2000/svg";
        const innerSvg = document.createElementNS(svgNS, "svg");
        innerSvg.setAttribute("width", fh.w * vp.scale);
        innerSvg.setAttribute("height", fh.h * vp.scale);
        innerSvg.setAttribute("viewBox", `0 0 ${fh.w} ${fh.h}`);
        innerSvg.style.pointerEvents = "none";

        const path = document.createElementNS(svgNS, "path");

        // group.style.left/top から、グループの左上隅のDOM絶対座標（px）を取得
        const groupLeft = parseFloat(group.style.left);
        const groupTop = parseFloat(group.style.top);

        // 🚨 修正: データ構造を統一し、パスが存在しない場合のフォールバックを強化 🚨
        // fh.paths (新しい配列) があればそれを使う。なければ fh.pathData (古い単一パス) を配列にする。
        const pathsToRestore = fh.paths || (fh.pathData ? [fh.pathData] : []);

        pathsToRestore.forEach(pathDataString => {
            // ⚠️ 強化されたチェック ⚠️: null, undefined, 空文字列、数値などの無効な値をスキップ
            if (typeof pathDataString !== 'string' || pathDataString.length === 0) {
                return;
            }

            // パスデータ（noteLayer絶対座標）をグループのviewBox座標系（PDF相対座標）に変換
            const relativePathData = pathDataString.split(' ').map(segment => {
                const command = segment.charAt(0);
                if (segment.length < 2) return segment; // 短すぎるセグメントはそのまま返す
                const coords = segment.slice(1);

                if (command === 'M' || command === 'L') {
                    // x, y は保存された絶対 DOM 座標
                    let [x, y] = coords.split(',').map(parseFloat);

                    // 1. DOM座標の差分を計算: (保存された絶対座標 - グループの絶対位置)
                    const domRelativeX = x - groupLeft;
                    const domRelativeY = y - groupTop;
                    
                    // 2. DOM座標の差分をスケールで割って、viewBoxの単位（PDF座標）にする 👈 ここが重要
                    const pdfRelativeX = domRelativeX / vp.scale;
                    const pdfRelativeY = domRelativeY / vp.scale;

                    return `${command}${pdfRelativeX},${pdfRelativeY}`;
                }
                return segment;
            }).join(' ');

            // パス要素を作成し、SVGに追加
            const path = document.createElementNS(svgNS, "path");
            path.setAttribute("d", relativePathData);
            path.setAttribute("stroke", freehandColors[fh.color] || freehandColors.red);
            path.setAttribute("fill", "none");
            path.setAttribute("stroke-width", 2);

            innerSvg.appendChild(path);
        });

        group.appendChild(innerSvg);

        group.addEventListener("click", ev => {
            ev.stopPropagation();
            select(group);
            freehandMode.showColorPalette(group);
        });

        noteLayer.appendChild(group);
        // ★★★ 確認用ログを追加 ★★★
        const isChildOfNoteLayer = noteLayer.contains(group);
        console.log(`✅ Group作成とDOM追加確認 (ページ ${fh.page}):`,
            `noteLayerの子要素か？ -> ${isChildOfNoteLayer ? 'YES' : 'NO'}`,
            '追加されたグループ要素:', group);
        // ★★★ ログ追加ここまで ★★★

        console.log(group.style.left, group.style.top, group.style.width, group.style.height);
        console.log(innerSvg.getAttribute("viewBox"));
        console.log(path.getAttribute("d"));
        console.log(group, group.offsetWidth, group.offsetHeight);
        console.log(innerSvg, innerSvg.getBoundingClientRect());

        // freehandMode.makeGroupDraggableAndResizable(group, pageView);
    });

    console.log("🖋 復元したフリーハンド:", freehands.length, "件");
}
