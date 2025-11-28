// topicView.js - 主要な要点に統合版

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
            renderTopicView(container); // メモの最新情報で再描画
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
    container.style.left = '0'; // 例：左端から表示
    container.style.width = '90%'; // 例：画面幅全体
    container.style.height = '100%';
    container.style.backgroundColor = '#f4f4f4';
    container.style.overflowY = 'scroll'; // スクロール強制適用
    container.style.zIndex = '9990';
    container.style.padding = '20px 5%';
    container.style.fontFamily = 'sans-serif';
    
    // 【修正 1/3】キーボードイベントのデフォルト動作停止と伝播停止
    // スクロールを発生させるキー (Space, 矢印キー) の動作を防止
    container.addEventListener('keydown', (event) => {
        const scrollKeys = [
            'Space',       // スペースキー (32)
            'ArrowLeft',   // 左矢印キー (37)
            'ArrowUp',     // 上矢印キー (38)
            'ArrowRight',  // 右矢印キー (39)
            'ArrowDown'    // 下矢印キー (40)
        ];
        
        // スクロールに関連するキーのイベント伝播のみを停止
        if (scrollKeys.includes(event.key)) {
            event.stopPropagation(); // イベントの親要素への伝播を停止 (背景スクロールを防ぐ)
        }
    });
    // tabIndexを追加することで、JavaScriptでフォーカスを当てられるようにする
    // container.tabIndex = -1; は showTopicView で設定します。

    // 永続的なタイトルを追加
    const mainTitle = document.createElement('h1');
    mainTitle.textContent = 'ノート - トピックビュー';
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
    
    // 【修正 2/3】tabIndexを削除し、フォーカスを外す
    container.removeAttribute('tabindex');
    
    document.getElementById('viewerContainer').style.display = 'block';
}

/**
 * トピックビューを表示し、PDFビューを非表示にする
 * @param {HTMLElement} container トピックビューのコンテナ
 */
function showTopicView(container) {
    container.style.display = 'block';
    
    // 【修正 3/3】フォーカスを強制的にトピックビューに移動させる
    container.tabIndex = -1; // tabIndexを設定し、プログラムからフォーカス可能にする
    container.focus();
    
    // document.getElementById('viewerContainer').style.display = 'none'; // この行は既に削除済み
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

        let attributeKey;
        if (isHighlight || hasLinkedText) {
            attributeKey = 'CORE_INSIGHTS';
        } else {
            attributeKey = 'OTHER_NOTE';
        }

        let content = el.textContent || '';
        let linkedText = el.dataset.linkedText || '';
        let highlightText = el.dataset.text || '';
        const page = parseInt(el.dataset.page, 10); // ページ番号を数値として取得

        if (isHighlight) {
            content = highlightText;
        }

        // データの集約
        allMemoData.push({
            content,
            linkedText,
            page,
            type: isHighlight ? 'highlight' : 'note',
            isLinked: hasLinkedText,
            attributeKey // ソートのためにキーも保持
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
        if (!aIsLinkedNote && bIsLinkedNote) return 1;  // b (テキストボックス) を優先

        return 0; 
    });
    // ----------------------------

    // ソートされたデータを attributeGroupedData に再分類
    allMemoData.forEach(item => {
        if (!attributeGroupedData.has(item.attributeKey)) {
            attributeGroupedData.set(item.attributeKey, []);
        }
        attributeGroupedData.get(item.attributeKey).push(item);
    });

    // 抽出・分類したデータを描画
    drawAttributeGroupedData(topicContent, attributeGroupedData);
}


/**
 * 分類されたデータを構造化して描画する (トピック見出しなし)
 */
function drawAttributeGroupedData(targetElement, dataMap) {
    // 【表示順】: 主要な要点 -> その他のノート
    const attributeOrder = ['CORE_INSIGHTS', 'OTHER_NOTE'];

    const allMemoSection = document.createElement('section');
    allMemoSection.style.marginBottom = '40px';

    // 属性の順序に従って描画
    attributeOrder.forEach(attributeKey => {
        if (dataMap.has(attributeKey)) {

            // 属性ごとの見出し (h2 に格上げ)
            const attributeTitle = document.createElement('h2');
            attributeTitle.textContent = getAttributeDisplayName(attributeKey);
            attributeTitle.style.marginTop = '15px';
            attributeTitle.style.marginBottom = '15px';
            attributeTitle.style.borderLeft = '6px solid #4a90e2';
            attributeTitle.style.paddingLeft = '10px';
            attributeTitle.style.backgroundColor = '#eaf4ff';
            attributeTitle.style.padding = '10px';
            allMemoSection.appendChild(attributeTitle);

            const list = document.createElement('ul');
            list.style.listStyleType = 'none';
            list.style.paddingLeft = '0';

            // メモ項目のループ
            dataMap.get(attributeKey).forEach(item => {
                const listItem = document.createElement('li');
                listItem.style.marginBottom = '15px';
                listItem.style.padding = '10px';
                listItem.style.borderLeft = '4px solid #4a90e2';
                listItem.style.backgroundColor = '#fff';
                listItem.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';

                // 【表示ロジックの適用】
                let itemContentHTML = '';

                if (attributeKey === 'CORE_INSIGHTS') {
                    if (item.type === 'highlight') {
                        // 1.1 ハイライト (定義) - 太字を適用
                        itemContentHTML = `
                            <span style="color: #000; font-weight: bold;">
                                <strong>✓ </strong> ${item.content} 
                                <span style="font-size: 0.8em; color: #888; font-weight: normal;">(P.${item.page})</span>
                            </span>
                        `;
                    } else if (item.isLinked) {
                        // 1.2 紐付け付きノート (考察) - 文脈を太字、ノートを薄く表示
                        itemContentHTML = `
                            <p style="margin:0;">
                                <span style="color: #000; font-weight: bold;">
                                    <strong>✓ </strong> ${item.linkedText} 
                                    <span style="font-size: 0.8em; color: #888; font-weight: normal;">(P.${item.page})</span>
                                </span>
                            </p>
                            <p style="margin:5px 0 0 15px; border-left: 2px solid #ccc; padding-left: 5px;">
                                <span style="color: #777;">
                                    <strong>➔</strong> ${item.content}
                                </span>
                            </p>
                        `;
                    }
                } else if (attributeKey === 'OTHER_NOTE') {
                    // 2. その他のノート
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
 * 分類キーをユーザーフレンドリーな表示名に変換する
 * @param {string} key 分類キー
 * @returns {string} 表示名
 */
function getAttributeDisplayName(key) {
    switch (key) {
        case 'CORE_INSIGHTS': return '要点';
        case 'OTHER_NOTE': return 'その他のメモ';
        default: return '未分類';
    }
}