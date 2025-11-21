// freehandMode.js
import { state } from "./noteExtension.js";

const strokes = [];

export const freehandMode = {
    isDrawing: false,
    currentStroke: null,
    tempPath: null,
    selectedPath: null,

    enable() {
        state.freehandMode = true;
        console.log("freehand enabled");
    },

    disable() {
        state.freehandMode = false;
        this.isDrawing = false;
        this.currentStroke = null;
        this.tempPath = null;
        console.log("freehand disabled");
    },

    init() {
        const vc = document.getElementById("viewerContainer");
        if (!vc) return;

        vc.addEventListener("mousedown", e => this._down(e));
        vc.addEventListener("mousemove", e => this._move(e));
        vc.addEventListener("mouseup", e => this._up(e));

        PDFViewerApplication.eventBus.on("scalechanging", () => this.redrawAll());
        PDFViewerApplication.eventBus.on("scalechanged", () => this.redrawAll());
    },

    _down(e) {
        if (!state.freehandMode || e.button !== 0) return;

        e.preventDefault(); 
        e.stopPropagation();

        const noteLayer = document.getElementById("noteLayer");
        if (!noteLayer) return;

        const rect = noteLayer.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        this.isDrawing = true;
        this.currentStroke = { points: [{ x, y }] };

        this.ensureSvgLayer();
        this.tempPath = this.createSvgPath(this.currentStroke.points);
    },

    _move(e) {
        if (!this.isDrawing || !this.currentStroke) return;

        const noteLayer = document.getElementById("noteLayer");
        const rect = noteLayer.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        this.currentStroke.points.push({ x, y });
        this.updateSvgPath(this.tempPath, this.currentStroke.points);
    },

    _up(e) {
        if (!this.isDrawing) return;

        // 描画されたストロークを永続的なデータとして保存
        if (this.currentStroke && this.currentStroke.points.length > 1) {
            // パス要素を複製し、一時パスを確定パスに置き換える
            const svg = document.querySelector("#noteLayer .freehandLayer");
            if (svg && this.tempPath) {
                // 1. 新しい永続的なパス要素を作成
                const finalPath = this.createSvgPath(this.currentStroke.points, true); // finalPathにはクリックリスナーが追加される
                finalPath.setAttribute('data-stroke-id', Date.now()); // クリック可能にするためのIDなど

                // 2. 一時パスを削除
                svg.removeChild(this.tempPath);
            }
            
            // ストロークデータを保存 (redrawAllなどで使うため)
            strokes.push(this.currentStroke);
        } else if (this.tempPath) {
             // ほとんど点が無いストロークは削除
             const svg = document.querySelector("#noteLayer .freehandLayer");
             if (svg) svg.removeChild(this.tempPath);
        }

        this.isDrawing = false;
        this.currentStroke = null;
        this.tempPath = null; // 一時パスは削除または確定したのでnullに戻す
    },

    ensureSvgLayer() {
        const noteLayer = document.getElementById("noteLayer");
        if (!noteLayer) return;

        let svg = noteLayer.querySelector(".freehandLayer");
        if (svg) return;

        svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.classList.add("freehandLayer");

        const rect = noteLayer.getBoundingClientRect();
        svg.style.position = "absolute";
        svg.style.left = "0px";
        svg.style.top = "0px";
        svg.style.width = rect.width + "px";
        svg.style.height = rect.height + "px";
        svg.style.pointerEvents = "auto";
        svg.style.zIndex = 1000;

        noteLayer.appendChild(svg);
    },

    // createSvgPath(points) {
    //     const svg = document.querySelector("#noteLayer .freehandLayer");
    //     if (!svg) return null;

    //     const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    //     path.setAttribute("stroke", "red");
    //     path.setAttribute("fill", "none");
    //     path.setAttribute("stroke-width", 2);

    //     svg.appendChild(path);
    //     this.updateSvgPath(path, points);

    //     return path;
    // },
    createSvgPath(points, enableClick = false) { // 引数 `enableClick` を追加
        const svg = document.querySelector("#noteLayer .freehandLayer");
        if (!svg) return null;

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("stroke", "red");
        path.setAttribute("fill", "none");
        path.setAttribute("stroke-width", 2);
        
        // 🚨 ポイント: 描画中はpointerEventsを無効にしないが、確定後は`auto`または`visiblePainted`などにしてクリック可能にする
        // ただし、SVGレイヤー全体が `pointerEvents: auto` なので、ここではクリックリスナーを追加するだけで良い
        
        svg.appendChild(path);
        this.updateSvgPath(path, points);
        
        if (enableClick) { // 確定したパスにのみクリックイベントを追加
            this.addPathClickListener(path);
        }

        return path;
    },

    updateSvgPath(path, points) {
        const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
        path.setAttribute("d", d);
    },

    addPathClickListener(pathElement) { 
        pathElement.addEventListener("click", (e) => {
            if (state.freehandMode) return; // フリーハンドモード中はクリックを無効にする
            
            e.stopPropagation(); 

            if (this.selectedPath === pathElement) {
                // 既に選択されているパスを再度クリックした場合（選択解除）
                this._deselectPath(pathElement);
            } else {
                // 新しいパスをクリックした場合
                
                // 既存の選択があれば、それを解除
                if (this.selectedPath) {
                    this._deselectPath(this.selectedPath);
                }
                
                // 新しいパスを選択
                this._selectPath(pathElement);
            }
        });
    },

    _selectPath(pathElement) { // 選択処理
        this.selectedPath = pathElement;
        // 選択された状態のスタイルを設定 (例: 青い線、太い線など)
        pathElement.setAttribute("stroke", "blue");
        pathElement.setAttribute("stroke-width", 3); // 選択されたことを示すため、少し太くする
        console.log("Path selected!");
    },
    
    _deselectPath(pathElement) { // 選択解除処理
        if (this.selectedPath === pathElement) {
            this.selectedPath = null;
        }
        // 元のスタイルに戻す (例: 赤い線、元の太さ)
        pathElement.setAttribute("stroke", "red");
        pathElement.setAttribute("stroke-width", 2);
        console.log("Path deselected!");
    },

    redrawAll() {
        // TODO: 保存済みストロークの再描画
    }
};
