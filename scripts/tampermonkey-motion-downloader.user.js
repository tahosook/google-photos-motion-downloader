// ==UserScript==
// @name         Google Photos Motion Photo Downloader
// @namespace    https://github.com/tahosook/google-photos-motion-downloader
// @version      1.0.0
// @description  指定した日付の Google フォトからモーションフォト（動画）を一括ダウンロードします
// @author       tahosook
// @match        https://photos.google.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  let isRunning = false;
  let shouldStop = false;
  const processedHrefs = new Set();

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function parseDateFromLabel(label) {
    const match = String(label).match(/(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);
    if (!match) return null;
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  }

  function isDateInRange(date, from, to) {
    return Boolean(date && date >= from && date <= to);
  }

  async function waitForElement(selector, timeoutMs = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(100);
    }
    return null;
  }

  function createUI() {
    if (document.getElementById('gphotos-motion-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'gphotos-motion-panel';
    panel.style.cssText = `
      position: fixed;
      top: 70px;
      right: 20px;
      width: 320px;
      background: #ffffff;
      color: #333333;
      border: 1px solid #dadce0;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 99999;
      font-family: Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
      padding: 14px;
      box-sizing: border-box;
    `;

    // 既定値（本日または直近の日付）
    const today = new Date().toISOString().slice(0, 10);
    const defaultDate = '2026-10-03';

    panel.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <strong style="font-size:14px;">📸 Motion Photo DL</strong>
        <span id="gpm-minimize" style="cursor:pointer; color:#70757a; font-weight:bold; padding:0 4px;">−</span>
      </div>
      <div id="gpm-body">
        <div style="margin-bottom:8px;">
          <label style="display:block; margin-bottom:2px; font-weight:500;">開始日 (From):</label>
          <input type="date" id="gpm-from" value="${defaultDate}" style="width:100%; padding:5px; border:1px solid #dadce0; border-radius:4px; box-sizing:border-box;">
        </div>
        <div style="margin-bottom:10px;">
          <label style="display:block; margin-bottom:2px; font-weight:500;">終了日 (To):</label>
          <input type="date" id="gpm-to" value="${defaultDate}" style="width:100%; padding:5px; border:1px solid #dadce0; border-radius:4px; box-sizing:border-box;">
        </div>
        <div style="display:flex; gap:8px; margin-bottom:10px;">
          <button id="gpm-start-btn" style="flex:1; background:#1a73e8; color:#fff; border:none; border-radius:4px; padding:7px; font-weight:500; cursor:pointer;">開始</button>
          <button id="gpm-stop-btn" disabled style="background:#dadce0; color:#fff; border:none; border-radius:4px; padding:7px 12px; font-weight:500; cursor:not-allowed;">停止</button>
        </div>
        <div id="gpm-status" style="font-size:12px; color:#5f6368; margin-bottom:6px;">待機中</div>
        <div id="gpm-log" style="height:100px; overflow-y:auto; background:#f8f9fa; border:1px solid #e8eaed; border-radius:4px; padding:6px; font-size:11px; line-height:1.4; color:#3c4043; white-space:pre-wrap;"></div>
      </div>
    `;

    document.body.appendChild(panel);

    const minimizeBtn = panel.querySelector('#gpm-minimize');
    const body = panel.querySelector('#gpm-body');
    minimizeBtn.addEventListener('click', () => {
      if (body.style.display === 'none') {
        body.style.display = 'block';
        minimizeBtn.textContent = '−';
      } else {
        body.style.display = 'none';
        minimizeBtn.textContent = '+';
      }
    });

    const startBtn = panel.querySelector('#gpm-start-btn');
    const stopBtn = panel.querySelector('#gpm-stop-btn');

    startBtn.addEventListener('click', () => {
      const from = panel.querySelector('#gpm-from').value;
      const to = panel.querySelector('#gpm-to').value;
      if (!from || !to) {
        alert('日付を指定してください。');
        return;
      }
      if (from > to) {
        alert('開始日は終了日以前を指定してください。');
        return;
      }
      startProcess(from, to);
    });

    stopBtn.addEventListener('click', () => {
      shouldStop = true;
      log('停止要求を受信しました。現在の処理が完了次第終了します...');
    });
  }

  function log(msg) {
    const logBox = document.getElementById('gpm-log');
    if (!logBox) return;
    const time = new Date().toLocaleTimeString();
    logBox.textContent += `[${time}] ${msg}\n`;
    logBox.scrollTop = logBox.scrollHeight;
  }

  function setStatus(msg) {
    const statusBox = document.getElementById('gpm-status');
    if (statusBox) statusBox.textContent = msg;
  }

  function setRunningUI(running) {
    isRunning = running;
    const startBtn = document.getElementById('gpm-start-btn');
    const stopBtn = document.getElementById('gpm-stop-btn');
    if (startBtn) {
      startBtn.disabled = running;
      startBtn.style.background = running ? '#dadce0' : '#1a73e8';
      startBtn.style.cursor = running ? 'not-allowed' : 'pointer';
    }
    if (stopBtn) {
      stopBtn.disabled = !running;
      stopBtn.style.background = running ? '#d93025' : '#dadce0';
      stopBtn.style.cursor = running ? 'pointer' : 'not-allowed';
    }
  }

  async function closeDetailView() {
    // 戻るボタンまたは Escape
    const backBtn = document.querySelector('button[aria-label*="戻る"], button[aria-label*="Back"]');
    if (backBtn) {
      backBtn.click();
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
    }
    await sleep(500);
  }

  async function processCurrentPhoto() {
    // 詳細画面がロードされるのを待機
    const moreBtnSelector = 'button[aria-label*="その他のオプション"], button[aria-label*="More options"]';
    const moreBtn = await waitForElement(moreBtnSelector, 5000);
    if (!moreBtn) {
      log('詳細画面の読み込みタイムアウト');
      await closeDetailView();
      return { status: 'failed_timeout' };
    }

    // モーションフォト判定
    const motionBtnSelector = 'button[aria-label*="モーション フォト"], button[aria-label*="Motion photo"]';
    const isMotion = document.querySelector(motionBtnSelector);
    if (!isMotion) {
      log('モーション写真ではありません（スキップ）');
      await closeDetailView();
      return { status: 'skipped_not_motion' };
    }

    // メニューを開く
    moreBtn.click();
    await sleep(400);

    // 「動画をダウンロード」メニューを探す
    const menuItems = Array.from(document.querySelectorAll('[role="menuitem"]'));
    const downloadItem = menuItems.find((el) => {
      const text = el.textContent || el.getAttribute('aria-label') || '';
      return /動画をダウンロード|Download video/i.test(text);
    });

    if (!downloadItem) {
      log('動画ダウンロードメニューが見つかりませんでした');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      await sleep(300);
      await closeDetailView();
      return { status: 'skipped_no_menu' };
    }

    log('動画ダウンロードを開始...');
    downloadItem.click();
    await sleep(1500); // ダウンロードリクエストの完了を待機

    await closeDetailView();
    return { status: 'downloaded' };
  }

  async function startProcess(from, to) {
    if (isRunning) return;
    shouldStop = false;
    setRunningUI(true);
    log(`処理開始: ${from} 〜 ${to}`);
    setStatus('写真を検索中...');

    const counts = { downloaded: 0, skipped: 0, failed: 0 };
    let stagnantCount = 0;
    let maxScrolls = 200;

    for (let scroll = 0; scroll < maxScrolls; scroll++) {
      if (shouldStop) {
        log('処理を中止しました。');
        break;
      }

      // 現在画面に表示されている写真アンカーを取得
      const anchors = Array.from(document.querySelectorAll('a[href*="/photo/"]'));
      let foundUnprocessedInCurrentView = false;
      let oldestVisibleDate = null;

      for (const anchor of anchors) {
        if (shouldStop) break;

        const href = anchor.href;
        if (processedHrefs.has(href)) continue;

        const label = anchor.getAttribute('aria-label') || anchor.textContent || '';
        const date = parseDateFromLabel(label);
        if (!date) continue;

        if (!oldestVisibleDate || date < oldestVisibleDate) {
          oldestVisibleDate = date;
        }

        if (isDateInRange(date, from, to)) {
          foundUnprocessedInCurrentView = true;
          processedHrefs.add(href);

          setStatus(`[${date}] 処理中...`);
          log(`対象写真を発見: ${date}`);

          // 写真をクリックして詳細を開く
          anchor.scrollIntoView({ block: 'center' });
          await sleep(200);
          anchor.click();
          await sleep(600);

          const result = await processCurrentPhoto();
          if (result.status === 'downloaded') counts.downloaded++;
          else if (result.status === 'failed_timeout') counts.failed++;
          else counts.skipped++;

          await sleep(600);
        } else if (date < from) {
          // 対象日より過去の写真
          processedHrefs.add(href);
        }
      }

      // 対象日より過去の写真までスクロール済みで、新規の対象がなければ終了判定
      if (oldestVisibleDate && oldestVisibleDate < from && !foundUnprocessedInCurrentView) {
        stagnantCount++;
        if (stagnantCount >= 3) {
          log('対象期間より過去の写真に到達したため、検索を完了します。');
          break;
        }
      } else {
        stagnantCount = 0;
      }

      // 次の写真をロードするためにスクロール
      const prevScrollY = window.scrollY;
      window.scrollBy(0, window.innerHeight * 1.2);
      await sleep(1000);

      // 最下部に到達してこれ以上スクロールできない場合
      if (window.scrollY === prevScrollY && !foundUnprocessedInCurrentView) {
        log('ページの末尾に到達しました。');
        break;
      }
    }

    const summary = `完了: DL ${counts.downloaded}件, スキップ ${counts.skipped}件, 失敗 ${counts.failed}件`;
    log(summary);
    setStatus(summary);
    setRunningUI(false);
  }

  // 初期化: ページ読み込み完了後にUIを追加
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(createUI, 1000));
  } else {
    setTimeout(createUI, 1000);
  }
})();
