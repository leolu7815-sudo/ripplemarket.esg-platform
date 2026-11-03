// 點數存於此瀏覽器，基礎資料另存於雲端；診斷紀錄遮蔽問卷個資。
let storageKey = null;
let currentSession = null;
let authGeneration = 0;
let loginTimer;
let registering = false;
let authBusy = false;
const initialState = { balance: 150, generalPoints: 200, impact: 12.8, claims: {}, history: [{ title: '歡迎加入泉漣綠生活', amount: 150, date: '新會員體驗點數' }] };
let state = clone(initialState);
let savedSnapshot = null;
let loadBlocked = false;
let startupMessage = '';
let updating = false;
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function log(stage, data = {}) {
  // 先轉成字串以記錄當下快照，避免稍後檢視時看到已改變的物件。
  const snapshot = JSON.stringify(data, (key, value) => ['profile', 'birthday', 'charity', 'fullName', 'username', 'password', 'newPassword', 'accessToken', 'refreshToken'].includes(key) ? '已遮蔽個人資料' : value);
  console.log('【泉漣診斷】' + stage, snapshot);
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function assertState(value) {
  if (!object(value) || !Number.isSafeInteger(value.balance) || !Number.isSafeInteger(value.generalPoints) || value.generalPoints < 0 || !Number.isFinite(value.impact) || value.impact < 0 || !object(value.claims) || !Array.isArray(value.history)) throw new Error('儲存資料格式不完整，請先確認原有資料。');
  for (const record of value.history) {
    if (!object(record) || typeof record.title !== 'string' || typeof record.date !== 'string' || !Number.isSafeInteger(record.amount) || (record.code !== undefined && typeof record.code !== 'string')) throw new Error('點數紀錄格式異常，已停止變更以保護原有資料。');
  }
  if (Object.values(value.claims).some(date => typeof date !== 'string')) throw new Error('任務領取紀錄格式異常，請先確認原有資料。');
  if (value.profile !== undefined && (!object(value.profile) || typeof value.profile.birthday !== 'string' || (value.profile.charity !== undefined && typeof value.profile.charity !== 'string'))) throw new Error('問卷資料格式異常，請先確認原有資料。');
}
function readState(importLegacy = false) {
  state = clone(initialState);
  loadBlocked = false;
  startupMessage = '';
  log('準備讀取裝置資料');
  try {
    savedSnapshot = localStorage.getItem(storageKey);
    const previousName = String.fromCharCode(0x9752, 0x65e5);
    const canImport = importLegacy && !localStorage.getItem('泉漣舊資料所屬帳號');
    const raw = savedSnapshot ?? (canImport ? localStorage.getItem('泉漣綠色點數') || localStorage.getItem(previousName + '綠色點數') : null);
    if (raw === null) { log('首次使用，採用初始資料', { state }); return; }
    const loaded = JSON.parse(raw.split(previousName).join('泉漣').split('好物' + '兌換').join('適用商品範疇'));
    log('已解析裝置資料', { state: loaded });
    if (!object(loaded)) throw new Error('裝置資料不是有效的會員資料。');
    // 僅補上舊版缺少的欄位；已存在但損壞的欄位不自動重設。
    if (loaded.generalPoints === undefined) loaded.generalPoints = 200;
    if (loaded.claims === undefined) loaded.claims = {};
    assertState(loaded);
    const welcome = loaded.history.find(record => record.date === '新會員體驗點數');
    if (welcome && welcome.amount === 1280) {
      loaded.balance += 150 - welcome.amount;
      welcome.amount = 150;
    }
    assertState(loaded);
    // 相容僅填過生日的舊資料，機構名稱可於表單中補填。
    state = loaded;
    log('資料載入完成', { state });
  } catch {
    loadBlocked = true;
    startupMessage = '無法讀取原有資料，暫時顯示示範內容並停用儲存與點數變更。原有資料未被覆寫，請確認瀏覽器允許儲存資料，或回報此問題。';
    log('資料讀取失敗，保留原有內容並停止寫入', { state, loadBlocked });
  }
}
function required(selector) {
  const element = document.querySelector(selector);
  if (!element) throw new Error('頁面部分欄位未完整載入，請重新整理後再試。');
  return element;
}
function showError(message) {
  const box = document.querySelector('#app-error');
  if (box) { box.textContent = message; box.hidden = false; }
  else { window.alert(message); }

  if (!currentSession && !document.querySelector('#birthday-dialog')?.open) required('#login-error').textContent = message;
  const formError = document.querySelector('#questionnaire-error');
  if (formError && document.querySelector('#birthday-dialog')?.open) formError.textContent = message;
}
async function guard(label, action) {
  try { return await action(); }
  catch (error) {
    const message = error instanceof Error && /[\u3400-\u9fff]/.test(error.message) ? error.message : '操作未完成，請重新整理頁面後再試。若持續發生，請回報剛才的操作。';
    log(label + '失敗', { message, state, updating, loadBlocked });
    showError(message);
    return false;
  }
}
function on(target, event, label, action) {
  target.addEventListener(event, value => guard(label, () => action(value)));
}
// 先在副本完成計算與驗證，再儲存；儲存失敗時原本的餘額不會改變。
function commit(label, change) {
  if (!currentSession || !storageKey) throw new Error('請先登入帳號。');

  if (loadBlocked) throw new Error('原有資料尚未成功載入，暫時無法變更。請先確認瀏覽器儲存權限或回報問題。');
  if (updating) throw new Error('上一筆操作尚未完成，請稍後再試。');
  updating = true;
  try {
    log(label + '：更新前', { state });
    let current;
    try { current = localStorage.getItem(storageKey); }
    catch { throw new Error('無法讀取裝置儲存空間，本次操作未完成，點數未變更。'); }
    if (current !== savedSnapshot) throw new Error('資料已在其他分頁變更，請重新整理後再操作，避免重複扣點。');
    const next = clone(state);
    change(next);
    assertState(next);
    log(label + '：驗證完成，準備儲存', { next });
    const serialized = JSON.stringify(next);
    try { localStorage.setItem(storageKey, serialized); }
    catch { throw new Error('裝置儲存失敗，可能是空間不足或瀏覽器限制。本次操作未完成，點數與問卷均未變更。'); }
    savedSnapshot = serialized;
    state = next;
    log(label + '：儲存與狀態更新成功', { state });
    const box = document.querySelector('#app-error');
    if (box) box.hidden = true;
  } finally { updating = false; }
  // 顯示失敗與交易失敗分開處理，避免用戶誤以為未扣點而重試。
  try { render(); }
  catch {
    log(label + '：資料已儲存但畫面更新失敗', { state });
    throw new Error('資料已成功儲存，但畫面未能更新。請重新整理查看結果，請勿重複提交。');
  }
}
// 最後一道保護，捕捉頁面與雲端請求未處理的例外。
window.addEventListener('error', () => {
  log('捕捉未處理的頁面錯誤');
  showError('頁面發生未預期問題，請重新整理。若剛完成操作，請先確認點數紀錄再重試。');
});
window.addEventListener('unhandledrejection', () => {
  log('捕捉未處理的非同步錯誤');
  showError('背景操作未完成，請檢查頁面狀態後再試。');
});

// 登入成功後才載入該帳號的裝置資料。
const rewards = [
  { id: 'discount', title: '泉漣購物折抵金', description: '新鮮好食，給你一點小回饋', points: 60, type: 'discount', art: '<div class="coupon-art"><small>泉漣生鮮・購物金</small><strong>30</strong><span> 元</span></div>', tag: '人氣首選' },
  { id: 'bag', title: '把綠帶著走・棉布袋', description: '可重複使用，裝下日常的美好', points: 800, type: 'goods', art: '<span class="product-emoji">🛍️</span>', tag: '永續選物' },
  { id: 'vegetables', title: '在地當季・鮮蔬小箱', description: '來自土地的心意，新鮮剛剛好', points: 1200, type: 'goods', art: '<span class="product-emoji">🥦🥕</span>', tag: '產地直送' }
];
const labels = { home: ['點數總覽', '多一點綠，多一綠點', '從自備購物袋開始，讓每一次採買都更有意義。'], about: ['關於泉漣', '和泉漣一起，讓永續走進日常。', '了解我們的預期目標、永續作為與永續報告書。'], rewards: ['適用商品範疇', '看看哪些商品，適用綠色點數。', '探索購物折抵與永續選物，選擇適合你的點數回饋。'], wallet: ['我的兌換商品', '把已兌換的美好，收進口袋。', '查看手上擁有的優惠券、兌換物與兌換碼。'], history: ['點數紀錄', '每一步，都留下綠色足跡。', '在這裡看看你累積的點數，以及兌換的美好。'] };
const modal = document.querySelector('#modal');
let currentFilter = 'all';
let toastTimer;
let pendingReward = null;
function notify(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}
function showPage(page) {
  if (!currentSession) return;

  if (!Object.hasOwn(labels, page)) throw new Error('找不到指定頁面，請由選單重新選擇。');
  log('切換頁面', { page });
  required('#news-slot').hidden = page !== 'home';
  document.querySelectorAll('.page').forEach(section => section.hidden = section.id !== page);
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  required('#page-label').textContent = labels[page][0];
  required('#heading').textContent = labels[page][1];
  required('#subtitle').textContent = labels[page][2];
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function rewardHTML(reward) {
  return `<article class="reward-card"><div class="product-art ${reward.id}"><span class="product-tag">${reward.tag}</span>${reward.art}</div><div class="reward-content"><h3>${reward.title}</h3><p>${reward.description}</p><div class="reward-bottom"><strong>${reward.points.toLocaleString()}<span>點</span></strong><button class="redeem" data-redeem="${reward.id}">立即兌換 ↗</button></div></div></article>`;
}
// 將儲存內容當成文字顯示，避免被解讀成網頁語法。
function safeText(value) { const element = document.createElement('span'); element.textContent = String(value); return element.innerHTML.replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }
function render() {
  assertState(state);
  log('準備更新畫面', { state, currentFilter });
  required('#balance').textContent = state.balance.toLocaleString();
  renderDonations();
  renderWallet();
  required('#home-rewards').innerHTML = rewards.map(rewardHTML).join('');
  required('#all-rewards').innerHTML = rewards.filter(reward => currentFilter === 'all' || reward.type === currentFilter).map(rewardHTML).join('') || '<p class="empty-state">此分類目前沒有可兌換商品。</p>';
  required('#history-list').innerHTML = state.history.map(record => `<div class="history-row"><span class="history-symbol">${record.amount > 0 ? '↗' : '♧'}</span><div><strong>${safeText(record.title)}</strong><p>${safeText(record.date)}</p>${record.code ? `<div class="voucher">體驗兌換碼：${safeText(record.code)}（無實際效力）</div>` : ''}</div><span class="history-amount ${record.amount < 0 ? 'minus' : ''}">${record.amount > 0 ? '＋' : '−'}${Math.abs(record.amount).toLocaleString()} 點</span></div>`).join('') || '<p class="empty-state">目前沒有點數紀錄。</p>';
}
function openModal(content) {
  pendingReward = null;
  required('#modal-content').innerHTML = content;
  if (typeof modal.showModal !== 'function') throw new Error('目前瀏覽器不支援此視窗，請使用較新版本的瀏覽器。');
  if (!modal.open) modal.showModal();
  log('彈出視窗已開啟');
}
function redeem(id) {
  const reward = rewards.find(item => item.id === id);
  if (!reward) throw new Error('這項商品目前無法兌換，請重新整理後再試。');
  const enough = state.balance >= reward.points;
  openModal(`<span class="modal-icon">🎁</span><h2>${reward.title}</h2><p>兌換需要 <strong>${reward.points.toLocaleString()} 點</strong>，目前持有 ${state.balance.toLocaleString()} 點。${enough ? `兌換後將剩餘 ${(state.balance - reward.points).toLocaleString()} 點。` : `還差 ${(reward.points - state.balance).toLocaleString()} 點，可透過綠點商品消費或通用點數轉換累積。`}</p><p>此為體驗兌換，產生的兌換碼無實際效力。兌換後可於點數紀錄查看。</p><div class="modal-actions"><button data-close>再想一下</button><button class="primary" data-confirm="${id}" ${enough ? '' : 'disabled'}>確認兌換</button></div>`);
  pendingReward = id;
}
on(document, 'click', '按鈕操作', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.page) showPage(button.dataset.page);
  if (button.dataset.goto) showPage(button.dataset.goto);
  if (button.dataset.about) showAbout(button.dataset.about);
  if (button.dataset.wallet) {
    if (!['all', 'discount', 'goods'].includes(button.dataset.wallet)) return;
    walletFilter = button.dataset.wallet;
    renderWallet();
  }
  if (button.dataset.owned) showOwnedReward(button.dataset.owned);
  if (button.dataset.redeem) redeem(button.dataset.redeem);
  if (button.hasAttribute('data-close') || button.classList.contains('close')) modal.close();
  if (button.dataset.filter) {
    if (!['all', 'discount', 'goods'].includes(button.dataset.filter)) throw new Error('找不到指定的商品分類。');
    currentFilter = button.dataset.filter;
    document.querySelectorAll('.filter').forEach(item => item.classList.toggle('active', item === button));
    render();
  }
  if (button.dataset.confirm) {
    if (!modal.open || pendingReward !== button.dataset.confirm) return;
    const reward = rewards.find(item => item.id === button.dataset.confirm);
    if (!reward || state.balance < reward.points) throw new Error('商品不存在或綠點不足，請重新確認餘額。');
    if (button.disabled) return;
    button.disabled = true;
    // 再次檢查餘額後才扣點，並同時記錄兌換碼。

    const code = '泉漣' + Date.now().toString().slice(-8);
    try {
      commit('商品兌換', next => {
        next.balance -= reward.points;
        next.history.unshift({ title: reward.title, amount: -reward.points, date: new Date().toLocaleString('zh-TW'), code, rewardId: reward.id, rewardType: reward.type });
      });
      pendingReward = null;
    } finally { button.disabled = false; }
    modal.close();
    openModal(`<span class="modal-icon">✓</span><h2>美好回饋，兌換成功！</h2><p>${reward.title}<br>體驗兌換碼：<strong>${code}</strong><br>此碼無實際效力，可隨時於我的兌換商品查看。</p><div class="modal-actions"><button class="primary" data-close data-goto="wallet">查看我的兌換商品 ↗</button></div>`);
  }
});
// 所有轉換均以整數點數計算，並在送出時再次驗證餘額。
function conversionAmount(value) {
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 && amount <= state.generalPoints && Number.isSafeInteger(amount * 4) && Number.isSafeInteger(state.balance + amount * 4) ? amount : 0;
}
function openConversion() {
  openModal(`<span class="modal-icon">⇄</span><h2>通用點數轉換</h2><p>非綠點商品消費所累積的通用點數</p><div class="conversion-balance"><span>可用通用點數</span><strong>${state.generalPoints.toLocaleString()} <small>點</small></strong></div><p class="conversion-note">體驗版：初始提供 200 點示範通用點數，尚未串接實際消費資料。</p><form id="conversion-form"><label for="conversion-amount">想轉換多少通用點數？</label><div class="conversion-input"><input id="conversion-amount" type="number" min="1" max="${state.generalPoints}" step="1" placeholder="請輸入整數點數" required aria-describedby="conversion-preview"><button type="button" id="convert-all" ${state.generalPoints === 0 ? 'disabled' : ''}>全部轉換</button></div><p>1 點通用點數 → 4 點綠點，僅限單向轉換。</p><div id="conversion-preview" class="conversion-preview" role="status">${state.generalPoints === 0 ? '目前沒有可轉換的通用點數。' : '輸入點數，即可預覽轉換結果。'}</div><div class="modal-actions"><button type="button" data-close>取消</button><button type="submit" class="primary" id="conversion-submit" disabled>確認轉換</button></div></form>`);
}
function updateConversion() {
  const amount = conversionAmount(required('#conversion-amount').value);
  log('轉換輸入驗證', { amount, generalPoints: state.generalPoints, balance: state.balance });
  required('#conversion-submit').disabled = !amount;
  required('#conversion-preview').textContent = amount ? `獲得 ${(amount * 4).toLocaleString()} 點綠點；轉換後剩餘 ${(state.generalPoints - amount).toLocaleString()} 點通用點數，綠點餘額 ${(state.balance + amount * 4).toLocaleString()} 點。` : '請輸入大於零且不超過餘額的整數點數。';
}
on(required('#convert-points'), 'click', '開啟點數轉換', openConversion);
on(document, 'input', '輸入點數', event => {
  if (event.target.id === 'conversion-amount') updateConversion();
});
on(document, 'click', '按鈕操作', event => {
  if (event.target.closest('#convert-all')) {
    required('#conversion-amount').value = state.generalPoints;
    updateConversion();
  }
});
on(document, 'submit', '送出表單', event => {
  if (event.target.id !== 'conversion-form') return;
  event.preventDefault();
  if (!modal.open) return;
  event.preventDefault();
  const amount = conversionAmount(required('#conversion-amount').value);
  log('轉換輸入驗證', { amount, generalPoints: state.generalPoints, balance: state.balance });
  if (!amount) { updateConversion(); return; }
  // 扣除通用點數、增加綠點與新增紀錄一起完成，不影響減碳量。
  commit('通用點數轉換', next => {
  next.generalPoints -= amount;
  next.balance += amount * 4;
  next.history.unshift({ title: `通用點數轉換（使用 ${amount.toLocaleString()} 點通用點數）`, amount: amount * 4, date: new Date().toLocaleString('zh-TW') });
  });
  modal.close();
  notify(`轉換成功！${amount.toLocaleString()} 點通用點數已轉為 ${(amount * 4).toLocaleString()} 點綠點。`);
});
// 基礎資料使用獨立視窗，表單結構放在頁面中，方便直接修改。
const birthdayDialog = required('#birthday-dialog');
function validBirthday(year, month, day) {
  if (![year, month, day].every(Number.isInteger)) return false;
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const birthday = new Date(year, month - 1, day);
  return birthday.getFullYear() === year && birthday.getMonth() === month - 1 && birthday.getDate() === day && birthday <= new Date();
}
// 問卷與捐贈以登入權杖識別用戶，密碼與權杖僅保留於本次記憶體。
const charityOptions = ["台灣流浪動物救援協會","家扶基金會","台灣世界展望會","伊甸社會福利基金會","創世社會福利基金會"];
const questionnaireUrl = 'https://qosztllyrhzdvpmyaaok.supabase.co/functions/v1/customer-questionnaire';
let profileBusy = false;
function validCredential(value) { return typeof value === 'string' && /^[!-~]{6,12}$/.test(value); }
function validPassword(value) { return validCredential(value) && /[A-Z]/.test(value) && /[a-z]/.test(value); }
function setProfileBusy(busy, message) {
  profileBusy = busy;
  required('#questionnaire-status').textContent = message;
  required('#questionnaire-form').setAttribute('aria-busy', String(busy));
  for (const id of ['profile-name','profile-username','profile-password','legacy-import','birthday-fields','charity-name','save-profile','cancel-birthday','close-birthday']) required('#' + id).disabled = busy;
  required('#save-profile').textContent = busy ? '連線中…' : '儲存至雲端';
}
async function cloudRequest(query, method = 'GET', payload, session = currentSession) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  const headers = { 'Content-Type': 'application/json' };
  if (session) headers.Authorization = 'Bearer ' + session.accessToken;
  if (payload?.importLegacy) {
    const legacy = localStorage.getItem('泉漣基礎資料存取碼');
    if (legacy) headers['X-Profile-Token'] = legacy;
  }
  try {
    const response = await fetch(questionnaireUrl + query, { method, headers, body: payload ? JSON.stringify(payload) : undefined, credentials: 'omit', cache: 'no-store', signal: controller.signal });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 && session && currentSession === session) lockApp('登入已到期，請重新登入。');
      throw new Error(typeof data.error === 'string' ? data.error : '雲端操作未完成，請稍後再試。');
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('雲端連線逾時，請稍後重試；若剛建立帳號，可先嘗試登入。');
    if (error instanceof TypeError) throw new Error('無法連線至雲端，請確認網路後再試。');
    throw error;
  } finally { clearTimeout(timer); }
}
async function requestProfile(method, profile, view = 'profile') {
  const session = currentSession;
  if (view !== 'news' && !session) throw new Error('請先登入帳號。');
  const data = await cloudRequest(['news', 'donations'].includes(view) ? '?view=' + view : '', method, profile, session);
  if (view !== 'news' && session !== currentSession) throw new Error('登入狀態已變更，請重新開啟資料。');
  if (view === 'news') {
    if (!validSpotlight(data.news) || typeof data.stale !== 'boolean') throw new Error('新聞資料回應不完整。');
    return { ...data.news, stale: data.stale };
  }
  if (view === 'donations') {
    if (!Array.isArray(data.donations)) throw new Error('捐贈紀錄回應不完整。');
    return data.donations;
  }
  if (!object(data.profile) || typeof data.profile.fullName !== 'string' || !validCredential(data.profile.username) || typeof data.profile.birthday !== 'string' || !charityOptions.includes(data.profile.charity) || data.profile.donationRate !== 0.01) throw new Error('基礎資料格式異常，請稍後重試。');
  return data;
}
function fillProfile(profile) {
  required('#profile-name').value = profile?.fullName || '';
  required('#profile-username').value = profile?.username || '';
  required('#profile-password').value = '';
  const parts = profile ? profile.birthday.split('-') : [];
  required('#birthday-year').value = parts[0] || '';
  required('#birthday-month').value = parts[1] || '';
  required('#birthday-day').value = parts[2] || '';
  required('#charity-name').value = charityOptions.includes(profile?.charity) ? profile.charity : '';
}
function cacheProfile(profile) {
  state.profile = clone(profile);
  try {
    if (loadBlocked) return false;
    const raw = localStorage.getItem(storageKey);
    const next = raw !== savedSnapshot && raw !== null ? JSON.parse(raw) : clone(state);
    next.profile = clone(profile);
    assertState(next);
    const serialized = JSON.stringify(next);
    localStorage.setItem(storageKey, serialized);
    savedSnapshot = serialized;
    state = next;
    updateMemberName();
    return true;
  } catch { log('雲端資料已確認，本地快取暫時無法更新'); return false; }
}
async function openBirthdayQuestionnaire() {
  if (!currentSession || profileBusy) return;
  registering = false;
  prepareProfileForm();
  fillProfile(state.profile);
  birthdayDialog.showModal();
  setProfileBusy(true, '正在讀取雲端資料…');
  try {
    const data = await requestProfile('GET');
    fillProfile(data.profile);
    cacheProfile(data.profile);
  } finally { setProfileBusy(false, '資料綁定目前登入帳號。'); }
}
function prepareProfileForm() {
  required('#birthday-year').max = new Date().getFullYear();
  required('#birthday-title').textContent = registering ? '建立泉漣帳號' : '基礎資料';
  required('#profile-password-label').textContent = registering ? '設定密碼' : '設定新密碼（選填）';
  required('#profile-password').required = registering;
  required('#legacy-import-label').hidden = !registering;
  required('#questionnaire-error').textContent = '';
  required('#questionnaire-status').textContent = '';
}
on(required('#open-questionnaire'), 'click', '開啟基礎資料', openBirthdayQuestionnaire);
on(required('#close-birthday'), 'click', '關閉基礎資料', () => { if (!profileBusy) birthdayDialog.close(); });
on(required('#cancel-birthday'), 'click', '稍後填寫基礎資料', () => { if (!profileBusy) birthdayDialog.close(); });
on(birthdayDialog, 'cancel', '等待基礎資料連線', event => { if (profileBusy) event.preventDefault(); });
on(required('#questionnaire-form'), 'submit', '儲存基礎資料', async event => {
  event.preventDefault();
  if (!birthdayDialog.open || profileBusy) return;
  const fullName = required('#profile-name').value.trim();
  const username = required('#profile-username').value;
  const password = required('#profile-password').value;
  const year = Number(required('#birthday-year').value);
  const month = Number(required('#birthday-month').value);
  const day = Number(required('#birthday-day').value);
  const charity = required('#charity-name').value;
  const error = required('#questionnaire-error');
  error.textContent = '';
  if (!fullName || fullName.length > 80) { error.textContent = '請填寫姓名，最多八十個字。'; return; }
  if (!validCredential(username)) { error.textContent = '帳號須為六至十二碼英文字母、數字或特殊符號，不含空白。'; return; }
  if ((registering || password) && !validPassword(password)) { error.textContent = '密碼須為六至十二碼，且同時包含英文大寫與小寫。'; required('#profile-password').focus(); return; }
  if (!validBirthday(year, month, day)) { error.textContent = '請輸入有效的西元出生年月日。'; return; }
  if (!charityOptions.includes(charity)) { error.textContent = '請選擇欲捐贈的慈善機構。'; return; }
  const birthday = String(year) + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
  const payload = { fullName, username, birthday, charity, donationRate: 0.01 };
  setProfileBusy(true, registering ? '正在建立帳號…' : '正在儲存資料…');
  let message = '操作未完成時，可確認資料後重試。';
  try {
    if (registering) {
      const importLegacy = required('#legacy-import').checked;
      const generation = authGeneration;
      const data = await cloudRequest('?action=register', 'POST', { ...payload, password, importLegacy }, null);
      if (generation !== authGeneration) return;
      await enterAccount(data, importLegacy);
      birthdayDialog.close();
      message = '帳號已建立並登入。';
      notify(message);
    } else {
      const data = await requestProfile('PUT', { ...payload, ...(password ? { newPassword: password } : {}) });
      cacheProfile(data.profile);
      currentSession.username = data.profile.username;
      updateMemberName();
      if (data.notice) { error.textContent = data.notice; message = '部分資料已更新，請確認上方提示。'; return; }
      birthdayDialog.close();
      message = '基礎資料已儲存至雲端。';
      notify(message);
    }
  } finally { required('#profile-password').value = ''; setProfileBusy(false, message); }
});
on(required('#help'), 'click', '開啟點數說明', () => openModal('<span class="modal-icon">🌱</span><h2>點數使用說明</h2><p>消費門市或電商之綠點標示之商品，即獲得金額8%的綠點回饋，而其他商品累積之通用點數可以1:4的方式單向轉換為綠點使用，每2點綠點相當於1元NTD可直接於商品購物使用，也可用於不定期推出之特殊品項兌換。</p><div class="modal-actions"><button class="primary" data-close>我知道了</button></div>'));
on(modal, 'click', '關閉視窗', event => { if (event.target === modal) { const box = modal.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) modal.close(); } });
// 金額以整數的「分」加總，避免小數誤差與大額數值失真。
let donationRows = null;
let donationError = '';
let donationsLoading = false;
function donationMoney(cents) {
  const whole = cents / 100n;
  const fraction = cents % 100n;
  return whole.toLocaleString('zh-TW') + (fraction ? '.' + String(fraction).padStart(2, '0') : '');
}
function donationGroups(rows) {
  const groups = new Map(charityOptions.map(charity => [charity, 0n]));
  for (const row of rows) {
    if (!object(row) || !groups.has(row.charity) || typeof row.amountCents !== 'string' || !/^\d+$/.test(row.amountCents)) throw new Error('捐贈金額資料異常，請稍後重新讀取。');
    groups.set(row.charity, groups.get(row.charity) + BigInt(row.amountCents));
  }
  return groups;
}
function renderDonations() {
  required('#refresh-donations').disabled = donationsLoading;
  if (donationRows === null) {
    required('#donation-total').textContent = '—';
    required('#donation-breakdown').innerHTML = '';
    required('#donation-status').textContent = donationError || '正在讀取捐贈紀錄…';
    return;
  }
  const groups = donationGroups(donationRows);
  const total = Array.from(groups.values()).reduce((sum, amount) => sum + amount, 0n);
  required('#donation-total').textContent = donationMoney(total);
  required('#donation-breakdown').innerHTML = Array.from(groups, ([charity, cents]) => '<div class="donation-row"><span>' + safeText(charity) + '</span><strong>' + donationMoney(cents) + ' 元</strong></div>').join('');
  required('#donation-status').textContent = donationsLoading ? '正在更新捐贈紀錄…' : total === 0n ? '目前尚無已完成的捐贈紀錄。' : '已同步雲端捐贈紀錄。';
}
async function loadDonations() {
  if (!currentSession || donationsLoading) return;
  const generation = authGeneration;
  donationsLoading = true;
  donationError = '';
  renderDonations();
  try {
    const rows = await requestProfile('GET', undefined, 'donations');
    if (generation !== authGeneration) return;
    donationGroups(rows);
    donationRows = rows;
  } catch {
    if (generation !== authGeneration) return;
    donationRows = null;
    donationError = '暫時無法讀取捐贈紀錄，請確認網路後按「重新讀取」。';
    log('捐贈紀錄讀取未完成');
  } finally {
    if (generation === authGeneration) { donationsLoading = false; renderDonations(); }
  }
}
on(required('#refresh-donations'), 'click', '重新讀取捐贈紀錄', loadDonations);

// 關於泉漣的三個子欄位共用切換邏輯。
function showAbout(section) {
  if (!['goals', 'actions', 'reports'].includes(section)) return;
  showPage('about');
  document.querySelectorAll('.about-tabs button').forEach(button => {
    const selected = button.dataset.about === section;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll('.about-panel').forEach(panel => panel.hidden = panel.id !== 'about-' + section);
}
on(required('.about-tabs'), 'keydown', '切換關於泉漣子欄位', event => {
  const tabs = Array.from(document.querySelectorAll('.about-tabs button'));
  const current = tabs.indexOf(event.target);
  if (current < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  let next = event.key === 'ArrowRight' ? (current + 1) % tabs.length : (current + tabs.length - 1) % tabs.length;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = tabs.length - 1;
  showAbout(tabs[next].dataset.about);
  tabs[next].focus();
});
let walletFilter = 'all';
// 直接使用成功扣點時寫入的紀錄，舊版已兌換商品也會自動出現。
function ownedRewards() {
  return state.history.filter(record => record.amount < 0 && record.code).map(record => {
    const product = rewards.find(reward => reward.id === record.rewardId || reward.title === record.title);
    const type = record.rewardType || product?.type || 'goods';
    return { ...record, type };
  });
}
function renderWallet() {
  const owned = ownedRewards();
  required('#wallet-coupon-count').textContent = owned.filter(item => item.type === 'discount').length;
  required('#wallet-goods-count').textContent = owned.filter(item => item.type === 'goods').length;
  document.querySelectorAll('[data-wallet]').forEach(button => {
    const selected = button.dataset.wallet === walletFilter;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
  const items = owned.filter(item => walletFilter === 'all' || item.type === walletFilter);
  required('#wallet-list').innerHTML = items.length ? items.map(item => '<article class="owned-card"><span class="owned-type">' + (item.type === 'discount' ? '優惠券' : '兌換物') + '</span><h2>' + safeText(item.title) + '</h2><p>兌換時間 ' + safeText(item.date) + '</p><div class="owned-code">兌換碼 <strong>' + safeText(item.code) + '</strong></div><button data-owned="' + safeText(item.code) + '">查看兌換內容 ↗</button></article>').join('') : '<div class="wallet-empty"><h2>' + (owned.length ? '這個分類尚無兌換商品' : '目前還沒有兌換商品') + '</h2><p>到適用商品範疇選擇商品，完成兌換後就會出現在這裡。</p><button data-goto="rewards">前往適用商品範疇 ↗</button></div>';
}
function showOwnedReward(code) {
  const item = ownedRewards().find(record => record.code === code);
  if (!item) throw new Error('找不到這項兌換商品，請重新整理後再試。');
  openModal('<span class="modal-icon">🎁</span><h2>' + safeText(item.title) + '</h2><p>類別 ' + (item.type === 'discount' ? '優惠券' : '兌換物') + '<br>兌換時間 ' + safeText(item.date) + '<br>已使用 ' + Math.abs(item.amount).toLocaleString() + ' 點</p><div class="owned-code">兌換碼 <strong>' + safeText(item.code) + '</strong></div><p>體驗兌換碼不具實際效力。</p><div class="modal-actions"><button data-close>關閉</button></div>');
}

// 新聞由雲端抽選並固定五天，裝置快取沿用相同的到期時間。
const newsCacheKey = '泉漣永續新聞';
const newsDuration = 5 * 24 * 60 * 60 * 1000;
let spotlightNews = null;
let spotlightLoading = false;
let newsRefreshTimer;
function validSpotlight(news) {
  return object(news) && typeof news.title === 'string' && news.title.trim().length > 0 && news.title.length <= 300 && typeof news.url === 'string' && /^https:\/\/esg\.gvm\.com\.tw\/article\/\d+$/.test(news.url) && Number.isFinite(Date.parse(news.picked_at)) && Date.parse(news.expires_at) - Date.parse(news.picked_at) === newsDuration;
}
function renderSpotlight() {
  const link = required('#news-spotlight');
  const status = required('#news-status');
  if (!spotlightNews) { link.hidden = true; return; }
  required('#news-headline').textContent = spotlightNews.title;
  required('#news-source').textContent = spotlightNews.stale ? '來源：ESG遠見・更新延遲，顯示上次新聞 ↗' : '來源：ESG遠見・全球趨勢 ↗';
  link.href = spotlightNews.url;
  link.setAttribute('aria-label', '閱讀新聞：' + spotlightNews.title + '（另開分頁）');
  link.hidden = false;
  status.textContent = '';
}
function scheduleNewsRefresh() {
  clearTimeout(newsRefreshTimer);
  const delay = spotlightNews && !spotlightNews.stale ? Math.max(1000, Date.parse(spotlightNews.expires_at) - Date.now()) : 5 * 60 * 1000;
  newsRefreshTimer = setTimeout(() => guard('新聞自動更新', loadSpotlight), delay);
}
async function loadSpotlight() {
  if (spotlightLoading) return;
  if (!spotlightNews) {
    try {
      const cached = JSON.parse(localStorage.getItem(newsCacheKey));
      if (validSpotlight(cached)) spotlightNews = cached;
    } catch { log('新聞快取無法讀取，改從雲端取得'); }
  }
  if (spotlightNews && !spotlightNews.stale && Date.parse(spotlightNews.expires_at) > Date.now()) {
    renderSpotlight(); scheduleNewsRefresh(); return;
  }
  spotlightLoading = true;
  if (spotlightNews) { spotlightNews.stale = true; renderSpotlight(); }
  else required('#news-status').textContent = '正在讀取永續新聞…';
  try {
    spotlightNews = await requestProfile('GET', undefined, 'news');
    renderSpotlight();
    try { localStorage.setItem(newsCacheKey, JSON.stringify(spotlightNews)); }
    catch { log('新聞已載入，裝置暫時無法保存新聞快取'); }
  } catch {
    if (spotlightNews) renderSpotlight();
    else required('#news-status').textContent = '新聞暫時無法讀取，稍後會再試。';
    log('永續新聞暫時無法更新');
  } finally {
    spotlightLoading = false;
    scheduleNewsRefresh();
  }
}
on(document, 'visibilitychange', '檢查新聞更新時間', () => {
  if (currentSession && !document.hidden && (!spotlightNews || spotlightNews.stale || Date.parse(spotlightNews.expires_at) <= Date.now())) return loadSpotlight();
});

function updateMemberName() {
  const name = state.profile?.fullName || '會員';
  required('#profile-display-name').textContent = name;
  required('#profile-avatar').textContent = Array.from(name)[0];
}
function lockApp(message = '') {
  authGeneration++;
  currentSession = null;
  storageKey = null;
  state = clone(initialState);
  donationRows = null;
  donationError = '';
  donationsLoading = false;
  clearTimeout(loginTimer);
  clearTimeout(newsRefreshTimer);
  modal.close();
  birthdayDialog.close();
  required('#member-app').hidden = true;
  required('#login-screen').hidden = false;
  required('#login-password').value = '';
  required('#profile-password').value = '';
  required('#login-error').textContent = message;
}
async function enterAccount(data, importLegacy = false) {
  if (!object(data) || typeof data.accessToken !== 'string' || !/^[0-9a-f-]{36}$/.test(data.userId) || !object(data.profile) || typeof data.profile.fullName !== 'string') throw new Error('登入回應不完整，請重新登入。');
  authGeneration++;
  currentSession = { accessToken: data.accessToken, userId: data.userId, username: data.profile.username };
  storageKey = '泉漣會員點數：' + data.userId;
  readState(importLegacy);
  const cached = cacheProfile(data.profile);
  if (importLegacy && cached) {
    try { localStorage.setItem('泉漣舊資料所屬帳號', data.userId); }
    catch { log('裝置暫時無法記錄舊資料連結狀態'); }
  }
  donationRows = null;
  donationError = '';
  donationsLoading = false;
  walletFilter = 'all';
  currentFilter = 'all';
  required('#login-password').value = '';
  required('#member-app').hidden = false;
  required('#login-screen').hidden = true;
  required('#app-error').hidden = true;
  render();
  updateMemberName();
  showPage('home');
  clearTimeout(loginTimer);
  const remaining = Number(data.expiresAt) * 1000 - Date.now();
  loginTimer = setTimeout(() => lockApp('登入已到期，請重新登入。'), Number.isFinite(remaining) && remaining > 0 ? remaining : 3600000);
  guard('讀取捐贈紀錄', loadDonations);
  guard('讀取永續新聞', loadSpotlight);
  if (startupMessage) showError(startupMessage);
}
on(required('#login-form'), 'submit', '會員登入', async event => {
  event.preventDefault();
  if (authBusy) return;
  const username = required('#login-username').value;
  const password = required('#login-password').value;
  if (!validCredential(username) || !validCredential(password)) { required('#login-error').textContent = '帳號與密碼須為六至十二碼英文字母、數字或特殊符號，不含空白。'; return; }
  authBusy = true;
  required('#login-submit').disabled = true;
  required('#open-register').disabled = true;
  required('#login-submit').textContent = '登入中…';
  required('#login-error').textContent = '';
  try {
    const generation = authGeneration;
    const data = await cloudRequest('?action=login', 'POST', { username, password }, null);
    if (generation !== authGeneration) return;
    await enterAccount(data);
  } finally {
    authBusy = false;
    required('#login-submit').disabled = false;
    required('#open-register').disabled = false;
    required('#login-submit').textContent = '登入';
    required('#login-password').value = '';
  }
});
on(required('#open-register'), 'click', '建立會員帳號', () => {
  if (authBusy || profileBusy) return;
  registering = true;
  prepareProfileForm();
  fillProfile(null);
  const canImport = !localStorage.getItem('泉漣舊資料所屬帳號') && Boolean(localStorage.getItem('泉漣綠色點數'));
  required('#legacy-import').disabled = !canImport;
  required('#legacy-import').checked = canImport;
  birthdayDialog.showModal();
  required('#profile-name').focus();
});
on(required('#logout'), 'click', '會員登出', async () => {
  const session = currentSession;
  lockApp();
  required('#login-username').value = '';
  if (session) {
    try { await cloudRequest('?action=logout', 'POST', {}, session); }
    catch { log('已離開本次登入，雲端登出通知暫時未完成'); }
  }
});
window.addEventListener('pageshow', event => { if (event.persisted) lockApp(); });
lockApp();
