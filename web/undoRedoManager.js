import { state, $, highlightColors } from './noteExtension.js';
import { saveAllHighlights } from './highlightMode.js';
import { scheduleSave } from './annotationManager.js';
import { deleteGroupLocally, saveGroupLocally, freehandMode, freehandColors } from './freehandMode.js';

/* ---------- Undo/Redo ---------- */
export const OP = {
  create: (el, parent) => ({ action: "create", note: el, parent }),
  delete: (el, parent) => ({ action: "delete", note: el, parent }),
  move: (el, fromX, fromY, toX, toY) => ({ action: "move", note: el, fromX, fromY, toX, toY }),
  resize: (el, fromW, fromH, toW, toH) => ({ action: "resize", note: el, fromW, fromH, toW, toH }),
  update: (el, prev, next) => ({ action: "update", note: el, prev, next }),
  updateColor: (el, prev, next) => ({ action: "updateColor", note: el, prev, next }),
  updateStyle: (el, prev, next) => ({ action: "updateStyle", note: el, prev, next }),
  createFreehand: (el, parent, data) => ({ action: "createFreehand", note: el, parent, data }),
  deleteFreehand: (el, parent, data) => ({ action: "deleteFreehand", note: el, parent, data }),
  updateFreehandColor: (el, prev, next) => ({ action: "updateFreehandColor", note: el, prev, next }),
  // 【✅ 追加】フリーハンドの移動操作
  moveFreehand: (el, prevLeft, prevTop, toLeft, toTop, prevPdfX, prevPdfY, toPdfX, toPdfY) =>
    ({ action: "moveFreehand", note: el, prevLeft, prevTop, toLeft, toTop, prevPdfX, prevPdfY, toPdfX, toPdfY }),

  // 【✅ 追加】フリーハンドのリサイズ操作
  resizeFreehand: (el, prevW, prevH, toW, toH, prevPdfW, prevPdfH, toPdfW, toPdfH, prevPaths, nextPaths) =>
    ({ action: "resizeFreehand", note: el, prevW, prevH, toW, toH, prevPdfW, prevPdfH, toPdfW, toPdfH, prevPaths, nextPaths })
};

// Undo/Redo 対応のノート操作関数
export function exec(op) {
  const note = op.note;

  switch (op.action) {
    case "create":
      console.log("exec create:", note);
      $("noteLayer").appendChild(note);
      break;

    case "delete":
      console.log("removing note:", note);
      note.remove();
      break;

    case "move":
      note.style.left = op.toX + "px";
      note.style.top = op.toY + "px";
      break;

    case "resize":
      note.style.width = op.toW + "px";
      note.style.height = op.toH + "px";
      break;

    case "update":
      note.textContent = op.next;
      break;

    case "updateColor":
      const color = op.next;
      note.dataset.color = color;
      const c = highlightColors[color];
      note.style.backgroundColor = c.bg;
      note.style.border = `1px solid ${c.border}`;
      break;

    case "updateStyle":
      if (op.next.fontSize) {
        note.style.fontSize = op.next.fontSize + "px";
        note.dataset.fontSize = op.next.fontSize;
      }
      if (op.next.color) {
        note.style.color = op.next.color;
        note.dataset.color = op.next.color;
      }
      break;

    case "createFreehand":
      console.log("restoring freehand group:", note);
      // 1. DOMへの再追加
      op.parent.appendChild(note);

      // 2. ローカルストレージへの復元 (op.data を使用)
      // freehandModeから import した saveGroupLocally を呼び出す
      saveGroupLocally(op.data);

      // 3. 再描画 (freehandMode.js に依存)
      // redrawGroup のような関数があればそれを使用し、なければ freehandMode.redrawAll()
      freehandMode.redrawAll();
      break;

    case "deleteFreehand":
      console.log("removing freehand group:", note);
      note.remove();
      deleteGroupLocally(op.note.dataset.id);
      break;

    case "updateFreehandColor":
      console.log("update freehand color:", op.note);
      const group = op.note;

      // 1. dataset の更新
      group.dataset.color = op.next;

      // 2. パス要素の色を更新
      const newColor = freehandColors[op.next]; // freehandColorsはfreehandModeからインポート
      group.querySelectorAll('path').forEach(p => {
        p.setAttribute('stroke', newColor);
      });

      // 3. パレットの表示を更新（必要な場合）
      if (state.selected === group) freehandMode.showColorPalette(group);
      scheduleSave();
      break;

    // 【✅ 追加】フリーハンドの移動実行ロジック
    case "moveFreehand":
      const groupMove = op.note;
      groupMove.style.left = op.toLeft + "px";
      groupMove.style.top = op.toTop + "px";
      groupMove.dataset.x = op.toPdfX;
      groupMove.dataset.y = op.toPdfY;
      freehandMode.updateGroupElements(groupMove);
      scheduleSave();
      break;

    // 【✅ 追加】フリーハンドのリサイズ実行ロジック
    case "resizeFreehand":
      const groupResize = op.note;

      // 1. DOMサイズの更新
      groupResize.style.width = op.toW + "px";
      groupResize.style.height = op.toH + "px";

      // 2. データセット (PDF座標) の更新
      groupResize.dataset.w = op.toPdfW;
      groupResize.dataset.h = op.toPdfH;

      // 3. SVG要素の更新
      const innerSvgResize = groupResize.querySelector('svg');
      if (innerSvgResize) {
        innerSvgResize.setAttribute('width', op.toW);
        innerSvgResize.setAttribute('height', op.toH);
        innerSvgResize.setAttribute("viewBox", `0 0 ${op.toPdfW} ${op.toPdfH}`);
      }

      // 【✅ 追記】パスのd属性を復元する
      const paths = groupResize.querySelectorAll('path');
      const pathData = op.nextPaths; // Undo の場合はリサイズ前のデータがここに来る

      paths.forEach((path, index) => {
        if (pathData[index]) {
          path.setAttribute('d', pathData[index]);
        }
      });

      freehandMode.updateGroupElements(groupResize);
      scheduleSave();
      break;

    default:
      console.warn("Unknown op:", op);
  }
}

// 操作の逆バージョンを作る関数
export function invert(op) {
  const inv = { ...op };
  switch (op.action) {
    case "create":
      inv.action = "delete";
      break;
    case "delete":
      inv.action = "create";
      break;
    case "move":
      [inv.fromX, inv.toX] = [op.toX, op.fromX];
      [inv.fromY, inv.toY] = [op.toY, op.fromY];
      break;
    case "resize":
      [inv.fromW, inv.toW] = [op.toW, op.fromW];
      [inv.fromH, inv.toH] = [op.toH, op.fromH];
      break;
    case "update":
    case "updateColor":
      [inv.prev, inv.next] = [op.next, op.prev];
      break;
    case "updateStyle":
      [inv.prev, inv.next] = [op.next, op.prev];
      break;
    case "createFreehand":
      inv.action = "deleteFreehand";
      break;
    case "deleteFreehand":
      inv.action = "createFreehand";
      break;
    case "updateFreehandColor":
      [inv.prev, inv.next] = [op.next, op.prev];
      break;
    case "moveFreehand":
      [inv.prevLeft, inv.toLeft] = [op.toLeft, op.prevLeft];
      [inv.prevTop, inv.toTop] = [op.toTop, op.prevTop];
      [inv.prevPdfX, inv.toPdfX] = [op.toPdfX, op.prevPdfX];
      [inv.prevPdfY, inv.toPdfY] = [op.toPdfY, op.prevPdfY];
      break;
    case "resizeFreehand":
      [inv.prevW, inv.toW] = [op.toW, op.prevW];
      [inv.prevH, inv.toH] = [op.toH, op.prevH];
      [inv.prevPdfW, inv.toPdfW] = [op.toPdfW, op.prevPdfW];
      [inv.prevPdfH, inv.toPdfH] = [op.toPdfH, op.prevPdfH];

      // 【✅ 追記】パスデータを入れ替える
      [inv.prevPaths, inv.nextPaths] = [op.nextPaths, op.prevPaths];
      break;
  }
  return inv;
}

// 操作の実行
export function doOp(op) {
  console.log("doOp called:", op);
  exec(op);
  state.undoStack.push(invert(op));
  state.redoStack.length = 0;
  scheduleSave();
  if (op.note?.classList.contains("highlight")) saveAllHighlights();
}

// 元に戻す ＆ やり直す
export function undo() {
  const op = state.undoStack.pop();
  if (!op) return;
  console.log("undo op:", op);
  exec(op);
  state.redoStack.push(invert(op));
  scheduleSave();
}

export function redo() {
  const op = state.redoStack.pop();
  if (!op) return;
  console.log("redo op:", op);
  exec(op);
  state.undoStack.push(invert(op));
  scheduleSave();
}