// graphView.js

const JAPANESE_STOP_WORDS_ARRAY = [
  'の', 'は', 'を', 'に', 'が', 'と', 'へ', 'で', 'も', 'から', 'より', 'など', 'こと',
  'ある', 'いる', 'する', 'なる', 'れる', 'られる', 'いる', 'いる', 'という', 'この',
  'その', 'あの', 'これ', 'それ', 'あれ', 'もし', 'または', 'そして', 'しかし', 'また',
  'ため', 'よう', 'ため', 'とき', 'だけ', 'たら', 'ので', 'では', 'では', 'です',
  'ます', 'あり', 'なっ', 'し', 'ん', 'られ', 'でき', 'いく', 'お', '的', 'い', 'な',
  'p', 'ページ'
];

// 💡 語尾除去のために、長いストップワードからチェックするように文字数で降順ソート
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

// =============================================================
// I. データの抽出と準備
// =============================================================

/**
 * 全てのメモ要素からテキストと関連情報を抽出する
 * 💡 ノート間リンクID (linkedNoteId) を含めるように拡張
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
    const linkedNoteId = (el.dataset.linkedNoteId || "").trim(); // ノート間リンクID
    const page = parseInt(el.dataset.page || "0", 10);
    const id = el.dataset.id || Math.random().toString(36);

    // コンテンツがないが、リンク情報がある場合は含める
    if (!content && !linkedText && !linkedNoteId) return;

    items.push({
      id,
      page,
      content,
      linkedText,
      linkedNoteId, // 💡 紐付け先IDを保持
      isLinkedToPDF: linkedText.length > 0,
      fullText: (content + " " + linkedText).toLowerCase() // 全て小文字で保存
    });
  });

  return items;
}

/**
 * TF-IDFで重要語トップ10を抽出する (TF-IDF計算後、ストップワードを除去するロジックを適用)
 */
function extractKeyTermsTFIDF(allItems) {
  const docs = allItems.map(i => i.fullText);

  // 💡 トークナイズ処理はシンプルに保ち、紐付けが途切れないようにする
  const tokenize = text =>
    text
      .toLowerCase()
      .replace(/[^\p{L}0-9]/gu, " ")
      .split(/\s+/)
      .filter(w => w.length > 1);

  const termCounts = docs.map(tokenize);
  const df = {};
  const tf = [];

  termCounts.forEach(tokens => {
    const counts = {};
    tokens.forEach(t => (counts[t] = (counts[t] || 0) + 1));
    tf.push(counts);

    const unique = new Set(tokens);
    unique.forEach(t => (df[t] = (df[t] || 0) + 1));
  });

  const N = docs.length;
  const tfidf = {};

  Object.keys(df).forEach(term => {
    const idf = Math.log((N + 1) / (df[term] + 1)) + 1;
    let totalTFIDF = 0;
    tf.forEach(counts => {
      totalTFIDF += (counts[term] || 0) * idf;
    });

    tfidf[term] = totalTFIDF;
  });

  // 💡 修正箇所: TF-IDFスコアに基づいてソートした後、ストップワードを除外
  const allStopWords = new Set([...JAPANESE_STOP_WORDS, ...ENGLISH_STOP_WORDS]);

  return Object.entries(tfidf)
    .sort((a, b) => b[1] - a[1])
    .map(e => e[0]) // 単語のみの配列にする
    .filter(term => !allStopWords.has(term)) // ストップワードを除外
    .slice(0, 10); // 上位10語を返す
}

// =============================================================
// II. 関連性 (共起と紐付け) の計算ロジック
// =============================================================

/**
 * キーワード間の共起関係と紐付け関係を計算し、重みを付与する
 * @param {Array<object>} allItems 全てのメモデータ
 * @param {Array<string>} keyTerms 抽出されたキーワードリスト
 * @returns {Map<string, Map<string, number>>} 関連マップ (Keyword -> Keyword -> Count)
 */
function calculateRelations(allItems, keyTerms) {
  const relationMap = new Map();
  const termSet = new Set(keyTerms);
  const memoIdMap = new Map(allItems.map(item => [item.id, item]));

  // 💡 関連カウントをインクリメントする共通関数
  const incrementRelation = (termA, termB, weight = 1) => {
    // 同じキーワードの自己ループは無視
    if (termA === termB) return;

    if (!relationMap.has(termA)) relationMap.set(termA, new Map());
    if (!relationMap.has(termB)) relationMap.set(termB, new Map());

    // A -> B のカウント
    const countAB = relationMap.get(termA).get(termB) || 0;
    relationMap.get(termA).set(termB, countAB + weight);

    // B -> A のカウント (無向グラフとして扱うため)
    const countBA = relationMap.get(termB).get(termA) || 0;
    relationMap.get(termB).set(termA, countBA + weight);
  };

  allItems.forEach(item => {
    const presentTerms = new Set();

    // 1. そのメモに含まれるキーワードの抽出
    termSet.forEach(term => {
      if (item.fullText.includes(term.toLowerCase())) {
        presentTerms.add(term);
      }
    });
    const termsArray = Array.from(presentTerms);

    // 2. 共起のカウント (重み: 1) - 同じメモ内での関連
    for (let i = 0; i < termsArray.length; i++) {
      for (let j = i + 1; j < termsArray.length; j++) {
        incrementRelation(termsArray[i], termsArray[j], 1);
      }
    }

    // 3. 💡 ノート間紐付けによる関連のカウント (重み: 5) - 強い関連性
    if (item.linkedNoteId) {
      const linkedItem = memoIdMap.get(item.linkedNoteId);
      if (linkedItem) {
        const linkedTerms = new Set();

        // 紐付け先のメモに含まれるキーワードを抽出
        termSet.forEach(term => {
          if (linkedItem.fullText.includes(term.toLowerCase())) {
            linkedTerms.add(term);
          }
        });

        // リンク元のキーワードとリンク先のキーワード全てを関連付ける (重み 5)
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
 */
function buildGraphData(keyTerms, relationMap) {
  const nodes = keyTerms.map((term, index) => ({
    id: term,
    label: term,
    group: index === 0 ? 1 : 2
  }));

  const links = [];
  const addedLinks = new Set();

  relationMap.forEach((innerMap, source) => {
    innerMap.forEach((weight, target) => {
      // エッジは (A, B) と (B, A) で重複するため、一方向のみ追加
      const linkKey = source < target ? `${source}-${target}` : `${target}-${source}`;

      // 紐付けや共起で重みが 1 より大きい場合のみエッジを作成
      if (!addedLinks.has(linkKey) && weight > 1) {
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
    div.style.boxShadow = "0 0 15px rgba(0,0,0,0.2)"; // 影を追加して浮遊感を出す
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

  // --- 💡 ここから描画ロジックの変更点 ---

  // A. 座標の事前計算
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
      // 度数法をラジアンに変換
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
      const isStrong = link.weight >= 5; // ノート間紐付けがある場合

      line.setAttribute("stroke", isStrong ? "#ff8c00" : "#bbb"); // 色
      line.setAttribute("stroke-width", isStrong ? "3" : "1");    // 太さ

      // SVGに追加
      svgEl.appendChild(line);
    }
  });

  // SVGをエリアに追加
  graphArea.appendChild(svgEl);

  // D. ノードの描画 (DIV)

  // 💡 【追加】ノード描画をスキップする単語リスト
  const NODES_TO_HIDE = new Set([
    // 日本語の助詞・助動詞の一部
    'の', 'は', 'を', 'に', 'が', 'と', 'で', 'も',
    // 英語の頻出ストップワードの一部
    'to', 'of', 'and', 'the', 'is', 'a', 'an'
  ]);

  nodes.forEach((node, index) => {
    // 💡 【追加】非表示リストに含まれるノードは描画をスキップ
    if (NODES_TO_HIDE.has(node.id)) {
      return;
    }

    const coords = nodeCoordinates.get(node.id);
    const nodeEl = document.createElement('div');

    nodeEl.textContent = node.label;
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
      // 中央ノード
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

  // E. 関連情報リストの表示 (既存ロジック維持)
  if (links.length > 0) {
    links.sort((a, b) => b.weight - a.weight).forEach(link => {
      // 💡 【変更】リスト表示時も、ノイズノードが含まれるリンクはスキップ
      if (NODES_TO_HIDE.has(link.source) || NODES_TO_HIDE.has(link.target)) {
        return;
      }

      const linkInfo = document.createElement('p');
      const isStrong = link.weight >= 5;
      const label = isStrong ? '🔗 紐付け関連' : '📄 共起関連';

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