// 最重要トピック対応の処理を追加
const JAPANESE_STOP_WORDS_ARRAY = [
  'の', 'は', 'を', 'に', 'が', 'と', 'へ', 'で', 'も', 'から', 'より', 'など', 'こと',
  'ある', 'いる', 'する', 'なる', 'れる', 'られる', 'いる', 'いる', 'という', 'この',
  'その', 'あの', 'これ', 'それ', 'あれ', 'もし', 'または', 'そして', 'しかし', 'また',
  'ため', 'よう', 'ため', 'とき', 'だけ', 'たら', 'ので', 'では', 'では', 'です',
  'ます', 'あり', 'なっ', 'し', 'ん', 'られ', 'でき', 'いく', 'お', '的', 'い', 'な',
  'p', 'ページ'
];

// 💡 語尾除去のために、長いストップワードからチェックするように文字数で降順ソートするロジックは維持
JAPANESE_STOP_WORDS_ARRAY.sort((a, b) => b.length - a.length);

// Setに変換（検索の高速化のため）
const JAPANESE_STOP_WORDS = new Set(JAPANESE_STOP_WORDS_ARRAY);

const ENGLISH_STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'and', 'or', 'but', 'if',
  'be', 'not', 'of', 'in', 'on', 'at', 'to', 'from', 'by', 'with',
  'it', 'its', 'this', 'that', 'we', 'our', 'us', 'you', 'your', 'they', 'their',
  'can', 'will', 'would', 'should', 'have', 'has', 'had', 'do', 'does', 'did',
  'as', 'for', 'about', 'out', 'up', 'down', 'only', 'all', 'any', 'some',
  'p'
]);

/**
 * トピックビューのボタンイベントを設定し、表示/非表示を切り替える
 */
export function setupTopicViewButton() {
  // ... (変更なし) ...
  const button = document.getElementById('topicViewButton');
  if (!button) {
    console.error("Topic View Button not found.");
    return;
  }

  button.addEventListener('click', () => {
    const container = getOrCreateTopicViewContainer();
    if (container.style.display === 'block') {
      hideTopicView(container);
      button.classList.remove('active');
    } else {
      renderTopicView(container);
      showTopicView(container);
      button.classList.add('active');
    }
  });
}

/**
 * トピックビューのコンテナ要素を取得または作成する
 * @returns {HTMLElement} トピックビューのコンテナ要素
 */
function getOrCreateTopicViewContainer() {
  let container = document.getElementById('topicViewContainer');
  if (container) return container; // 既存ならそのまま返す

  container = document.createElement('div');
  container.id = 'topicViewContainer';

  // スタイル設定 (サイズ変更可能箇所)
  container.style.position = 'fixed';
  container.style.top = '0';
  container.style.left = '0';
  container.style.width = '90%';
  container.style.height = '100%';
  container.style.backgroundColor = '#f4f4f4';
  container.style.overflowY = 'scroll';
  container.style.zIndex = '9990';
  container.style.padding = '20px 5%';
  container.style.fontFamily = 'sans-serif';

  // キーボードイベントのデフォルト動作停止と伝播停止
  container.addEventListener('keydown', (event) => {
    const scrollKeys = [
      'Space',       // スペースキー (32)
      'ArrowLeft',   // 左矢印キー (37)
      'ArrowUp',     // 上矢印キー (38)
      'ArrowRight',  // 右矢印キー (39)
      'ArrowDown'    // 下矢印キー (40)
    ];

    if (scrollKeys.includes(event.key)) {
      event.stopPropagation();
    }
  });

  const mainTitle = document.createElement('h1');
  mainTitle.textContent = 'トピックビュー';
  mainTitle.style.marginBottom = '20px';
  container.appendChild(mainTitle);

  // ノート内容を描画するためのコンテナを追加
  const topicContent = document.createElement('div');
  topicContent.id = 'topicContent';
  container.appendChild(topicContent);

  // 閉じるボタンの追加
  const closeBtn = document.createElement('button');
  closeBtn.textContent = 'PDF編集に戻る';
  closeBtn.style.position = 'fixed';
  closeBtn.style.top = '15px';
  closeBtn.style.right = '30px';
  closeBtn.style.padding = '10px 15px';
  closeBtn.style.backgroundColor = '#d9534f';
  closeBtn.style.color = 'white';
  closeBtn.style.border = 'none';
  closeBtn.style.borderRadius = '5px';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.zIndex = '9999';
  closeBtn.style.fontSize = '16px';

  closeBtn.addEventListener('click', () => {
    hideTopicView(container);
    document.getElementById('topicViewButton').classList.remove('active');
  });

  container.appendChild(closeBtn);
  document.body.appendChild(container);
  return container;
}

/**
 * トピックビューを非表示にし、PDFビューを表示する
 * @param {HTMLElement} container トピックビューのコンテナ
 */
function hideTopicView(container) {
  container.style.display = 'none';
  container.removeAttribute('tabindex');
  document.getElementById('viewerContainer').style.display = 'block';
}

/**
 * トピックビューを表示し、PDFビューを非表示にする
 * @param {HTMLElement} container トピックビューのコンテナ
 */
function showTopicView(container) {
  container.style.display = 'block';

  // フォーカスを強制的にトピックビューに移動させる
  container.tabIndex = -1;
  container.focus();
}

/**
 * メモ要素を抽出・分類し、トピックビューを描画するメイン関数
 */
export function renderTopicView(containerElement) {
  const topicContent = document.getElementById('topicContent');
  if (!topicContent) return;
  topicContent.innerHTML = '';

  const allMemoElements = document.querySelectorAll(".note, .highlight");

  if (allMemoElements.length === 0) {
    topicContent.innerHTML = '<p style="text-align: center; margin-top: 50px;">メモがありません。</p>';
    return;
  }

  const attributeGroupedData = new Map();
  const allMemoData = []; // 全てのメモを一時的に格納する配列

  allMemoElements.forEach(el => {
    const isHighlight = el.classList.contains('highlight');
    const hasLinkedText = el.dataset.linkedText && el.dataset.linkedText.trim() !== '';
    const linkedNoteId = el.dataset.linkedNoteId || ''; // 新たに追加された linkedNoteId を取得

    // 属性の取得と分類キーの決定
    const noteAttribute = el.dataset.attribute || '';
    let attributeKey;

    if (isHighlight) {
      // ハイライトは常に「要点」扱い
      attributeKey = 'CORE_INSIGHTS_HIGHLIGHT';
    } else if (noteAttribute) {
      // テキストボックスに属性が設定されている場合、その属性キーをそのまま使用
      attributeKey = noteAttribute.toUpperCase();
    } else if (hasLinkedText || linkedNoteId) {
      // 属性がなく、紐付けがあるノートも「要点」扱い (PDF or ノート間)
      attributeKey = 'CORE_INSIGHTS_LINKED_NOTE';
    } else {
      // それ以外の普通のノート
      attributeKey = 'OTHER_NOTE';
    }

    let content = el.textContent || '';
    let linkedText = el.dataset.linkedText || '';
    let highlightText = el.dataset.text || '';

    if (isHighlight && highlightText.trim() === '') {
      // 矩形ハイライトなど、テキスト情報がない場合は処理をスキップ
      return;
    }

    const page = parseInt(el.dataset.page, 10); // ページ番号を数値として取得

    if (isHighlight) {
      content = highlightText;
    }

    const keypointText = hasLinkedText ? linkedText : content;

    // データの集約
    allMemoData.push({
      content,
      linkedText,
      linkedNoteId, // linkedNoteId を追加
      keypointText,
      page,
      type: isHighlight ? 'highlight' : 'note',
      isLinked: hasLinkedText || linkedNoteId, // linkedNoteId でも isLinked を true に
      attributeKey // 分類キーを保持
    });
  });

  // --- 【ソートロジックの適用】 ---
  allMemoData.sort((a, b) => {
    // 1. まずページ番号でソート
    if (a.page !== b.page) {
      return a.page - b.page;
    }

    // 2. ページ番号が同じ場合、紐付けノート (isLinked: true) をハイライト (highlight) より優先 (テキストボックス -> ハイライト)
    const aIsLinkedNote = a.isLinked && a.type === 'note'; // 紐付けありノート (テキストボックス)
    const bIsLinkedNote = b.isLinked && b.type === 'note';

    if (aIsLinkedNote && !bIsLinkedNote) return -1; // a (テキストボックス) を優先
    if (!aIsLinkedNote && bIsLinkedNote) return 1;  // b (テキストボックス) を優先

    return 0;
  });

  // --- 【最重要トピックの抽出ロジックの追加】 ---
  const allText = allMemoData.map(item => {
    // ノート内容、紐付けテキスト、ハイライトテキストを結合して分析対象にする
    const content = item.content || '';
    const linkedText = item.linkedText || '';
    return content + ' ' + linkedText;
  }).join(' ');

  const keyTopics = analyzeTextForTopics(allText);

  // 最重要トピックセクションを描画
  drawKeyTopicSection(topicContent, keyTopics);

  // ソートされたデータを attributeGroupedData に再分類する部分
  allMemoData.forEach(item => {
    let finalAttributeKey = item.attributeKey;

    // ⭐️ 属性に関わらず、紐付けされたノートは要点グループに分類する ⭐️
    if (item.isLinked && item.type === 'note') {
      finalAttributeKey = 'CORE_INSIGHTS_LINKED_NOTE';
    }

    if (!attributeGroupedData.has(finalAttributeKey)) {
      attributeGroupedData.set(finalAttributeKey, []);
    }
    attributeGroupedData.get(finalAttributeKey).push(item);
  });

  // 抽出・分類したデータを描画
  drawAttributeGroupedData(topicContent, attributeGroupedData);
}

/**
 * 分類キーをユーザーフレンドリーな表示名に変換し、色を返す
 * @param {string} key 分類キー
 * @returns {{name: string, color: string}} 表示名と見出し色
 */
function getAttributeDetails(key) {
  switch (key) {
    // 要点（黄色）
    case 'CORE_INSIGHTS_HIGHLIGHT': return { name: '要点（ハイライト）', color: '#ffc107' };
    case 'CORE_INSIGHTS_LINKED_NOTE': return { name: '要点（紐付けノート）', color: '#ffc107' };

    // 補足（水色）
    case 'DETAIL': return { name: '補足', color: '#4a90e2' };
    // 疑問（オレンジ）
    case 'QUESTION': return { name: '疑問', color: '#ff8c00' };
    // 考え（緑）
    case 'REFLECTION': return { name: '考え', color: '#32cd32' };
    // その他（グレー）
    case 'OTHER': return { name: 'その他', color: '#808080' };

    case 'OTHER_NOTE': return { name: '未分類のメモ', color: '#bdbdbd' };
    default: return { name: '未分類', color: '#bdbdbd' };
  }
}

/**
 * 分類されたデータを構造化して描画する (トピック見出しなし)
 */
function drawAttributeGroupedData(targetElement, dataMap) {
  // 属性の表示順の定義
  const attributeOrder = [
    'CORE_INSIGHTS_HIGHLIGHT', // 要点（ハイライト）
    'CORE_INSIGHTS_LINKED_NOTE', // 要点（紐付けノート）
    'DETAIL', // 補足
    'QUESTION', // 疑問
    'REFLECTION', // 考え
    'OTHER', // その他
    'OTHER_NOTE' // 未分類
  ];

  const allMemoSection = document.createElement('section');
  allMemoSection.style.marginBottom = '40px';

  // 属性の順序に従って描画
  attributeOrder.forEach(attributeKey => {
    if (dataMap.has(attributeKey)) {

      // 属性ごとの見出し (h2 に格上げ)
      const details = getAttributeDetails(attributeKey);

      const attributeTitle = document.createElement('h2');
      attributeTitle.textContent = details.name;
      attributeTitle.style.marginTop = '15px';
      attributeTitle.style.marginBottom = '15px';
      attributeTitle.style.borderLeft = `6px solid ${details.color}`; // color を使用
      attributeTitle.style.paddingLeft = '10px';
      attributeTitle.style.backgroundColor = '#eaf4ff'; // 背景色はそのまま
      attributeTitle.style.padding = '10px';
      allMemoSection.appendChild(attributeTitle);

      const list = document.createElement('ul');
      list.style.listStyleType = 'none';
      list.style.paddingLeft = '0';

      // メモ項目のループ
      dataMap.get(attributeKey).forEach(item => {
        const listItem = document.createElement('li');
        listItem.style.marginBottom = '15px';

        // 💡 スペース調整: padding-left を 10px に減らし、全体を左に寄せる
        listItem.style.padding = '10px 10px 10px 10px';

        // リスト項目の左ボーダーを要点の場合は黄色、それ以外はグレーに設定
        const itemBorderColor = attributeKey.includes('CORE_INSIGHTS') ? '#ffc107' : '#ccc';
        listItem.style.borderLeft = `4px solid ${itemBorderColor}`;
        listItem.style.backgroundColor = '#fff';
        listItem.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';

        // 【表示ロジックの適用】
        let itemContentHTML = '';

        if (attributeKey === 'CORE_INSIGHTS_HIGHLIGHT' || attributeKey === 'CORE_INSIGHTS_LINKED_NOTE') {
          if (item.type === 'highlight') {
            // 1.1 ハイライト (定義) - 太字を適用 (スペース調整済み)
            itemContentHTML = `
                            <span style="color: #000; font-weight: bold;">
                                <strong>✓ </strong> ${item.content} 
                                <span style="font-size: 0.8em; color: #888; font-weight: normal;">(P.${item.page})</span>
                            </span>
                        `;
          } else if (item.isLinked) {
            let contextText = '';
            let contextNote = '';

            if (item.linkedText) {
              // PDFテキスト紐付けが存在する場合
              contextText = item.linkedText;
              contextNote = `<strong>➔</strong> ${item.content}`;
            }

            // PDF紐付けの有無にかかわらず、ノート間紐付けが存在する場合に処理
            if (item.linkedNoteId) {
              const targetNoteElement = document.querySelector(`.note[data-id="${item.linkedNoteId}"]`);
              const targetNoteContent = targetNoteElement ? targetNoteElement.textContent.trim() : '';
              const maxLen = 50;

              if (item.linkedText) {
                // PDF紐付けとノート間紐付けが両方ある場合: 考察に追加
                let noteLinkInfo = '';
                if (targetNoteContent) {
                  const targetSnippet = targetNoteContent.substring(0, maxLen) + (targetNoteContent.length > maxLen ? '...' : '');
                  noteLinkInfo = ` [🔗 関連ノート: ${targetSnippet}]`;
                } else {
                  noteLinkInfo = ` [関連ノート (${item.linkedNoteId}) は削除されました]`;
                }
                contextNote = `${contextNote}${noteLinkInfo}`;

              } else {
                // ノート間紐付けのみの場合: これがメイン情報となる
                const currentSnippet = item.content.substring(0, maxLen) + (item.content.length > maxLen ? '...' : '');

                if (targetNoteContent) {
                  const targetSnippet = targetNoteContent.substring(0, maxLen) + (targetNoteContent.length > maxLen ? '...' : '');
                  contextText = `${currentSnippet} (ノートリンク先)`;
                  contextNote = `<strong>➔ </strong>${targetSnippet}`;
                } else {
                  contextText = `ノートリンク元: ${currentSnippet}`;
                  contextNote = `<strong></strong> リンク先ノート (ID: ${item.linkedNoteId}) は削除されました`;
                }
              }
            }

            // 1.2 紐付け付きノート (考察) - 文脈を太字、ノートを薄く表示
            // 💡 修正済み: contextText/contextNote を使用し、不要な改行を削除
            itemContentHTML = `
                            <p style="margin:0;">
                                <span style="color: #000; font-weight: bold;">
                                    <strong>✓ </strong> ${contextText} 
                                    <span style="font-size: 0.8em; color: #888; font-weight: normal;">(P.${item.page})</span>
                                </span>
                            </p>
                            <p style="margin:5px 0 0 15px; border-left: 2px solid #ccc; padding-left: 5px;">
                                <span style="color: #777;">
                                    <strong></strong> ${contextNote}
                                </span>
                            </p>
                        `;
          }
        } else { // 新しい属性 (DETAIL, QUESTION, REFLECTION, OTHER) と OTHER_NOTE の処理
          // 2. その他のノート、または属性付きのノート
          itemContentHTML = `<strong>・ </strong> ${item.content} <span style="font-size: 0.8em; color: #888;">(P.${item.page})</span>`;
        }

        listItem.innerHTML = itemContentHTML;
        list.appendChild(listItem);
      });
      allMemoSection.appendChild(list);
    }
  });

  targetElement.appendChild(allMemoSection);
}

/**
 * テキストからストップワードを除外し、単語の頻度を計算する
 * @param {string} text 分析対象の全テキスト
 * @returns {{word: string, count: number}[]} 頻度順にソートされた上位の単語リスト
 */
function analyzeTextForTopics(text) {
  // --- 【言語判定ロジック】 ---
  // ひらがな・カタカナ・漢字の文字数をカウント
  const japaneseCharCount = (text.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length;
  const totalCharCount = text.length;

  // 全体の文字数に対して日本語文字が一定割合（例：20%）以上であれば日本語と見なす
  const isJapanese = totalCharCount > 0 && (japaneseCharCount / totalCharCount) > 0.20;
  const stopWords = isJapanese ? JAPANESE_STOP_WORDS : ENGLISH_STOP_WORDS;
  // 💡 語尾除去処理のために、ソート済みの配列版も利用
  const stopWordsArray = isJapanese ? JAPANESE_STOP_WORDS_ARRAY : [];

  // 1. 前処理: 小文字化、句読点・記号の除去
  const cleanedText = text
    .toLowerCase()
    // 句読点・記号をスペースに置換
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, " ")
    // 複数のスペースを1つに
    .replace(/\s+/g, ' ')
    .trim();

  // 2. トークン化
  // スペース区切りで単語を区切る
  const words = cleanedText.split(' ').filter(word => word.length > 1); // 1文字以下の単語は無視

  // 【💡 修正点: 単語の語幹を抽出するロジック（数字・助詞除去）】
  const baseWords = words.map(word => {
    let currentWord = word;
    let originalLength;

    // 1. 助詞・活用語尾の反復除去 (日本語の場合のみ)
    if (isJapanese) {
      // 💡 長いストップワードから順に、末尾一致を試みる
      do {
        originalLength = currentWord.length;
        let matchedStopWord = null;

        for (const sw of stopWordsArray) {
          // 単語の長さがストップワードより長く、末尾がストップワードと一致する場合
          // 例: 'ノートについて'に対して'について'がマッチ
          if (currentWord.length > sw.length && currentWord.endsWith(sw)) {
            matchedStopWord = sw;
            break; // 最長一致が保証されているため、最初に見つかったものを採用
          }
        }

        if (matchedStopWord) {
          // マッチしたストップワードを末尾から削除
          currentWord = currentWord.substring(0, currentWord.length - matchedStopWord.length);
        }

        // 単語の長さが変わらなくなったらループを抜ける
      } while (currentWord.length < originalLength);
    }

    // 2. 数字サフィックスの除去 ('ノート1' -> 'ノート')
    currentWord = currentWord.replace(/[-_\d]+$/, '');

    return currentWord;
  }).filter(word => word.length > 1); // 再度1文字以下の単語は無視

  // 3. 頻度計算とストップワード除去
  const wordCounts = new Map();
  baseWords.forEach(word => {
    // 判定されたストップワードリストを使用
    if (!stopWords.has(word) && word.trim() !== '') {
      wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
    }
  });

  // 4. ソートして上位10件を抽出
  const sortedWords = Array.from(wordCounts.entries())
    .filter(a => a[1] >= 2) // 2回以上の出現に限定
    .sort((a, b) => b[1] - a[1]) // 頻度で降順ソート
    .slice(0, 10) // 上位10個に限定
    .map(([word, count]) => ({ word, count }));

  return sortedWords;
}

/**
 * 最重要トピックのセクションを描画する
 * @param {HTMLElement} targetElement 描画対象のコンテナ
 * @param {{word: string, count: number}[]} keyTopics 最重要トピックのリスト
 */
/**
 * 最重要トピックのセクションを描画する
 * @param {HTMLElement} targetElement 描画対象のコンテナ
 * @param {{word: string, count: number}[]} keyTopics 最重要トピックのリスト
 */
function drawKeyTopicSection(targetElement, keyTopics) {
  if (keyTopics.length === 0) return;

  // 全メモデータを取得（検索ロジックのために必要）
  const allMemoElements = document.querySelectorAll(".note, .highlight");
  const allMemoData = [];
  allMemoElements.forEach(el => {
    const isHighlight = el.classList.contains('highlight');
    let content = (el.textContent || '').trim();
    let linkedText = (el.dataset.linkedText || '').trim();
    let highlightText = (el.dataset.text || '').trim();

    if (isHighlight && highlightText.trim() === '') return;
    if (isHighlight) content = highlightText;

    allMemoData.push({
      page: parseInt(el.dataset.page || "0", 10),
      content,
      // 検索とカウントのために、コンテンツとリンクテキストを結合
      fullText: (content + ' ' + linkedText)
    });
  });


  const keyTopicSection = document.createElement('section');
  keyTopicSection.style.marginBottom = '40px';
  keyTopicSection.style.padding = '20px';
  keyTopicSection.style.backgroundColor = '#fff0e0';
  keyTopicSection.style.borderRadius = '8px';
  keyTopicSection.style.border = '2px solid #ffcc80';

  const sectionTitle = document.createElement('h2');
  sectionTitle.textContent = 'キーワード';
  sectionTitle.style.borderBottom = '3px solid #ffaa00';
  sectionTitle.style.paddingBottom = '5px';
  sectionTitle.style.marginBottom = '15px';
  sectionTitle.style.color = '#d05a00';
  keyTopicSection.appendChild(sectionTitle);

  const topicList = document.createElement('div');
  topicList.style.display = 'flex';
  topicList.style.flexWrap = 'wrap';
  topicList.style.gap = '10px';

  keyTopics.forEach(topic => {
    // 検索対象の単語（大文字小文字を区別しない正規表現で使用）
    const term = topic.word;
    // 💡 単語の総出現回数を格納する変数
    let totalOccurrenceCount = 0;
    // 💡 部分一致で抽出された関連メモの配列
    const relevantMemos = [];

    // 単語全体をマッチさせるための正規表現（単語境界を使用せず、部分一致のカウントにする）
    const regex = new RegExp(term.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'gi');

    allMemoData.forEach(item => {
      const matches = item.fullText.match(regex);

      if (matches) {
        // 単語の出現回数を加算
        totalOccurrenceCount += matches.length;
        // 関連メモのリストも作成（クリックイベントで使用）
        relevantMemos.push(item);
      }
    });

    // チップに表示するテキストを「キーワード (単語の総出現回数)」に変更
    const totalCountToDisplay = totalOccurrenceCount;

    const topicChip = document.createElement('span');
    topicChip.textContent = `${topic.word} (${totalCountToDisplay})`;

    topicChip.style.backgroundColor = '#ffcc80';
    topicChip.style.color = '#333';
    topicChip.style.padding = '5px 10px';
    topicChip.style.borderRadius = '15px';
    topicChip.style.fontWeight = 'bold';
    topicChip.style.fontSize = '1.1em';
    topicChip.style.cursor = 'pointer';
    topicList.appendChild(topicChip);

    // 【💡 クリックイベント: 関連メモ一覧をアラートで表示】
    topicChip.onclick = () => {
      if (relevantMemos.length === 0) {
        alert(`キーワード「${topic.word}」を含むメモはありません。`);
        return;
      }

      const memoListText = relevantMemos.map(item =>
        `P.${item.page}: ${item.content.substring(0, 40)}${item.content.length > 40 ? '...' : ''}`
      ).join('\n');

      alert(`キーワード「${topic.word}」に関連するメモ (${relevantMemos.length}件、総出現回数 ${totalOccurrenceCount}回):\n\n${memoListText}`);
    };
  });

  keyTopicSection.appendChild(topicList);

  // ノートセクションの前に挿入
  targetElement.insertBefore(keyTopicSection, targetElement.firstChild);
}