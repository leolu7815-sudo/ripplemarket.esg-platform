// 點數與紀錄只儲存在目前瀏覽器，方便直接開啟網頁體驗。
const initialState = { balance: 150, impact: 12.8, claims: {}, history: [{ title: '歡迎加入泉漣綠生活', amount: 150, date: '新會員體驗點數' }] };
let state;
try {
  // 讀取舊版資料並轉存到新名稱，保留原有點數，不刪除任何資料。
  const previousName = String.fromCharCode(0x9752, 0x65e5);
  const saved = localStorage.getItem('泉漣綠色點數') || localStorage.getItem(previousName + '綠色點數');
  state = saved ? JSON.parse(saved.split(previousName).join('泉漣').split('好物' + '兌換').join('適用商品範疇')) : null;
  if (!state || !Number.isFinite(state.balance) || !Number.isFinite(state.impact) || !Array.isArray(state.history) || !state.claims) state = structuredClone(initialState);
} catch { state = structuredClone(initialState); }
// 舊會員只調整一次迎新贈點，保留任務收入與兌換支出。
const welcomeRecord = state.history.find(record => record.date === '新會員體驗點數');
if (welcomeRecord && welcomeRecord.amount === 1280) {
  state.balance += 150 - welcomeRecord.amount;
  welcomeRecord.amount = 150;
}
const tasks = [
  { id: 'bag', icon: '🛍️', title: '自備購物袋', description: '少一個塑膠袋，多一份對地球的愛。', points: 20 },
  { id: 'local', icon: '🥬', title: '支持在地好食材', description: '選一份在地蔬果，縮短食物的旅程。', points: 30 },
  { id: 'food', icon: '🥕', title: '惜食，也是一種美好', description: '帶回一份惜食商品，讓美味不浪費。', points: 50 }
];
const rewards = [
  { id: 'discount', title: '泉漣購物折抵金', description: '新鮮好食，給你一點小回饋', points: 60, type: 'discount', art: '<div class="coupon-art"><small>泉漣生鮮・購物金</small><strong>30</strong><span> 元</span></div>', tag: '人氣首選' },
  { id: 'bag', title: '把綠帶著走・棉布袋', description: '可重複使用，裝下日常的美好', points: 800, type: 'goods', art: '<span class="product-emoji">🛍️</span>', tag: '永續選物' },
  { id: 'vegetables', title: '在地當季・鮮蔬小箱', description: '來自土地的心意，新鮮剛剛好', points: 1200, type: 'goods', art: '<span class="product-emoji">🥦🥕</span>', tag: '產地直送' }
];
const labels = { home: ['點數總覽', '今天，也為地球加一點綠。', '從自備購物袋開始，讓每一次採買都更有意義。'], tasks: ['永續任務', '讓好習慣，成為日常。', '完成永續小任務，累積屬於你的綠色影響力。'], rewards: ['適用商品範疇', '看看哪些商品，適用綠色點數。', '探索購物折抵與永續選物，選擇適合你的點數回饋。'], history: ['點數紀錄', '每一步，都留下綠色足跡。', '在這裡看看你累積的點數，以及兌換的美好。'] };
const modal = document.querySelector('#modal');
let currentFilter = 'all';
let toastTimer;
// 使用本地日期，讓每日任務在裝置當地午夜重新開放。
function today() { return new Date().toLocaleDateString('zh-TW'); }
function save() {
  try { localStorage.setItem('泉漣綠色點數', JSON.stringify(state)); }
  catch { notify('裝置無法儲存資料，這次操作僅保留於本次使用期間。'); }
}
function notify(message) {
  const toast = document.querySelector('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3500);
}
function showPage(page) {
  if (!labels[page]) return;
  document.querySelectorAll('.page').forEach(section => section.hidden = section.id !== page);
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.page === page));
  document.querySelector('#page-label').textContent = labels[page][0];
  document.querySelector('#heading').textContent = labels[page][1];
  document.querySelector('#subtitle').textContent = labels[page][2];
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function taskHTML(task) {
  const claimed = state.claims[task.id] === today();
  return `<article class="task-card"><div class="task-top"><span class="task-icon">${task.icon}</span><span class="task-points">＋${task.points} 點</span></div><h3>${task.title}</h3><p>${task.description}</p><button class="task-button" data-claim="${task.id}" ${claimed ? 'disabled' : ''}>${claimed ? '✓ 今日已完成' : '完成任務，領取點數 ↗'}</button></article>`;
}
function rewardHTML(reward) {
  return `<article class="reward-card"><div class="product-art ${reward.id}"><span class="product-tag">${reward.tag}</span>${reward.art}</div><div class="reward-content"><h3>${reward.title}</h3><p>${reward.description}</p><div class="reward-bottom"><strong>${reward.points.toLocaleString()}<span>點</span></strong><button class="redeem" data-redeem="${reward.id}">立即兌換 ↗</button></div></div></article>`;
}
// 將儲存內容當成文字顯示，避免被解讀成網頁語法。
function safeText(value) { const element = document.createElement('span'); element.textContent = String(value); return element.innerHTML; }
function render() {
  document.querySelector('#balance').textContent = state.balance.toLocaleString();
  document.querySelector('#impact').textContent = state.impact.toFixed(1);
  for (const id of ['home-tasks', 'all-tasks']) document.getElementById(id).innerHTML = tasks.map(taskHTML).join('');
  document.querySelector('#home-rewards').innerHTML = rewards.map(rewardHTML).join('');
  document.querySelector('#all-rewards').innerHTML = rewards.filter(reward => currentFilter === 'all' || reward.type === currentFilter).map(rewardHTML).join('');
  document.querySelector('#history-list').innerHTML = state.history.map(record => `<div class="history-row"><span class="history-symbol">${record.amount > 0 ? '↗' : '♧'}</span><div><strong>${safeText(record.title)}</strong><p>${safeText(record.date)}</p>${record.code ? `<div class="voucher">體驗兌換碼：${safeText(record.code)}（無實際效力）</div>` : ''}</div><span class="history-amount ${record.amount < 0 ? 'minus' : ''}">${record.amount > 0 ? '＋' : '−'}${Math.abs(record.amount).toLocaleString()} 點</span></div>`).join('');
  document.querySelector('.nav-count').textContent = tasks.filter(task => state.claims[task.id] !== today()).length;
}
function openModal(content) {
  document.querySelector('#modal-content').innerHTML = content;
  modal.showModal();
}
function claim(id) {
  const task = tasks.find(item => item.id === id);
  if (!task || state.claims[id] === today()) return;
  state.balance += task.points;
  state.impact = Math.round((state.impact + 0.2) * 10) / 10;
  state.claims[id] = today();
  state.history.unshift({ title: task.title, amount: task.points, date: new Date().toLocaleString('zh-TW') });
  save(); render(); notify(`任務完成！獲得 ${task.points} 點綠色點數。`);
}
function redeem(id) {
  const reward = rewards.find(item => item.id === id);
  if (!reward) return;
  const enough = state.balance >= reward.points;
  openModal(`<span class="modal-icon">🎁</span><h2>${reward.title}</h2><p>兌換需要 <strong>${reward.points.toLocaleString()} 點</strong>，目前持有 ${state.balance.toLocaleString()} 點。${enough ? `兌換後將剩餘 ${(state.balance - reward.points).toLocaleString()} 點。` : `還差 ${(reward.points - state.balance).toLocaleString()} 點，完成任務即可累積。`}</p><p>此為體驗兌換，產生的兌換碼無實際效力。兌換後可於點數紀錄查看。</p><div class="modal-actions"><button data-close>再想一下</button><button class="primary" data-confirm="${id}" ${enough ? '' : 'disabled'}>確認兌換</button></div>`);
}
document.addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.page) showPage(button.dataset.page);
  if (button.dataset.goto) showPage(button.dataset.goto);
  if (button.dataset.claim) claim(button.dataset.claim);
  if (button.dataset.redeem) redeem(button.dataset.redeem);
  if (button.hasAttribute('data-close') || button.classList.contains('close')) modal.close();
  if (button.dataset.filter) {
    currentFilter = button.dataset.filter;
    document.querySelectorAll('.filter').forEach(item => item.classList.toggle('active', item === button));
    render();
  }
  if (button.dataset.confirm) {
    const reward = rewards.find(item => item.id === button.dataset.confirm);
    if (!reward || state.balance < reward.points) return;
    // 再次檢查餘額後才扣點，並同時記錄兌換碼。
    state.balance -= reward.points;
    const code = '泉漣' + Date.now().toString().slice(-8);
    state.history.unshift({ title: reward.title, amount: -reward.points, date: new Date().toLocaleString('zh-TW'), code });
    save(); render(); modal.close();
    openModal(`<span class="modal-icon">✓</span><h2>美好回饋，兌換成功！</h2><p>${reward.title}<br>體驗兌換碼：<strong>${code}</strong><br>此碼無實際效力，可隨時於點數紀錄查看。</p><div class="modal-actions"><button class="primary" data-close data-goto="history">查看點數紀錄 ↗</button></div>`);
  }
});
document.querySelector('#help').addEventListener('click', () => openModal('<span class="modal-icon">🌱</span><h2>點數使用說明</h2><p>消費門市或電商之綠點標示之商品，即獲得金額8%的綠點回饋，而其他商品累積之通用點數可以1:4的方式單向轉換為綠點使用，每2點綠點相當於1元NTD可直接於商品購物使用，也可用於不定期推出之特殊品項兌換。</p><div class="modal-actions"><button class="primary" data-close>我知道了</button></div>'));
modal.addEventListener('click', event => { if (event.target === modal) { const box = modal.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) modal.close(); } });
save();
render();

