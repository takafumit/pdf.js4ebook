import { state, $, highlightColors } from './noteExtension.js';
import { saveAllHighlights } from './highlightMode.js';
import { scheduleSave } from './noteAndHighlightManager.js';
import { deleteGroupLocally, saveGroupLocally, freehandMode } from './freehandMode.js';

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
  deleteFreehand: (el, parent, data) => ({ action: "deleteFreehand", note: el, parent, data })
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