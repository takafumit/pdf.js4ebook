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
class QuestionLayerBuilder {
  #enablePermissions = false;

  #rotation = 0;

  #scale = 0;

  #textContentSource = null;

  constructor({
    questions,
    pageIndex,
    accessibilityManager = null,
    isOffscreenCanvasSupported = true,
    enablePermissions = false,
  }) {
    this.textContentItemsStr = [];
    this.renderingDone = false;
    this.questions = questions; //highlightsだったが変更
    console.log("Cons.:" + JSON.stringify(questions));    //highlightsだったが変更
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
    this.mouseDownTarget = null;
    this.contextMenu = document.getElementById('conmenu');
    this.noteArea = document.getElementById('notearea');
    this.textLayerDiv.addEventListener('click', function (e) {
      //メニューとノートエリアを非表示にさせる
      const conmenu = document.getElementById('conmenu');
      if (conmenu) {
        conmenu.parentNode.removeChild(conmenu);
      }
      const notearea = document.getElementById('notearea');
      if (notearea) {
        notearea.parentNode.removeChild(notearea);
      }
    });
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
   //★Question用に追加
  /**
   * 
   * @param {*} pageNumber 
   * @param {*} note 
   * @param {*} text 
   * @param {*} fullText 
   * @param {*} beginDivIdx 
   * @param {*} beginOffset 
   * @param {*} endDivIdx 
   * @param {*} endDivOffset 
   * @param {*} top 
   * @param {*} left 
   * @param {*} width 
   * @param {*} height 
   * @return
   */
  _addQuestion(pageNumber, note, text, fullText, beginDivIdx, beginOffset, endDivIdx, endDivOffset, top, left, width, height) {//top, left, width, height

    let question = {
      id: PDFViewerApplication.nextQuestionId++,//仮
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

    if (PDFViewerApplication.questionMode) {


        //ここでサーバに送信し、idを返却してもらう
        //仮idの値をnullに変更  
        PDFViewerApplication.addQuestion(question).done(function (result) {
          question.id = result;
        }).fail(function (result) {
          alert("Connection error.")
        }).always(function (result) {
          // 常に実行する処理
        });
      

      PDFViewerApplication.pdfViewer.getPageView(this.pageNumber - 1).addQuestion(question);//PDFPageViewにadd/removeHighlights()を作成


    }



  }
  removeQuestion(pageIdx, question) {  //highlightだったが変更(sはついてなかった)
    PDFViewerApplication.pdfViewer.getPageView(pageIdx).removeQuestion(question);  //highlightだったが変更

  }

  updateNote(pageIdx, question, note) {
    PDFViewerApplication.pdfViewer.getPageView(pageIdx).updateNote(question, note);
  }

  /**
   * Improves text selection by adding an additional div where the mouse was
   * clicked. This reduces flickering of the content if the mouse is slowly
   * dragged up or down.
   */
  #bindMouse() {
    const { div } = this;

    div.addEventListener("mousedown", evt => {
      // console.log("139");
      if (this.enhanceTextSelection && this.textLayerRenderTask) {
        this.textLayerRenderTask.expandTextDivs(true);
        if (
          (typeof PDFJSDev === "undefined" || !PDFJSDev.test("MOZCENTRAL")) &&
          expandDivsTimer
        ) {
          clearTimeout(expandDivsTimer);
          expandDivsTimer = null;
        }
        return;
      }
      const end = div.querySelector(".endOfContent");
      this.mouseDownTarget = evt.target;
      console.log(this.mouseDownTarget);
      //this.mouseDownX = 100*(evt.offsetX/div.offsetWidth);
      //this.mouseDownY = 100*(evt.offsetY/div.offsetHeight);
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

        //複数行は登録されないように変更　2023/04/27
        if(s?.anchorNode?.parentElement?.style?.top || s?.focusNode?.parentElement?.style?.top) { //値あるか確認
          if(s.anchorNode.parentElement.style.top === s.focusNode.parentElement.style.top){
            this._addQuestion(this.pageNumber - 1, "note", s.toString(), fulltext, startId, anchorOffset, endId, focusOffset, -1, -1, -1, -1);
}
        }
      }
      // else{
      //   const mouseUpX = 100*evt.offsetX/div.offsetWidth;
      //   const mouseUpY = 100*evt.offsetY/div.offsetHeight;
      //   const width = Math.abs(this.mouseDownX - mouseUpX);
      //   const height = Math.abs(this.mouseDownY - mouseUpY);
      //   const top = Math.min(this.mouseDownY, mouseUpY);
      //   const left = Math.min(this.mouseDownX, mouseUpX);
      //   if(width >= 2 && height >= 2){
      //     this._addHighlight(this.pageNumber-1, "note", "freebox", "none", -1, -1, -1, -1, top, left, width, height);
      //   }
      // }


      const end = div.querySelector(".endOfContent");
      if (!end) {
        return;
      }

      this.mouseDownTarget == null;
      // this.mouseDownX = null;
      // this.mouseDownY = null;

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
  _finishRendering() {
    this.renderingDone = true;

    if (!this.enhanceTextSelection) {
      const endOfContent = document.createElement("div");
      endOfContent.className = "endOfContent";
      this.textLayerDiv.appendChild(endOfContent);
    }

    this.eventBus.dispatch("questionlayerrendered", {//highlightlayerrenderedを作成する必要がある
      source: this,
      pageNumber: this.pageNumber,
      numTextDivs: this.textDivs.length
    });
  }

  _renderQuestions(questions) {  //questionsに変更
    const {
      textLayerDiv,
      findController,
      pageIdx,
      textContentItemsStr,
      textDivs,
      removeQuestion,
      updateNote,
    } = this;
    console.log("_renderQuestions: page=" + pageIdx);

    if (!this.renderingDone) {
      return;
    }

    const infinity = {
      divIdx: -1,
      offset: undefined
    };







    function appendQuestionDiv(question, divIdx, fromOffset, toOffset) { //questionに変更(sはなし)→これは一つのdivを受け取ったときに実行


      const div = textDivs[divIdx];
      var { offset, textRect, divTransformX } = coordinateCalculation(div, fromOffset, toOffset); //作ったメソッドに渡す
      offset /= divTransformX;
      textRect.x /= divTransformX;
      textRect.width /= divTransformX; 
      let userType;//追加
      const queryString = document.location.search.substring(1);
      const params = parseQueryString(queryString);
      userType = params.get("usertype") ?? -1;//追加
      console.log(userType);
      //ハイライトdivを作成してテキストに追加
      let questionBox = document.createElement('div'); //クエスチョンボックスに変更
      questionBox.className = "questionBox";

      questionBox.style.top = -(textRect.height * 0.2) + "px";
      questionBox.style.left = offset + "px";
      questionBox.style.height = textRect.height + "px";   //追加
      questionBox.style.width = textRect.width + "px";  //枠ずれないよう修正2023/04/20


      let inputAns = document.createElement("input"); //テキストボックスを作成
      inputAns.id = "inputAns" + question.id;  //idをinputAnsにidを足した文字列に設定→一意にする
      inputAns.autocomplete = "off";
      inputAns.type = "text";
      console.log(question.id);
      if (!(isNaN(question.id))) {  //enteredAnsが出ないようにNaNの場合は実行しない
        PDFViewerApplication.getQuestionInput(question.materialId, question.id).done(function (result) {
          if (result == "null") {      //result=="null"か？//if(isNaN(result)か？→ここおかしい
            inputAns.value = "";
          } else {
            //var encoder = new TextEncoder('utf-8');
            //inputAns.value = encoder.encode(result);
            inputAns.value = result;
          }
          //   console.log("enteredAns:"+enteredAns);
        }).fail(function (result) {
          alert("Connection error(enteredAns).")
        }).always(function (result) {
          // 常に実行する処理
        });


        inputAns.style.top = -(textRect.height * 0.2) + "px";
        inputAns.style.left = offset + "px";
        inputAns.style.width = (textRect.width / divTransformX) + "px";
        inputAns.style.height = textRect.height + "px";
        inputAns.setAttribute('question', JSON.stringify(question));   //questionに変更


        /*送信ボタン*/ //テストでコメントアウト
        let sendAns = document.createElement("button"); //ボタン作成
        inputAns.id = "sendAns" + question.id;  //追加
        //sendAns.style.top = -(textRect.height * 0.2) + "px"; 
        //sendAns.style.left = offset+inputAns.width+"px";  //左からの距離にテキストボックスの横の長さ文を足したところにボタン配置
        sendAns.style.width = 50 + "px"; //試しに50pxにしとく
        sendAns.style.height = textRect.height + "px";
        sendAns.style.visibility = "hidden";
        sendAns.innerText = "送信";
        /****/



        //ここからは学生と共通の処理
        //inputProcessing(question.id);
        inputAns.addEventListener('click', function (e) {
          e.preventDefault();
          e.stopPropagation();
          sendAns.style.visibility = "visible"; //空欄クリックでボタン表示
          if (PDFViewerApplication.questionManageMode) {    //もしもquestionManageModeがONならに変更
            showContextMenu(question, e.pageY, e.pageX);  //↑ならメニューを表示する
          }
        });


        //Enterキーで送信する用
        inputAns.addEventListener('keypress', test_ivent);
        function test_ivent(e) {
          if (e.keyCode === 13) {
            let inputAnswer = document.getElementById(inputAns.id);
            PDFViewerApplication.updateInputAns(question.id, inputAnswer.value);
          }
        }

        //自動補完されないように修正
        inputAns.addEventListener("mousedown", function(e){
          setTimeout(function(){
            inputAns.focus();
          }, 1);
          e.preventDefault();
        });

        //リスナー追加
        sendAns.addEventListener('click', function (e) {
          let inputAnswer = document.getElementById(inputAns.id);  //inputAnsをここでとるが、inputAnsが複数あるためエラーが出る。→修正済
          PDFViewerApplication.updateInputAns(question.id, inputAnswer.value); //これでいけるのか？？？これでテキストボックスの値を更新
        });


        //追加→送信ボタンからフォーカスアウトしたらボタンを非表示にする
        sendAns.addEventListener('focusout', function (e) {
          sendAns.style.visibility = "hidden";
        });

        questionBox.appendChild(inputAns);  //確認
        questionBox.appendChild(sendAns);
        div.appendChild(questionBox);


      }

    }

    //ここから追加した
    /**
     * 
     * @param {*} question 
     * @param {*} divIdxes 
     * @param {Number} fromOffset 
     * @param {Number} toOffset 
     * @return
     */
    function appendQuestionDivs(question, divIdxes, fromOffset, toOffset) { //複数のdiv追加するとき


      let userType;//追加
      const queryString = document.location.search.substring(1);
      const params = parseQueryString(queryString);
      userType = params.get("usertype") ?? -1;//追加



      const beginDiv = textDivs[divIdxes[0]]; //複数あるdivのうち、文字の始まりのdiv
      var { offset: beginOffset, textRect: beginTextRect, divTransformX: beginDivTransformX } = coordinateCalculation(beginDiv, fromOffset, undefined); //作ったメソッドに渡す
      beginOffset /= beginDivTransformX;
      beginTextRect.x /= beginDivTransformX;
      beginTextRect.width /= beginDivTransformX; 
      const endDiv = textDivs[divIdxes[divIdxes.length - 1]]; //複数あるdivのうち、文字の終わりのdiv
      var { offset: endOffset, textRect: endTextRect, divTransformX: endDivTransformX } = coordinateCalculation(endDiv, undefined, toOffset); //作ったメソッドに渡す
      endOffset /= beginDivTransformX;
      endTextRect.x /= beginDivTransformX;
      endTextRect.width /= beginDivTransformX; 
      if (beginTextRect.top !== endTextRect.top) {  //2行なら何もしない
        return;
      }


      //クエスチョンdivを作成してテキストに追加
      const questionBox = document.createElement('div'); //クエスチョンボックスに変更
      questionBox.className = "questionBox";
      questionBox.style.top = -(beginTextRect.height * 0.2) + "px";  //最初のdivの上からの距離に設定
      questionBox.style.left = beginOffset + "px";  //左からの距離は最初のdivの左からの距離
      questionBox.style.height = beginTextRect.height + "px";   //最初のdivの高さに設定？要確認
      //questionBox.style.width = (textRect.width / divTransformX) + "px";  //ここを変える必要がある
      questionBox.style.width =(endTextRect.x + endTextRect.width- beginTextRect.x ) + "px"; //送信ボタン分引く //枠ずれないよう修正2023/04/20
      //enteredAns = "答えを入力";  //ここに入力された文字列を入れる
      const inputAns = document.createElement("input"); //テキストボックスを作成
      inputAns.id = "inputAns" + question.id;  //idをinputAnsにidを足した文字列に設定→一意にする
      inputAns.autocomplete = "off";
      inputAns.type = "text";
      //inputAns.value = enteredAns;
      if (!(isNaN(question.id))) {  //enteredAnsが出ないようにNaNの場合は実行しない
        PDFViewerApplication.getQuestionInput(question.materialId, question.id).done(function (result) {
          if (result == "null") {      //result=="null"か？//if(isNaN(result)か？
            inputAns.value = "";
          } else {
            //var encoder = new TextEncoder('utf-8');
            //inputAns.value = encoder.encode(result);
            inputAns.value = result;
          }
          //   console.log("enteredAns:"+enteredAns);
        }).fail(function (result) {
          alert("Connection error(enteredAns).")
        }).always(function (result) {
          // 常に実行する処理
        });
      }

      inputAns.style.top = -(beginTextRect.height * 0.2) + "px";
      inputAns.style.left = beginOffset + "px";
      //inputAns.style.width = ((endOffset+endTextRect.width)/endDivTransformX)-50 + "px"; //送信ボタン分の横の長さを引く
      inputAns.style.width = (endTextRect.x + endTextRect.width- beginTextRect.x) + "px"; //枠ずれないよう修正2023/04/20
      inputAns.style.height = beginTextRect.height + "px";
      inputAns.setAttribute('question', JSON.stringify(question));   //questionに変更


      inputAns.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        sendAns.style.visibility = "visible"; //空欄クリックでボタン表示
        if (PDFViewerApplication.questionManageMode) {    //もしもquestionManageModeがONならに変更
          showContextMenu(question, e.pageY, e.pageX);  //↑ならメニューを表示する
        }
      });

      //Enterキーで送信する用
      inputAns.addEventListener('keypress', test_ivent);
      function test_ivent(e) {
        if (e.keyCode === 13) {
          let inputAnswer = document.getElementById(inputAns.id);
          PDFViewerApplication.updateInputAns(question.id, inputAnswer.value);
        }
      }

      //自動補完されないように修正
      inputAns.addEventListener("mousedown", function(e){
        setTimeout(function(){
          inputAns.focus();
        }, 1);
        e.preventDefault();
      });
      // //穴埋めをクリックしたら表示
      // inputAns.addEventListener('focus',function(e){
      //   sendAns.style.visibility="visible";
      // });
      // //クリックしていなければ表示しない→inputAnsフォーカスアウトしたら押せないのでは？
      // inputAns.addEventListener('focusout',function(e){
      //   sendAns.style.visibility="hidden";
      // });

      /*送信ボタン*/
      const sendAns = document.createElement("button"); //ボタン作成
      //sendAns.style.top = -(endTextRect.height * 0.2) + "px"; 
      //sendAns.style.left = endOffset+inputAns.width+"px";  //左からの距離にテキストボックスの横の長さ文を足したところにボタン配置
      sendAns.style.width = 50 + "px"; //試しに50pxにしとく
      sendAns.style.height = endTextRect.height + "px";
      sendAns.style.visibility = "hidden";
      sendAns.innerText = "送信";
      /****/


      //リスナー追加
      sendAns.addEventListener('click', function (e) {
        let inputAnswer = document.getElementById(inputAns.id);  //inputAnsをここでとるが、inputAnsが複数あるためエラーが出る。→修正済
        PDFViewerApplication.updateInputAns(question.id, inputAnswer.value); //これでいけるのか？？？これでテキストボックスの値を更新
      });



      //追加→送信ボタンからフォーカスアウトしたらボタンを非表示にする
      sendAns.addEventListener('focusout', function (e) {
        sendAns.style.visibility = "hidden";
      });
      questionBox.appendChild(inputAns);  //確認
      questionBox.appendChild(sendAns);
      beginDiv.appendChild(questionBox);

    }

    function showContextMenu(question, top, left) {
      //const con = document.getElementById('conmenu');
      const con = document.createElement('div');
      con.setAttribute('id', "conmenu");
      con.addEventListener('click', (e) => {
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
      li1body.innerHTML = "ノートを編集";
      li1.appendChild(li1body);

      let userType;//追加
      const queryString = document.location.search.substring(1);
      const params = parseQueryString(queryString);
      userType = params.get("usertype") ?? -1;//追加


      if(userType==="1"){
        const li2 = document.createElement('li');
        list.appendChild(li2);
        const li2body = document.createElement('div');
        li2body.setAttribute('id', "removeQuestion"); //Questionに変更
        li2body.innerHTML = "穴埋めを削除"; //ハイライトを削除から変更
        li2.appendChild(li2body);

        li2body.addEventListener('click', function () {
          removeQuestion(pageIdx, question);  //変更
          con.classList.remove('show');
          console.log("questionBox:" + JSON.stringify(question));  //変更
        });
      }else{
        PDFViewerApplication.getQuestionCreateUserType(question.materialId, question.id).done(function (result) {
     
          if (result !== "1") {

          const li2 = document.createElement('li');
          list.appendChild(li2);
          const li2body = document.createElement('div');
          li2body.setAttribute('id', "removeQuestion"); //Questionに変更
          li2body.innerHTML = "穴埋めを削除"; //ハイライトを削除から変更
          li2.appendChild(li2body);

          li2body.addEventListener('click', function () {
            removeQuestion(pageIdx, question);  //変更
            con.classList.remove('show');
            console.log("questionBox:" + JSON.stringify(question));  //変更
          });
        }
       //   console.log("enteredAns:"+enteredAns);
        }).fail(function (result) {
          alert("Connection error(createUserType).")
        }).always(function (result) {
       // 常に実行する処理
        });
      }

      const notearea = document.createElement('div');
      notearea.setAttribute('id', "notearea");
      notearea.addEventListener('click', (e) => {
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
        note.value = question.note; //questionに変更
        note.addEventListener('blur', function (e) {
          console.log("questionBox:" + JSON.stringify(question));  //highlightから変更
          question.note = note.value; //変更
          PDFViewerApplication.updateQuestion(question);  //変更
        });
        notearea.classList.add('show');
        console.log("questionBox:" + JSON.stringify(question));  //変更
      });



      //メニューをblockで表示
      con.classList.add('show');
    }
    //apentionDivsここまで



    function coordinateCalculation(div, fromOffset, toOffset) {  //座標を測って返すメソッド

      //テキストの文字数を取得
      const characterCount = div.firstChild.textContent.length; //文字数
      if (fromOffset == undefined) fromOffset = characterCount;
      if (toOffset == undefined) toOffset = characterCount;

      //scaleXを取得
      //scaleが付いた要素が親要素になるため、全部をdivTransformXで割る必要がある！！！！！！！！！！！！！！！
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
      const offset = offsetRect.width;  //穴埋めずれないように変更　2023/04/27

      //ハイライト対象の矩形を取得
      const range = document.createRange();
      range.setStart(div.firstChild, fromOffset);
      range.setEnd(div.firstChild, toOffset);
      const textRect = range.getBoundingClientRect();
      return { offset: offset, textRect: textRect, divTransformX: divTransformX };
    }

    function appendQuestionDivBox(question, top, left, width, height) { //変更→HiglightDivBoxのままかも？
      //ハイライトdivを作成してテキストに追加
      const questionBox = document.createElement('div');
      questionBox.className = "questionBox";
      questionBox.style.top = textLayerDiv.offsetHeight * top / 100.0 + "px";
      questionBox.style.left = textLayerDiv.offsetWidth * left / 100.0 + "px";
      questionBox.style.width = textLayerDiv.offsetWidth * width / 100.0 + "px";
      questionBox.style.height = textLayerDiv.offsetHeight * height / 100.0 + "px";
      questionBox.setAttribute('question', JSON.stringify(question));  //変更

      questionBox.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(question, e.pageY, e.pageX);  //変更
      });

      textLayerDiv.appendChild(questionBox);
    }



    //highlightsを描画

    console.log("questions:" + JSON.stringify(questions));  //変更
    const ii = Object.keys(questions).length; //変更
    for (let i = 0; i < ii; i++) {
      console.log("render:" + JSON.stringify(questions[i]));  //変更
      const question = questions[i];  //変更
      if (Number(question.page) !== pageIdx) {  //変更
        continue;
      }
      const begin = question.begin; //変更
      const end = question.end; //変更

      if (begin.divIdx >= 0 && end.divIdx >= 0) {

        if (begin.divIdx === end.divIdx) {  //要変更→複数のdiv受け取った場合メソッド呼び出す必要がある。
          //1個のdiv内に収まっている場合
          appendQuestionDiv(question, begin.divIdx, begin.offset, end.offset); //変更
        } else {
          let divIdxes = [begin.divIdx, end.divIdx];

          appendQuestionDivs(question, divIdxes, begin.offset, end.offset);  //二番目の引数を変える必要がある
        }
      }
      else {
        //クエスチョンボックスを追加
        console.log("questionBox");
        appendQuestionDivBox(question, question.top, question.left, question.width, question.height);  //要確認QuestionDivBoxかも→変更
      }

    }
  }
}


export { QuestionLayerBuilder };
