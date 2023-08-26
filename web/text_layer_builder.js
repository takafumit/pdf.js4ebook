/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// eslint-disable-next-line max-len
/** @typedef {import("../src/display/display_utils").PageViewport} PageViewport */
/** @typedef {import("../src/display/api").TextContent} TextContent */
/** @typedef {import("./text_highlighter").TextHighlighter} TextHighlighter */
// eslint-disable-next-line max-len
/** @typedef {import("./text_accessibility.js").TextAccessibilityManager} TextAccessibilityManager */

import { normalizeUnicode, renderTextLayer, updateTextLayer } from "pdfjs-lib";
import { removeNullCharacters } from "./ui_utils.js";

/**
 * @typedef {Object} TextLayerBuilderOptions
 * @property {TextHighlighter} highlighter - Optional object that will handle
 *   highlighting text from the find controller.
 * @property {TextAccessibilityManager} [accessibilityManager]
 * @property {boolean} [isOffscreenCanvasSupported] - Allows to use an
 *   OffscreenCanvas if needed.
 */

/**
 * The text layer builder provides text selection functionality for the PDF.
 * It does this by creating overlay divs over the PDF's text. These divs
 * contain text that matches the PDF text they are overlaying.
 */
class TextLayerBuilder {
  #enablePermissions = false;

  #rotation = 0;

  #scale = 0;

  #textContentSource = null;

  constructor({
    highlighter = null,
    pageIndex,
    accessibilityManager = null,
    isOffscreenCanvasSupported = true,
    enablePermissions = false,
  }) {
    this.textContentItemsStr = [];
    this.renderingDone = false;
    
    this.textDivs = [];
    this.textDivProperties = new WeakMap();
    this.textLayerRenderTask = null;
    this.pageNumber = pageIndex + 1;
    this.highlighter = highlighter;
    this.accessibilityManager = accessibilityManager;
    this.isOffscreenCanvasSupported = isOffscreenCanvasSupported;
    this.#enablePermissions = enablePermissions === true;
    this.mouseDownTarget = null;
    this.mouseDownX = -1;
    this.mouseDownY = -1;
    this.div = document.createElement("div");
    this.div.className = "textLayer";
    this.hide();
  }

  #finishRendering() {
    this.renderingDone = true;

    const endOfContent = document.createElement("div");
    endOfContent.className = "endOfContent";
    this.div.append(endOfContent);

    this.#bindMouse();
  }

  get numTextDivs() {
    return this.textDivs.length;
  }

  /**
   * Renders the text layer.
   * @param {PageViewport} viewport
   */
  async render(viewport) {
    if (!this.#textContentSource) {
      throw new Error('No "textContentSource" parameter specified.');
    }

    const scale = viewport.scale * (globalThis.devicePixelRatio || 1);
    const { rotation } = viewport;
    if (this.renderingDone) {
      const mustRotate = rotation !== this.#rotation;
      const mustRescale = scale !== this.#scale;
      if (mustRotate || mustRescale) {
        this.hide();
        updateTextLayer({
          container: this.div,
          viewport,
          textDivs: this.textDivs,
          textDivProperties: this.textDivProperties,
          isOffscreenCanvasSupported: this.isOffscreenCanvasSupported,
          mustRescale,
          mustRotate,
        });
        this.#scale = scale;
        this.#rotation = rotation;
      }
      this.show();
      return;
    }

    this.cancel();
    this.highlighter?.setTextMapping(this.textDivs, this.textContentItemsStr);
    this.accessibilityManager?.setTextMapping(this.textDivs);

    this.textLayerRenderTask = renderTextLayer({
      textContentSource: this.#textContentSource,
      container: this.div,
      viewport,
      textDivs: this.textDivs,
      textDivProperties: this.textDivProperties,
      textContentItemsStr: this.textContentItemsStr,
      isOffscreenCanvasSupported: this.isOffscreenCanvasSupported,
    });

    await this.textLayerRenderTask.promise;
    this.#finishRendering();
    this.#scale = scale;
    this.#rotation = rotation;
    this.show();
    this.accessibilityManager?.enable();
  }

  hide() {
    if (!this.div.hidden) {
      // We turn off the highlighter in order to avoid to scroll into view an
      // element of the text layer which could be hidden.
      this.highlighter?.disable();
      this.div.hidden = true;
    }
  }

  show() {
    if (this.div.hidden && this.renderingDone) {
      this.div.hidden = false;
      this.highlighter?.enable();
    }
  }

  /**
   * Cancel rendering of the text layer.
   */
  cancel() {
    if (this.textLayerRenderTask) {
      this.textLayerRenderTask.cancel();
      this.textLayerRenderTask = null;
    }
    this.highlighter?.disable();
    this.accessibilityManager?.disable();
    this.textContentItemsStr.length = 0;
    this.textDivs.length = 0;
    this.textDivProperties = new WeakMap();
  }

  /**
   * @param {ReadableStream | TextContent} source
   */
  setTextContentSource(source) {
    this.cancel();
    this.#textContentSource = source;
  }
  _addHighlight(pageNumber, note, text, fullText, beginDivIdx, beginOffset, endDivIdx, endDivOffset, top, left, width, height) {//top, left, width, height
    
    let highlight = {
      id: PDFViewerApplication.nextHighlightId++,//仮
      userId: PDFViewerApplication.userId,
      materialId: PDFViewerApplication.materialId,
      page: pageNumber,
      createTime: "",
      note: note,
      text: text,
      fullText: fullText,
      begin: {
        divIdx: beginDivIdx,
        offset: beginOffset
      },
      end: {
        divIdx: endDivIdx,
        offset: endDivOffset
      },
      top: top,
      left: left,
      width: width,
      height: height
    }

    if(PDFViewerApplication.markerMode){
    
    //ここでサーバに送信し、idを返却してもらう
    //仮idの値をnullに変更
    PDFViewerApplication.addHighlight(highlight).done(function(result) {
        highlight.id = result;
      }).fail(function(result) {
        alert("Connection error.")
      }).always(function (result) {
          // 常に実行する処理
      });
      
      PDFViewerApplication.pdfViewer.getPageView(this.pageNumber-1).addHighlight(highlight);//PDFPageViewにadd/removeHighlights()を作成
    }
    
  }
  
  /**
   * Improves text selection by adding an additional div where the mouse was
   * clicked. This reduces flickering of the content if the mouse is slowly
   * dragged up or down.
   */
  #bindMouse() {
    const { div } = this;

    div.addEventListener("mousedown", evt => {
      const end = div.querySelector(".endOfContent");
      if (!end) {
        return;
      }
      if (typeof PDFJSDev === "undefined" || !PDFJSDev.test("MOZCENTRAL")) {
        // On non-Firefox browsers, the selection will feel better if the height
        // of the `endOfContent` div is adjusted to start at mouse click
        // location. This avoids flickering when the selection moves up.
        // However it does not work when selection is started on empty space.
        let adjustTop = evt.target !== div;
        if (typeof PDFJSDev === "undefined" || PDFJSDev.test("GENERIC")) {
          adjustTop &&=
            getComputedStyle(end).getPropertyValue("-moz-user-select") !==
            "none";
        }
        if (adjustTop) {
          const divBounds = div.getBoundingClientRect();
          const r = Math.max(0, (evt.pageY - divBounds.top) / divBounds.height);
          end.style.top = (r * 100).toFixed(2) + "%";
        }
      }
      end.classList.add("active");
    });

      //diffとったらここ追加されてた→どこがquestionに必要?
      div.addEventListener("mouseup", evt => {
      if (this.enhanceTextSelection && this.textLayerRenderTask) {
        if (typeof PDFJSDev === "undefined" || !PDFJSDev.test("MOZCENTRAL")) {
          expandDivsTimer = setTimeout(() => {
            if (this.textLayerRenderTask) {
              this.textLayerRenderTask.expandTextDivs(false);
            }
            expandDivsTimer = null;
          }, EXPAND_DIVS_TIMEOUT);
        } else {
          this.textLayerRenderTask.expandTextDivs(false);
        }
        return;
      }

      let s = window.getSelection();
      let isToAddTextHighlight = s.toString().length !== 0;

      isToAddTextHighlight = isToAddTextHighlight && this.mouseDownTarget.id.split(":")[0] == "text";
      isToAddTextHighlight = isToAddTextHighlight && evt.target.id.split(":")[0] == "text";

      if (isToAddTextHighlight) {
        let startId = this.mouseDownTarget.id.split(":")[1];
        let endId = evt.target.id.split(":")[1];

        let anchorOffset = s.anchorOffset;
        let focusOffset = s.focusOffset;

        if (Number(startId) == Number(endId) && anchorOffset > focusOffset) {
          let tmp = anchorOffset;
          anchorOffset = focusOffset;
          focusOffset = tmp;
        }

        if (Number(startId) > Number(endId)) {
          let tmp = startId;
          startId = endId;
          endId = tmp;
          tmp = anchorOffset;
          anchorOffset = focusOffset;
          focusOffset = tmp;
        }

        let fulltext = "";
        for (let i = startId, ii = endId; i <= ii; i++) {
          fulltext = fulltext + this.textContentItemsStr[i];
        }

        this._addHighlight(this.pageNumber-1, "note", s.toString(), fulltext, startId, anchorOffset, endId, focusOffset, -1, -1, -1, -1);

      }
      else{
        const mouseUpX = 100*evt.offsetX/div.offsetWidth;
        const mouseUpY = 100*evt.offsetY/div.offsetHeight;
        const width = Math.abs(this.mouseDownX - mouseUpX);
        const height = Math.abs(this.mouseDownY - mouseUpY);
        const top = Math.min(this.mouseDownY, mouseUpY);
        const left = Math.min(this.mouseDownX, mouseUpX);
        if(width >= 2 && height >= 2){
          this._addHighlight(this.pageNumber-1, "note", "freebox", "none", -1, -1, -1, -1, top, left, width, height);
        }
      }


      const end = div.querySelector(".endOfContent");
      if (!end) {
        return;
      }

      this.mouseDownTarget == null;
      this.mouseDownX = null;
      this.mouseDownY = null;

      if (typeof PDFJSDev === "undefined" || !PDFJSDev.test("MOZCENTRAL")) {
        end.style.top = "";
      }
      end.classList.remove("active");
    });

    div.addEventListener("copy", event => {
      if (!this.#enablePermissions) {
        const selection = document.getSelection();
        event.clipboardData.setData(
          "text/plain",
          removeNullCharacters(normalizeUnicode(selection.toString()))
        );
      }
      event.preventDefault();
      event.stopPropagation();
    });
  }
}

export { TextLayerBuilder };
