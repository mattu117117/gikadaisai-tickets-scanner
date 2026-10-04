const $ = id => document.getElementById(id);
const money = value => new Intl.NumberFormat('ja-JP').format(Number(value) || 0);

async function api(action, { method='GET', body, pin, signal }={}) {
  const response = await fetch(`/api?action=${encodeURIComponent(action)}`, {
    method,
    headers: {
      ...(body ? { 'content-type':'application/json' } : {}),
      ...(pin ? { 'x-admin-pin':pin } : {})
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
    cache: 'no-store'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `通信エラー (${response.status})`);
  return data;
}

if (location.pathname.startsWith('/admin')) initAdmin();
else initScanner();

function initScanner() {
  const state = { processId:'', storeName:'', staffName:'', count:0, total:0, scanner:null, cameraId:null, queue:[], processing:false, recent:new Map(), finishing:false };
  $('scanner-app').classList.remove('hidden');
  $('admin-app').classList.add('hidden');
  $('start-button').addEventListener('click', () => startSession(false));
  $('manual-start-button').addEventListener('click', () => startSession(true));
  $('retry-camera-button').addEventListener('click', startCamera);
  $('manual-submit').addEventListener('click', () => onDecoded($('manual-id').value));
  $('manual-id').addEventListener('keydown', event => { if (event.key === 'Enter') onDecoded(event.currentTarget.value); });
  $('finish-button').addEventListener('click', finishSession);
  $('cancel-session-button').addEventListener('click', cancelSession);
  $('new-session-button').addEventListener('click', () => location.reload());
  $('reload-camera-page').addEventListener('click', () => location.reload());
  $('close-camera-help').addEventListener('click', () => $('camera-help-modal').classList.add('hidden'));
  loadStores();

  async function loadStores() {
    try {
      const data = await api('stores');
      if (data.environment === 'training') markTrainingMode();
      $('store-select').innerHTML = '<option value="">店舗を選択</option>';
      data.stores.forEach(store => {
        const option = document.createElement('option');
        option.value = store.id;
        option.textContent = store.name;
        $('store-select').appendChild(option);
      });
      restoreDraft();
      $('store-select').disabled = false;
      $('start-button').disabled = false;
      $('manual-start-button').disabled = false;
    } catch (error) {
      showSetupMessage(error.message, 'error');
    }
  }

  async function startSession(skipCamera) {
    const staffName = $('staff-name').value.trim();
    const storeId = $('store-select').value;
    if (!staffName || !storeId) return showSetupMessage('担当者名を入力し、店舗を選択してください。', 'error');
    if (typeof Html5Qrcode === 'undefined') return showSetupMessage('QR読取機能を読み込めません。ページを再読み込みしてください。', 'error');
    const trigger = skipCamera ? $('manual-start-button') : $('start-button');
    $('start-button').disabled = true;
    $('manual-start-button').disabled = true;
    trigger.textContent = skipCamera ? '回収を開始中...' : 'カメラを確認中...';
    try {
      if (!skipCamera) state.cameraId = await requestCameraPermission();
      trigger.textContent = '回収を開始中...';
      const result = await api('startSession', { method:'POST', body:{ staffName, storeId } });
      if (!result.success) {
        const message = result.status === 'store_in_use'
          ? `この店舗は ${result.staffName} さんが処理中です（${result.processId}）。`
          : '担当者または店舗が無効です。';
        return showSetupMessage(message, 'error');
      }
      Object.assign(state, { processId:result.processId, storeName:result.storeName, staffName:result.staffName, count:Number(result.count)||0, total:Number(result.totalAmount)||0 });
      $('current-store').textContent = state.storeName;
      $('current-staff').textContent = state.staffName;
      $('current-process').textContent = state.processId;
      updateTotals();
      showScreen('scan-screen');
      if (skipCamera) {
        $('reader').classList.add('hidden');
        $('camera-message').textContent = '手入力モードです。管理番号を入力して「登録」を押してください。';
        $('manual-entry').open = true;
      } else {
        await startCamera();
      }
    } catch (error) {
      showSetupMessage(error.message || '回収を開始できませんでした。', 'error');
    } finally {
      $('start-button').disabled = false;
      $('start-button').textContent = 'カメラを許可して回収開始';
      $('manual-start-button').disabled = false;
      $('manual-start-button').textContent = 'カメラを使わず手入力で開始';
    }
  }

  async function requestCameraPermission() {
    if (!window.isSecureContext) throw new Error('HTTPSのVercel URLで開いてください。');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('このブラウザはカメラに対応していません。Chrome最新版で開いてください。');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:{ ideal:'environment' } }, audio:false });
      const track = stream.getVideoTracks()[0];
      return track?.getSettings?.().deviceId || null;
    } catch (error) {
      if (isPermissionError(error)) showCameraHelp();
      throw new Error(cameraErrorMessage(error));
    } finally {
      stream?.getTracks().forEach(track => track.stop());
    }
  }

  async function startCamera() {
    $('retry-camera-button').classList.add('hidden');
    if (state.scanner) {
      try {
        if (state.scanner.isScanning) await state.scanner.stop();
        await state.scanner.clear();
      } catch (_) {}
    }
    state.scanner = new Html5Qrcode('reader');
    try {
      const camera = { facingMode:{ ideal:'environment' } };
      await state.scanner.start(camera, { fps:10, qrbox:(w,h) => ({ width:Math.min(w,h)*.72, height:Math.min(w,h)*.72 }), aspectRatio:1 }, onDecoded, () => {});
      $('camera-message').classList.add('hidden');
    } catch (error) {
      $('retry-camera-button').classList.remove('hidden');
      if (isPermissionError(error)) showCameraHelp();
      showResult('error', '✕', 'カメラを開始できません', cameraErrorMessage(error));
    }
  }

  function onDecoded(decodedText) {
    const id = String(decodedText || '').trim().toLowerCase();
    if (state.finishing || !id) return;
    $('manual-id').value = '';
    const now = Date.now();
    if (now - (state.recent.get(id) || 0) < 1500 || state.queue.includes(id)) return;
    state.recent.set(id, now);
    for (const [key,time] of state.recent) if (now - time > 10000) state.recent.delete(key);
    state.queue.push(id);
    processQueue();
  }

  async function processQueue() {
    if (state.processing || !state.queue.length || state.finishing) return;
    state.processing = true;
    const managementId = state.queue.shift();
    showResult('neutral', '…', '照会中', managementId);
    try {
      const result = await api('registerTicket', { method:'POST', body:{ managementId, processId:state.processId } });
      handleScanResult(result);
    } catch (error) {
      try {
        handleScanResult(await api('ticketStatus', { method:'POST', body:{ managementId, processId:state.processId } }));
      } catch (_) {
        showResult('error', '✕', '通信に失敗しました', '通信回復後にもう一度読み取ってください。');
      }
    } finally {
      state.processing = false;
      if (state.queue.length) processQueue();
    }
  }

  function handleScanResult(result) {
    switch (result.status) {
      case 'registered':
        state.count += 1;
        state.total += Number(result.amount)||0;
        updateTotals();
        showResult('success', '✓', result.reconciled ? '登録を確認しました' : '登録しました', `${result.managementId}\n${money(result.amount)}円`);
        feedback();
        break;
      case 'already_used': showResult('warning', '!', 'すでに使用済みです', `${result.managementId}\n使用店舗：${result.usedStore||'不明'}\n使用日時：${result.usedAt||'不明'}\n確認担当：${result.usedBy||'不明'}`); break;
      case 'not_found': showResult('error', '✕', '未登録の商品券です', result.managementId || ''); break;
      case 'invalid': showResult('error', '✕', '商品券ではありません', '管理番号の形式が違います。'); break;
      case 'session_closed': showResult('error', '✕', '回収は終了済みです', '新しい回収を開始してください。'); break;
      case 'unused': showResult('error', '✕', '登録されていません', 'もう一度読み取ってください。'); break;
      default: showResult('error', '✕', '登録できませんでした', result.message || 'もう一度お試しください。');
    }
  }

  async function finishSession() {
    if (state.processing || state.queue.length) return showResult('warning', '!', '処理中です', '読取処理が終わるまでお待ちください。');
    if (!await confirmAction('回収内容の確認', `${state.storeName} / ${state.count}枚 / ${money(state.total)}円\n現物の枚数と一致していますか？`, '回収終了')) return;
    state.finishing = true;
    try {
      const result = await api('finishSession', { method:'POST', body:{ processId:state.processId } });
      if (state.scanner?.isScanning) await state.scanner.stop();
      $('complete-store').textContent = result.storeName || state.storeName;
      $('complete-count').textContent = money(result.count);
      $('complete-total').textContent = money(result.totalAmount);
      showScreen('complete-screen');
    } catch (error) {
      state.finishing = false;
      showResult('error', '✕', '回収終了に失敗しました', error.message);
    }
  }

  async function cancelSession() {
    if (!await confirmAction('回収をキャンセル', 'まだ1枚も登録していない回収だけキャンセルできます。', 'キャンセルする')) return;
    try {
      const result = await api('cancelSession', { method:'POST', body:{ processId:state.processId } });
      if (!result.success) throw new Error(result.status === 'has_registered_tickets' ? `${result.count}枚登録済みです。「回収終了」を押してください。` : 'キャンセルできませんでした。');
      if (state.scanner?.isScanning) await state.scanner.stop();
      location.reload();
    } catch (error) {
      showResult('error', '✕', 'キャンセルできません', error.message);
    }
  }

  function showCameraHelp() {
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const steps = isIOS
      ? ['iPhoneの「設定」→「アプリ」→「Chrome」→「カメラ」をオンにします。','Chromeへ戻り、アドレスバー左側のカメラマーク→サイトの権限もオンにします。','この画面の「設定後に再読み込み」を押します。']
      : ['アドレスバー左側のサイト情報マーク→「権限」を開きます。','「カメラ」→「許可」を選びます。','項目がなければChromeの「︙」→「設定」→「サイトの設定」→「カメラ」で、このVercelサイトを許可します。'];
    $('camera-help-steps').replaceChildren(...steps.map(text => Object.assign(document.createElement('li'), { textContent:text })));
    $('camera-help-modal').classList.remove('hidden');
  }

  function restoreDraft() {
    try {
      const draft = JSON.parse(sessionStorage.getItem('setupDraft') || 'null');
      if (draft) { $('staff-name').value=draft.staffName||''; $('store-select').value=draft.storeId||''; }
    } catch (_) {}
    $('staff-name').addEventListener('input', saveDraft);
    $('store-select').addEventListener('change', saveDraft);
  }
  function saveDraft() { sessionStorage.setItem('setupDraft', JSON.stringify({ staffName:$('staff-name').value, storeId:$('store-select').value })); }
  function updateTotals() { $('scan-count').textContent=money(state.count); $('scan-total').textContent=money(state.total); }
  function showScreen(id) { document.querySelectorAll('#scanner-app .screen').forEach(el => el.classList.remove('active')); $(id).classList.add('active'); scrollTo(0,0); }
  function showResult(kind,icon,title,detail) { $('result').className=`result ${kind}`; $('result-icon').textContent=icon; $('result-title').textContent=title; $('result-detail').textContent=detail||''; }
  function showSetupMessage(text,kind) { const el=$('startup-message'); el.textContent=text; el.className=`message ${kind}`; }
  function isPermissionError(error) { return ['NotAllowedError','PermissionDeniedError','SecurityError'].includes(error?.name); }
  function cameraErrorMessage(error) {
    if (isPermissionError(error)) return 'カメラが許可されていません。表示された手順で許可してください。';
    if (['NotFoundError','DevicesNotFoundError'].includes(error?.name)) return '使用できるカメラが見つかりません。';
    if (['NotReadableError','TrackStartError'].includes(error?.name)) return 'ほかのアプリがカメラを使用しています。閉じてからお試しください。';
    return 'カメラを開始できませんでした。ページを再読み込みしてください。';
  }
  function feedback() { if (navigator.vibrate) navigator.vibrate(120); }
}

function initAdmin() {
  $('scanner-app').classList.add('hidden');
  $('admin-app').classList.remove('hidden');
  document.title = '商品券データ';
  const state = { pin:sessionStorage.getItem('adminPin')||'', table:'tickets', query:'', page:1, pageSize:100, total:0, timer:null };
  const tables = [
    ['tickets','商品券マスター'],['usage_logs','使用ログ'],['sessions','回収セッション'],['stores','店舗マスター'],['staff','担当者マスター'],['cancellations','取消ログ']
  ];
  $('admin-login').addEventListener('submit', event => { event.preventDefault(); login(); });
  $('data-search').addEventListener('input', event => { clearTimeout(state.timer); state.timer=setTimeout(()=>{state.query=event.target.value.trim();state.page=1;loadTable();},250); });
  $('prev-page').addEventListener('click', () => { if (state.page>1) {state.page--;loadTable();} });
  $('next-page').addEventListener('click', () => { if (state.page*state.pageSize<state.total) {state.page++;loadTable();} });
  $('export-csv').addEventListener('click', exportCsv);
  $('copy-table').addEventListener('click', copyTable);
  $('reset-training').addEventListener('click', resetTraining);
  if (state.pin) login(true);

  async function login(silent=false) {
    const pin = silent ? state.pin : $('admin-pin').value;
    if (!pin) return;
    setBusy($('admin-login-button'), true, '確認中...');
    try {
      state.pin = pin;
      const summary = await api('adminSummary', { pin });
      sessionStorage.setItem('adminPin', pin);
      renderSummary(summary);
      if (summary.environment === 'training') {
        markTrainingMode();
        $('training-tools').classList.remove('hidden');
      }
      renderTabs();
      $('admin-login').classList.add('hidden');
      $('admin-dashboard').classList.remove('hidden');
      await loadTable();
    } catch (error) {
      sessionStorage.removeItem('adminPin');
      if (!silent) { $('admin-error').textContent=error.message; $('admin-error').classList.remove('hidden'); }
    } finally { setBusy($('admin-login-button'), false, 'データを表示'); }
  }

  function renderSummary(data) {
    const cards = [['全商品券',`${money(data.ticketCount)}枚`],['使用済み',`${money(data.usedCount)}枚`],['使用済み合計',`${money(data.usedAmount)}円`]];
    $('admin-summary').replaceChildren(...cards.map(([label,value]) => { const card=document.createElement('div');card.className='summary-card';card.innerHTML=`<span></span><strong></strong>`;card.firstChild.textContent=label;card.lastChild.textContent=value;return card; }));
  }
  function renderTabs() {
    $('table-tabs').replaceChildren(...tables.map(([id,label]) => { const button=document.createElement('button');button.textContent=label;button.classList.toggle('active',id===state.table);button.addEventListener('click',()=>{state.table=id;state.page=1;renderTabs();loadTable();});return button; }));
  }
  async function loadTable() {
    const params = new URLSearchParams({ action:'adminData', table:state.table, q:state.query, page:String(state.page), pageSize:String(state.pageSize) });
    try {
      const response = await fetch(`/api?${params}`, { headers:{'x-admin-pin':state.pin}, cache:'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'データを取得できませんでした。');
      state.total = data.total;
      renderTable(data.columns, data.rows);
      $('data-count').textContent = `${money(data.total)}件`;
      const pages = Math.max(1, Math.ceil(data.total/state.pageSize));
      $('page-label').textContent = `${state.page} / ${pages}`;
      $('prev-page').disabled = state.page<=1;
      $('next-page').disabled = state.page>=pages;
    } catch (error) { $('data-count').textContent=error.message; }
  }
  function renderTable(columns, rows) {
    const headRow=document.createElement('tr');
    columns.forEach(column=>{const th=document.createElement('th');th.textContent=column.label;headRow.appendChild(th);});
    $('data-table').tHead.replaceChildren(headRow);
    if (!rows.length) { const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=columns.length;td.className='data-empty';td.textContent='該当するデータはありません。';tr.appendChild(td);$('data-table').tBodies[0].replaceChildren(tr);return; }
    $('data-table').tBodies[0].replaceChildren(...rows.map(row=>{const tr=document.createElement('tr');columns.forEach(column=>{const td=document.createElement('td');td.textContent=formatCell(row[column.key],column.type);tr.appendChild(td);});return tr;}));
  }
  async function exportCsv() {
    setBusy($('export-csv'),true,'作成中...');
    try {
      const params=new URLSearchParams({action:'adminExport',table:state.table,q:state.query});
      const response=await fetch(`/api?${params}`,{headers:{'x-admin-pin':state.pin}});
      if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.message||'CSVを出力できませんでした。');}
      const blob=await response.blob();
      const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`${tables.find(([id])=>id===state.table)?.[1]||state.table}.csv`;link.click();URL.revokeObjectURL(url);
    } catch(error){alert(error.message);} finally{setBusy($('export-csv'),false,'表示中のデータをCSV出力');}
  }
  async function copyTable() {
    setBusy($('copy-table'),true,'コピー中...');
    try {
      const params=new URLSearchParams({action:'adminExport',table:state.table,q:state.query,format:'tsv'});
      const response=await fetch(`/api?${params}`,{headers:{'x-admin-pin':state.pin}});
      if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.message||'コピーできませんでした。');}
      await navigator.clipboard.writeText(await response.text());
      setBusy($('copy-table'),false,'コピーしました');
      setTimeout(()=>setBusy($('copy-table'),false,'スプレッドシートへコピー'),1400);
    } catch(error){alert(error.message);setBusy($('copy-table'),false,'スプレッドシートへコピー');}
  }
  async function resetTraining() {
    if (!await confirmAction('練習データを初期化', '使用ログ・回収セッション・取消ログを削除し、全商品券を未使用へ戻します。\n本番環境のデータには影響しません。', '初期化する')) return;
    setBusy($('reset-training'),true,'初期化中...');
    try {
      const result = await api('resetTraining',{method:'POST',pin:state.pin});
      alert(`${result.message}\n商品券 ${money(result.ticketCount)}件`);
      location.reload();
    } catch(error) {
      alert(error.message);
      setBusy($('reset-training'),false,'練習データを初期化');
    }
  }
}

function formatCell(value,type) {
  if (value == null) return '';
  if (type === 'date') return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(value));
  if (type === 'number') return money(value);
  if (type === 'boolean') return value ? '有効' : '無効';
  return String(value);
}
function setBusy(button,busy,label){button.disabled=busy;button.textContent=label;}
function markTrainingMode(){
  $('environment-banner').classList.remove('hidden');
  document.body.classList.add('training-environment');
  if (!document.title.startsWith('【練習】')) document.title=`【練習】${document.title}`;
}
function confirmAction(title,text,yesLabel){return new Promise(resolve=>{const modal=$('confirm-modal');$('confirm-title').textContent=title;$('confirm-text').textContent=text;$('confirm-text').style.whiteSpace='pre-line';$('confirm-yes').textContent=yesLabel;modal.classList.remove('hidden');const done=value=>{modal.classList.add('hidden');$('confirm-no').onclick=null;$('confirm-yes').onclick=null;resolve(value);};$('confirm-no').onclick=()=>done(false);$('confirm-yes').onclick=()=>done(true);});}
