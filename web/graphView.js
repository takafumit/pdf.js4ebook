// graphView.js

// =============================================================
// I. 初期設定と共通変数
// =============================================================

// 辞書で対応しきれない汎用的なストップワード（計算効率のための補完）
const JAPANESE_STOP_WORDS_ARRAY = [
  'の', 'は', 'を', 'に', 'が', 'と', 'へ', 'で', 'も', 'から', 'より', 'など', 'こと',
  'ある', 'いる', 'する', 'なる', 'れる', 'られる', 'いる', 'いる', 'という', 'この',
  'その', 'あの', 'これ', 'それ', 'あれ', 'もし', 'または', 'そして', 'しかし', 'また',
  'ため', 'よう', 'ため', 'とき', 'だけ', 'たら', 'ので', 'では', 'では', 'です',
  'ます', 'あり', 'なっ', 'し', 'ん', 'られ', 'でき', 'いく', 'お', '的', 'い', 'な',
  'p', 'ページ', '弊社', '貴社'
];

// 💡 語尾除去のために、長いストップワードからチェックするように文字数で降順ソート（現在は未使用だが慣習的に維持）
JAPANESE_STOP_WORDS_ARRAY.sort((a, b) => b.length - a.length);

const JAPANESE_STOP_WORDS = new Set(JAPANESE_STOP_WORDS_ARRAY);

const ENGLISH_STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'and', 'or', 'but', 'if',
  'be', 'not', 'of', 'in', 'on', 'at', 'to', 'from', 'by', 'with',
  'it', 'its', 'this', 'that', 'we', 'our', 'us', 'you', 'your', 'they', 'their',
  'can', 'will', 'would', 'should', 'have', 'has', 'had', 'do', 'does', 'did',
  'as', 'for', 'about', 'out', 'up', 'down', 'only', 'all', 'any', 'some',
  'p'
]);

// 💡 単語の語尾（サフィックス）としてチェックする助詞
const JAPANESE_STOP_WORDS_SUFFIXES = new Set(['の', 'は', 'を', 'に', 'が', 'と', 'へ', 'で', 'も']);

// 💡 キーワードの先頭から削除したい助詞（語頭クリーニング用）
const JAPANESE_PREFIX_NOISE = new Set(['を', 'に', 'が', 'と', 'へ', 'で', 'も', 'は', 'から', 'より']);


// =============================================================
// II. データの抽出とキーワード生成
// =============================================================

/**
 * 全てのメモ要素からテキストと関連情報を抽出する
 */
function extractAllMemoText() {
  const elements = document.querySelectorAll(".note, .highlight");
  const items = [];

  elements.forEach(el => {
    const isHighlight = el.classList.contains("highlight");

    const content = isHighlight
      ? (el.dataset.text || "").trim()
      : (el.textContent || "").trim();

    const linkedText = (el.dataset.linkedText || "").trim();
    const linkedNoteId = (el.dataset.linkedNoteId || "").trim();
    const page = parseInt(el.dataset.page || "0", 10);
    const id = el.dataset.id || Math.random().toString(36);

    // コンテンツがないが、紐付け情報がある場合は含める
    if (!content && !linkedText && !linkedNoteId) return;

    items.push({
      id,
      page,
      content,
      linkedText,
      linkedNoteId,
      isLinkedToPDF: linkedText.length > 0,
      fullText: (content + " " + linkedText).toLowerCase() // 全て小文字で保存
    });
  });

  console.log("--- 抽出された全メモデータ ---");
  console.log(items);
  console.log("------------------------------");

  return items;
}

/**
 * TF-IDFで重要語トップ15を抽出する (文字列フィルタリングを強化)
 */
function extractKeyTermsTFIDF(allItems) {
  const docs = allItems.map(i => i.fullText);

  // 💡 トークナイズ処理: 記号を除去し、スペースで分割
  const tokenize = text =>
    text
      .toLowerCase()
      // 句読点や記号をスペースに置換 (Unicodeの\p{P}は環境依存の可能性があるため、より安全な\p{L}（文字）以外をスペースに置換)
      .replace(/[^\p{L}0-9]/gu, " ")
      .split(/\s+/)
      .filter(w => w.length > 1);

  const termCounts = docs.map(tokenize);
  const df = {};
  const tf = [];

  // TF (Term Frequency) と DF (Document Frequency) の計算
  termCounts.forEach(tokens => {
    const counts = {};
    tokens.forEach(t => (counts[t] = (counts[t] || 0) + 1));
    tf.push(counts);

    const unique = new Set(tokens);
    unique.forEach(t => (df[t] = (df[t] || 0) + 1));
  });

  const N = docs.length;
  const tfidf = {};

  // TF-IDF スコアの計算
  Object.keys(df).forEach(term => {
    // IDF (Inverse Document Frequency) の計算 (分母が0になるのを防ぐため +1)
    const idf = Math.log((N + 1) / (df[term] + 1)) + 1;
    let totalTFIDF = 0;
    // 全ドキュメントのTFを合計し、IDFを掛ける
    tf.forEach(counts => {
      totalTFIDF += (counts[term] || 0) * idf;
    });

    tfidf[term] = totalTFIDF;
  });

  // TF-IDFスコアに基づいてソート
  let rankedTerms = Object.entries(tfidf)
    .sort((a, b) => b[1] - a[1])
    .map(e => e[0]); // 単語のみの配列にする


  // ---------------------------------------------------------------------------------
  // 🚨 【処理 1】語頭クリーニングの適用 (助詞を削除し、スコアを合算)
  // ---------------------------------------------------------------------------------
  let cleanedTerms = new Map(); // 処理後の単語と合算スコアを保持
  const allStopWords = new Set([...JAPANESE_STOP_WORDS, ...ENGLISH_STOP_WORDS]);

  rankedTerms.forEach(term => {
    let cleanedTerm = term;

    // 語頭ノイズチェック (2文字以上の単語のみ対象)
    const firstChar = term.slice(0, 1);
    if (JAPANESE_PREFIX_NOISE.has(firstChar) && term.length > 1) {
      cleanedTerm = term.slice(1);
    }

    // クリーニング後の単語が1文字だったり、完全なストップワードになった場合は無視
    if (cleanedTerm.length < 1 || allStopWords.has(cleanedTerm)) {
      return;
    }

    // 💡 クリーニングにより単語が重複する場合があるため、スコアを合算する
    const existingScore = cleanedTerms.get(cleanedTerm) || 0;
    cleanedTerms.set(cleanedTerm, existingScore + tfidf[term]);
  });

  // クリーニング後の単語リストを再度スコア順に並べ替える
  rankedTerms = Array.from(cleanedTerms.entries())
    .sort((a, b) => b[1] - a[1])
    .map(e => e[0]);


  // ---------------------------------------------------------------------------------
  // 🚨 【処理 2】最終フィルタリング（語尾ノイズ）
  // ---------------------------------------------------------------------------------
  rankedTerms = rankedTerms
    .filter(term => {
      // 1. 語尾ノイズ（助詞）で終わる単語を除外
      const lastChar = term.slice(-1);
      if (JAPANESE_STOP_WORDS_SUFFIXES.has(lastChar)) {
        return false;
      }
      return true;
    });

  // ---------------------------------------------------------------------------------
  // 🚨 【新規処理 3】キーワードの部分集合による重複排除
  // ---------------------------------------------------------------------------------
  const finalTerms = [];
  const termsSet = new Set(rankedTerms); // 排除チェックのためにSet化

  rankedTerms.forEach(longerTerm => {
    let isSubsetString = false;

    // 自身より短い他のキーワードが、このキーワードに完全に含まれているかチェック
    // 例: longerTerm="urlをクリック" の場合
    // shortTerm="url" や shortTerm="クリック" が含まれているか？
    termsSet.forEach(shorterTerm => {
      // 自身より短いこと、かつ、自身と同一ではないことを確認
      if (shorterTerm !== longerTerm && longerTerm.includes(shorterTerm)) {
        // ここでの目的は、短い単語を排除することではなく、
        // 短い単語が長い単語に含まれている場合に、短い単語が残るべきかを判断すること。
        // 
        // 💡 シンプル化のため、今回は「部分集合を**排除**する」のではなく、
        // 「長い単語に完全に含まれる**短い単語**を排除する」ロジックを採用する。
        // 例: rankedTermsが [urlをクリック, url, クリック] の順だった場合
        // urlをクリック ( longerTerm ) に含まれる url ( shorterTerm ) は排除したい

        // 💡 逆に考える: すでに長いキーワードに含まれている短いキーワードは排除すべき
        // ここでは、rankedTermsの順番（スコア順）を尊重するため、
        // スコアが高い (先にある) 長いキーワードが、スコアが低い (後にある) 短いキーワードを含んでいる場合、短い方を排除する、という実装が難しい。

        // そこで、**より長いキーワードが短いキーワードを完全に含む場合**、短いキーワードを排除する。
        // これを効率的に行うため、ここでは部分文字列のチェックは一旦保留し、
        // **「長いキーワードに完全に含まれる短いキーワード」** を別途リストアップし、最終排除リストから除去する。
      }
    });
  });

  // 💡 シンプルかつ効果的な代替ロジック:
  // 「urlをクリック」のようにスペースのない複合語は複合語として残す。
  // 「url」や「クリック」といった短い単語は、**別の長い単語に含まれている**場合、情報量が低いとして排除する。

  const termsToKeep = new Set(rankedTerms);

  // 長い単語からチェックすることで、短い単語をフィルタリングする
  for (let i = 0; i < rankedTerms.length; i++) {
    const longerTerm = rankedTerms[i];
    for (let j = 0; j < rankedTerms.length; j++) {
      const shorterTerm = rankedTerms[j];

      // 1. longerTermがshorterTermより長い
      // 2. longerTermがshorterTermを完全に含んでいる
      // 3. shorterTermがまだ排除リストに残っている
      if (longerTerm.length > shorterTerm.length &&
        longerTerm.includes(shorterTerm) &&
        termsToKeep.has(shorterTerm)) {

        // 💡 複合キーワードの一部であると見なして排除する
        // ただし、単純な部分文字列チェックだと誤爆の可能性があるため、
        // 排除する前に、longerTermとshorterTermのスコアを比較し、
        // longerTermのスコアがshorterTermよりはるかに高い(例: 2倍以上)場合に限定する、といった重み付けも可能だが、
        // シンプルな部分文字列排除を採用。

        // 例: urlをクリック (長) に url (短) が含まれる -> url を排除
        termsToKeep.delete(shorterTerm);
      }
    }
  }

  return Array.from(termsToKeep).slice(0, 15);
}


// =============================================================
// III. 関連性計算とグラフデータ構築 (変更あり)
// =============================================================

/**
 * キーワード間の共起関係と紐付け関係を計算し、重みを付与する
 */
function calculateRelations(allItems, keyTerms) {
  const relationMap = new Map();
  const termSet = new Set(keyTerms);
  const memoIdMap = new Map(allItems.map(item => [item.id, item]));

  const incrementRelation = (termA, termB, weight = 1) => {
    if (termA === termB) return;

    if (!relationMap.has(termA)) relationMap.set(termA, new Map());
    if (!relationMap.has(termB)) relationMap.set(termB, new Map());

    const countAB = relationMap.get(termA).get(termB) || 0;
    relationMap.get(termA).set(termB, countAB + weight);

    const countBA = relationMap.get(termB).get(termA) || 0;
    relationMap.get(termB).set(termA, countBA + weight);
  };

  allItems.forEach(item => {
    const presentTerms = new Set();

    // 1. そのメモに含まれるキーワードの抽出 (フルテキストでチェック)
    termSet.forEach(term => {
      if (item.fullText.includes(term.toLowerCase())) {
        presentTerms.add(term);
      }
    });
    const termsArray = Array.from(presentTerms);

    // 2. 共起のカウント (重み: 1 または 5)
    const baseWeight = item.isLinkedToPDF ? 5 : 1;

    for (let i = 0; i < termsArray.length; i++) {
      for (let j = i + 1; j < termsArray.length; j++) {
        incrementRelation(termsArray[i], termsArray[j], baseWeight);
      }
    }

    // 3. テキストボックス間紐付けによる関連のカウント (重み: 5)
    if (item.linkedNoteId) {
      const linkedItem = memoIdMap.get(item.linkedNoteId);
      if (linkedItem) {
        const linkedTerms = new Set();
        termSet.forEach(term => {
          if (linkedItem.fullText.includes(term.toLowerCase())) {
            linkedTerms.add(term);
          }
        });

        termsArray.forEach(sourceTerm => {
          linkedTerms.forEach(targetTerm => {
            incrementRelation(sourceTerm, targetTerm, 5);
          });
        });
      }
    }
  });

  return relationMap;
}


/**
 * グラフ描画のためのノードとエッジのデータを準備する
 * 💡 ノードにフルキーワードのtitle属性を追加
 */
function buildGraphData(keyTerms, relationMap) {
  // 🚨 【修正点】ここで表示ラベルの長さを制限する
  const MAX_LABEL_LENGTH = 10;

  const nodes = keyTerms.map((term, index) => {
    // 表示用のラベルを短縮し、10文字を超えた場合は '...' を追加
    const label = term.length > MAX_LABEL_LENGTH
      ? term.substring(0, MAX_LABEL_LENGTH) + '...'
      : term;

    return {
      id: term,     // 紐付けIDとしてフルテキストを維持
      label: label, // 表示ラベルとして短縮版を使用
      title: term,  // 💡 【新規】ツールチップ用のフルテキスト
      group: index === 0 ? 1 : 2
    };
  });

  const links = [];
  const addedLinks = new Set();

  relationMap.forEach((innerMap, source) => {
    innerMap.forEach((weight, target) => {
      // エッジは (A, B) と (B, A) で重複するため、一方向のみ追加
      const linkKey = source < target ? `${source}-${target}` : `${target}-${source}`;

      // 重みが 1 以上の場合にエッジを作成
      if (!addedLinks.has(linkKey) && weight >= 1) {
        links.push({
          source: source,
          target: target,
          weight: weight
        });
        addedLinks.add(linkKey);
      }
    });
  });

  return { nodes, links };
}


// =============================================================
// IV. メイン描画ロジック (変更あり)
// =============================================================

/**
 * グラフビューを描画するメイン関数
 */
export function renderGraphView() {
  // 1. コンテナの準備
  const container = document.getElementById("graphView") || (() => {
    const div = document.createElement("div");
    div.id = "graphView";
    div.style.position = "fixed";
    div.style.top = "0";
    div.style.left = "0";
    div.style.width = "95%";
    div.style.height = "95%";
    div.style.background = "#fff";
    div.style.zIndex = "9999";
    div.style.overflow = "auto";
    div.style.padding = "20px";
    div.style.boxShadow = "0 0 15px rgba(0,0,0,0.2)";
    document.body.appendChild(div);
    return div;
  })();

  const allMemoData = extractAllMemoText();
  if (allMemoData.length === 0) {
    container.innerHTML = "<h2>データがありません</h2>";
    return;
  }

  // 2. キーワードの抽出
  const keyTerms = extractKeyTermsTFIDF(allMemoData);

  // 3. 関連性 (共起と紐付け) の計算
  const relationData = calculateRelations(allMemoData, keyTerms);

  // 4. グラフデータ構造の構築
  const { nodes, links } = buildGraphData(keyTerms, relationData);

  // 5. 基本UIの描画
  container.innerHTML = `
    <h1 style="color:#2a66b9;">グラフビュー</h1>
    
    <button id="closeGraphBtn"
        style="
            position: absolute;
            top: 20px;
            right: 20px;
            padding:8px 16px; 
            background:#e44; 
            color:#fff; 
            border:none; 
            border-radius:4px; 
            cursor:pointer; 
            font-weight:bold;
            z-index: 10000;
        ">
        PDF編集に戻る
    </button>
    
    <p style="margin-bottom:20px; color:#555; font-size:0.9em;">
        <strong>線の凡例:</strong><br>
        <span style="color:#d05a00; font-weight:bold;">─── (太線)</span> : ノート間の直接紐付け (強い関連)<br>
        <span style="color:#999;">─── (細線)</span> : 同一メモ内での共起 (通常の関連)
    </p>
    
    <div id="graphArea" 
        style="margin-top:20px; position:relative; width:100%; height:600px; border:1px solid #ddd; background:#f9f9f9; overflow:hidden;">
    </div>

    <div id="linkInfoList" style="margin-top:20px; padding:15px; border:1px solid #eee; background:#fafafa; max-height: 400px; overflow-y: auto;">
        <h3>関連性詳細リスト</h3>
    </div>
`;

  document.getElementById("closeGraphBtn").onclick = () => {
    container.remove();
  };

  const graphArea = document.getElementById("graphArea");
  const linkInfoList = document.getElementById("linkInfoList");

  // テキストボックスIDからメモデータを引けるマップを作成
  const memoIdMap = new Map(allMemoData.map(item => [item.id, item]));

  linkInfoList.innerHTML = '<h3>紐付け情報一覧</h3>'; // タイトルを上書き

  // D. 関連情報リストの表示 (紐付け情報)
  allMemoData.forEach(item => {
    // 紐付け情報を持つアイテムのみをフィルタリング
    if (item.linkedNoteId || item.isLinkedToPDF) {
      const linkDetail = document.createElement('p');
      linkDetail.style.borderBottom = '1px dotted #ccc';
      linkDetail.style.padding = '5px 0';
      linkDetail.style.margin = '0';

      const MAX_LENGTH = 30;

      const sourceText = item.content || item.linkedText;
      const sourceSnippet = sourceText.substring(0, MAX_LENGTH).trim();
      const sourceEllipsis = sourceText.length > MAX_LENGTH ? '...' : '';

      let info = `<strong>紐付け元 ID: ${item.id}</strong> (${sourceSnippet}${sourceEllipsis})<br>`;

      if (item.linkedNoteId) {
        const linkedItem = memoIdMap.get(item.linkedNoteId);
        let targetSnippet = '（コンテンツ不明）';
        let targetEllipsis = '';

        if (linkedItem) {
          const targetText = linkedItem.content;
          targetSnippet = targetText.substring(0, MAX_LENGTH).trim();
          targetEllipsis = targetText.length > MAX_LENGTH ? '...' : '';
        }
        info += `🔗 テキストボックス間紐付け先 ID: <span style="color:#d05a00;">${item.linkedNoteId}</span> (内容: ${targetSnippet}${targetEllipsis})<br>`;
      }

      if (item.isLinkedToPDF) {
        const PDF_MAX_LENGTH = 50;
        const pdfText = item.linkedText;
        const pdfSnippet = pdfText.substring(0, PDF_MAX_LENGTH);
        const pdfEllipsis = pdfText.length > PDF_MAX_LENGTH ? '...' : '';

        info += `📄 PDFハイライト: <span style="color:#2a66b9;">${pdfSnippet}${pdfEllipsis}</span> (P.${item.page})`;
      }

      linkDetail.innerHTML = info;
      linkInfoList.appendChild(linkDetail);
    }
  });

  // A. 座標の事前計算 (円形レイアウト)
  const center = { x: 50, y: 50 }; // %指定
  const nodeCoordinates = new Map(); // 用語 -> {x, y}

  nodes.forEach((node, index) => {
    let x, y;
    if (index === 0) {
      // 中央ノード
      x = center.x;
      y = center.y;
    } else {
      // 周囲のノード (円形配置)
      const angle = index * (360 / (nodes.length - 1));
      const radius = 35; // 半径 (%)
      const radian = (angle * Math.PI) / 180;
      x = center.x + radius * Math.cos(radian);
      y = center.y + radius * Math.sin(radian);
    }
    // 座標を保存 (後で線を描くために使用)
    nodeCoordinates.set(node.id, { x, y });
  });

  // B. SVGレイヤーの作成 (線を描画するため)
  const svgNS = "http://www.w3.org/2000/svg";
  const svgEl = document.createElementNS(svgNS, "svg");
  svgEl.style.position = "absolute";
  svgEl.style.top = "0";
  svgEl.style.left = "0";
  svgEl.style.width = "100%";
  svgEl.style.height = "100%";
  svgEl.style.zIndex = "0"; // 背景レイヤー

  // C. 線の描画 (SVG Line)
  links.forEach(link => {
    const sourceCoord = nodeCoordinates.get(link.source);
    const targetCoord = nodeCoordinates.get(link.target);

    if (sourceCoord && targetCoord) {
      const line = document.createElementNS(svgNS, "line");

      // 座標の設定 (%指定を使用)
      line.setAttribute("x1", `${sourceCoord.x}%`);
      line.setAttribute("y1", `${sourceCoord.y}%`);
      line.setAttribute("x2", `${targetCoord.x}%`);
      line.setAttribute("y2", `${targetCoord.y}%`);

      // スタイルの設定 (重みによって変える)
      const isStrong = link.weight >= 5; // テキストボックス間紐付けがある場合

      line.setAttribute("stroke", isStrong ? "#ff8c00" : "#bbb"); // 色
      line.setAttribute("stroke-width", isStrong ? "3" : "1");    // 太さ

      // SVGに追加
      svgEl.appendChild(line);
    }
  });

  // SVGをエリアに追加
  graphArea.appendChild(svgEl);

  // D. ノードの描画 (DIV)

  // ノード描画をスキップする単語リスト
  const NODES_TO_HIDE = new Set([
    // 日本語の助詞・助動詞の一部
    'の', 'は', 'を', 'に', 'が', 'と', 'で', 'も',
    // 英語の頻出ストップワードの一部
    'to', 'of', 'and', 'the', 'is', 'a', 'an'
  ]);

  nodes.forEach((node, index) => {
    // 非表示リストに含まれるノードは描画をスキップ
    if (NODES_TO_HIDE.has(node.id)) {
      return;
    }

    const coords = nodeCoordinates.get(node.id);
    // キーワードがフィルタリングで残っていても、描画座標がない場合はスキップ
    if (!coords) return;

    const nodeEl = document.createElement('div');

    nodeEl.textContent = node.label;
    // 💡 【新規】title属性にフルキーワードを設定 (マウスオーバーで表示)
    nodeEl.title = node.title;

    nodeEl.style.position = 'absolute';
    nodeEl.style.padding = '8px 15px';
    nodeEl.style.borderRadius = '20px';
    nodeEl.style.fontWeight = 'bold';
    nodeEl.style.zIndex = '10'; // 線の上に表示
    nodeEl.style.cursor = 'default';
    nodeEl.style.whiteSpace = 'nowrap';
    nodeEl.style.boxShadow = '0 2px 5px rgba(0,0,0,0.1)';
    nodeEl.style.transition = 'transform 0.2s';

    // ホバー時のエフェクト
    nodeEl.onmouseenter = () => nodeEl.style.transform = 'translate(-50%, -50%) scale(1.1)';
    nodeEl.onmouseleave = () => nodeEl.style.transform = 'translate(-50%, -50%) scale(1.0)';

    if (index === 0) {
      // 中央ノード (最もスコアの高いキーワード)
      nodeEl.style.backgroundColor = '#2a66b9';
      nodeEl.style.color = 'white';
      nodeEl.style.border = '2px solid #003366';
      nodeEl.style.zIndex = '11'; // 最前面
    } else {
      // 周囲ノード
      nodeEl.style.backgroundColor = '#fff';
      nodeEl.style.border = '1px solid #999';
      nodeEl.style.color = '#333';
    }

    // 保存しておいた座標を使用
    nodeEl.style.top = `${coords.y}%`;
    nodeEl.style.left = `${coords.x}%`;
    nodeEl.style.transform = 'translate(-50%, -50%)'; // 中心基準配置

    graphArea.appendChild(nodeEl);
  });

  // E. 関連情報リストの表示 (エッジ情報)
  if (links.length > 0) {
    links.sort((a, b) => b.weight - a.weight).forEach(link => {
      // リスト表示時も、ノイズノードが含まれる紐付けはスキップ
      if (NODES_TO_HIDE.has(link.source) || NODES_TO_HIDE.has(link.target)) {
        return;
      }

      const linkInfo = document.createElement('p');
      const isStrong = link.weight >= 5;
      const label = isStrong ? '🔗 紐付け関連' : '📄 共起関連';

      // リスト内ではノードID（フルテキスト）を表示する
      linkInfo.innerHTML = `
        <span style="color:${isStrong ? '#d05a00' : '#777'}; font-weight:bold;">${label}</span> 
        [ ${link.source} ] - [ ${link.target} ] 
      `;
      linkInfo.style.borderBottom = '1px solid #eee';
      linkInfo.style.padding = '5px 0';
      linkInfo.style.margin = '0';
      linkInfoList.appendChild(linkInfo);
    });
  } else {
    linkInfoList.innerHTML += "<p>関連性の高いトピック間のつながりは見つかりませんでした。</p>";
  }
}