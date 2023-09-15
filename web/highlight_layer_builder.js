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
import { PDFViewerApplication } from "./app";

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
class HighlightLayerBuilder {
  #enablePermissions = false;

  #rotation = 0;

  #scale = 0;

  #textContentSource = null;

  constructor({
    highlights,
    pageIndex,
    viewport,
    highlighter = null,
    accessibilityManager = null,
    isOffscreenCanvasSupported = true,
    enablePermissions = false,
  }) {
    this.textContentItemsStr = [];
    this.renderingDone = false;
    this.highlights = highlights;
    console.log("Cons.:"+JSON.stringify(highlights));
    
    this.textDivs = [];
    this.textDivProperties = new WeakMap();
    this.textLayerRenderTask = null;
    this.pageNumber = pageIndex + 1;
    this.highlighter = highlighter;
    this.viewport = viewport;
    this.accessibilityManager = accessibilityManager;
    this.isOffscreenCanvasSupported = isOffscreenCanvasSupported;
    this.#enablePermissions = enablePermissions === true;
    this.mouseDownTarget = null;
    this.mouseDownX = -1;
    this.mouseDownY = -1;
    this.div = document.createElement("div");
    this.div.className = "textLayer";
    this.hide();
    this.mouseDownTarget = null;
    this.contextMenu = document.getElementById('conmenu');
    this.noteArea = document.getElementById('notearea');
    this.div.addEventListener('click',function (e){
      //メニューとノートエリアを非表示にさせる
      const conmenu = document.getElementById('conmenu');
      conmenu.parentNode.removeChild(conmenu);
      const notearea = document.getElementById('notearea');
      notearea.parentNode.removeChild(notearea);
    });
    if(PDFViewerApplication.markerManageMode||PDFViewerApplication.questionManageMode){ //またはquestionManageModeがTrueの場合に変更
      this.div.style.zIndex=1;
    }
    else{
      this.div.style.zIndex=4;    //zIndex=3から4に変更
    }
  }
  removeHighlight(pageIdx,highlight){
    PDFViewerApplication.pdfViewer.getPageView(pageIdx).removeHighlight(highlight);
  }

  updateNote(pageIdx,highlight, note){
    PDFViewerApplication.pdfViewer.getPageView(pageIdx).updateNote(highlight, note);
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

  _renderHighlights(highlights) {
    const {
      textLayerDiv,
      findController,
      pageIdx,
      textContentItemsStr,
      textDivs,
      removeHighlight,
      updateNote,
    } = this;
    console.log( "_renderHighlights: page="+pageIdx);
    
    if (!this.renderingDone) {
      return;
    }

    const infinity = {
      divIdx: -1,
      offset: undefined
    };

    function appendHighlightDiv(highlight, divIdx, fromOffset, toOffset) {

      const div = textDivs[divIdx];
      

      //テキストの文字数を取得
      const characterCount = div.firstChild.textContent.length;
      if(fromOffset == undefined) fromOffset = characterCount;
      if(toOffset == undefined) toOffset = characterCount;


      //scaleXを取得
      //TODO Y方向のscaleおよび回転に対応する必要がある
      let divTransformX = 1.0;
      if (div.style.transform) {
        divTransformX = Number(div.style.transform.split('(')[1].split(')')[0]);
        console.log(divTransformX);
      }

      //オフセットを計算
      const offsetRange = document.createRange();
      offsetRange.setStart(div.firstChild, 0);
      offsetRange.setEnd(div.firstChild, fromOffset);
      const offsetRect = offsetRange.getBoundingClientRect(); console.log("offset t=" + offsetRect.top + ", l=" + offsetRect.left + ", w=" + offsetRect.width + ", h=" + offsetRect.height);
      const offset = (offsetRect.width / divTransformX);


      //ハイライト対象の矩形を取得
      const range = document.createRange();
      range.setStart(div.firstChild, fromOffset);
      range.setEnd(div.firstChild, toOffset);
      const textRect = range.getBoundingClientRect();
      

      //ハイライトdivを作成してテキストに追加
      const highlightBox = document.createElement('div');
      highlightBox.className = "highlightBox";
      highlightBox.style.top = -(textRect.height * 0.2) + "px";
      highlightBox.style.left = offset + "px";
      highlightBox.style.width = (textRect.width / divTransformX) + "px";
      highlightBox.style.height = textRect.height + "px";
      highlightBox.setAttribute('highlight', JSON.stringify(highlight));

      highlightBox.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(highlight, e.pageY, e.pageX);
      });

      div.appendChild(highlightBox);
    }

    function showContextMenu(highlight, top, left){
      //const con = document.getElementById('conmenu');
      const con = document.createElement('div');
      con.setAttribute('id',"conmenu");
      con.addEventListener('click', (e)=>{
        e.preventDefault();
        e.stopPropagation();
      })
      textLayerDiv.appendChild(con);

      const list = document.createElement('ul');
      con.appendChild(list);

      const li1 = document.createElement('li');
      list.appendChild(li1);
      const li1body = document.createElement('div');
      li1body.setAttribute('id', "editNote");
      li1body.innerHTML="ノートを編集";
      li1.appendChild(li1body);

      const li2 = document.createElement('li');
      list.appendChild(li2);
      const li2body = document.createElement('div');
      li2body.setAttribute('id', "removeHighlight");
      li2body.innerHTML="ハイライトを削除";
      li2.appendChild(li2body);

      const notearea = document.createElement('div');
      notearea.setAttribute('id', "notearea");
      notearea.addEventListener('click', (e)=>{
        e.preventDefault();
        e.stopPropagation();
      })
      const note = document.createElement('textarea');
      note.setAttribute('id', "note");
      notearea.appendChild(note);

      textLayerDiv.appendChild(notearea);
      
      con.style.left = left + 'px';
      con.style.top = top + 'px';

      li1body.addEventListener('click', function (e) {
        con.classList.remove('show');
        notearea.style.left = e.pageX + 'px';
        notearea.style.top = e.pageY + 'px';
        note.value = highlight.note;
        note.addEventListener('blur', function(e){          
          console.log("highlightBox:" + JSON.stringify(highlight));
          highlight.note=note.value;
          PDFViewerApplication.updateHighlight(highlight);
        });
        notearea.classList.add('show');
        console.log("highlightBox:" + JSON.stringify(highlight));
      });


      li2body.addEventListener('click',function(){
        removeHighlight(pageIdx,highlight);
        con.classList.remove('show');
        console.log("highlightBox:"+JSON.stringify(highlight));
      });
      //メニューをblockで表示
      con.classList.add('show');
    }

    

    function appendHighlightDivBox(highlight, top, left, width, height) {
      //ハイライトdivを作成してテキストに追加
      const highlightBox = document.createElement('div');
      highlightBox.className = "highlightBox";
      highlightBox.style.top = textLayerDiv.offsetHeight*top/100.0+ "px";
      highlightBox.style.left = textLayerDiv.offsetWidth*left/100.0 + "px";
      highlightBox.style.width = textLayerDiv.offsetWidth*width/100.0 + "px";
      highlightBox.style.height = textLayerDiv.offsetHeight*height/100.0 + "px";
      highlightBox.setAttribute('highlight', JSON.stringify(highlight));

      highlightBox.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(highlight, e.pageY, e.pageX);
      });

      textLayerDiv.appendChild(highlightBox);
    }

    //highlightsを描画

    console.log("highlights:"+JSON.stringify(highlights));
    const ii = Object.keys(highlights).length;
    for (let i = 0 ; i < ii; i++) {
      console.log("render:"+JSON.stringify(highlights[i]));
      const highlight = highlights[i];
      if(Number(highlight.page) !== pageIdx){
        continue;
      }
      const begin = highlight.begin;
      const end = highlight.end;

      if (begin.divIdx>=0 && end.divIdx>=0) {

        if (begin.divIdx === end.divIdx) {
          //1個のdiv内に収まっている場合
          appendHighlightDiv(highlight, begin.divIdx, begin.offset, end.offset);
        } else {
          //先頭div
          appendHighlightDiv(highlight, begin.divIdx, begin.offset, infinity.offset);
          for (let n0 = Number(begin.divIdx) + 1, n1 = Number(end.divIdx); n0 < n1; n0++) {
            //中間div
            appendHighlightDiv(highlight, n0, 0, infinity.offset);
          }
          //末尾div
          appendHighlightDiv(highlight, end.divIdx, 0, end.offset);
        }
      }
      else{
        //ハイライトボックスを追加
        console.log("highlightBox");
        appendHighlightDivBox(highlight, highlight.top, highlight.left, highlight.width ,highlight.height);
      }

    }
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

export { HighlightLayerBuilder };
