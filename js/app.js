let pinBuffer = '';
let currentPin = '';
let salesChart = null;

// --- 初期化 ---
document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    await checkPinStatus();
    setupEventListeners();
    updateAnalysisMonths();
    renderRecentSales();
    setDefaultDate();
});

function setDefaultDate() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('sale-date').value = today;
    document.getElementById('monthly-ym').value = today.slice(0, 7);
}

// --- PIN認証 ---
async function checkPinStatus() {
    currentPin = await getSettings('app_pin', '');
    if (!currentPin) {
        document.getElementById('pin-note').textContent = '初回設定: 4桁のPINを入力してください';
    }
}

function pinKey(k) {
    if (pinBuffer.length < 4) {
        pinBuffer += k;
        updatePinDots();
        if (pinBuffer.length === 4) verifyPin();
    }
}

function pinDel() {
    pinBuffer = pinBuffer.slice(0, -1);
    updatePinDots();
}

function updatePinDots() {
    const dots = document.querySelectorAll('#pin-dots .dot');
    dots.forEach((dot, i) => dot.classList.toggle('active', i < pinBuffer.length));
}

async function verifyPin() {
    if (!currentPin) {
        currentPin = pinBuffer;
        await saveSettings('app_pin', currentPin);
        unlockApp();
    } else if (pinBuffer === currentPin) {
        unlockApp();
    } else {
        document.getElementById('pin-err').textContent = 'PINが正しくありません';
        pinBuffer = '';
        updatePinDots();
        setTimeout(() => { document.getElementById('pin-err').textContent = ''; }, 2000);
    }
}

function unlockApp() {
    document.getElementById('pin-screen').style.display = 'none';
    document.getElementById('main-app').style.display = 'block';
}

// --- タブ切り替え ---
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.bottom-nav button').forEach(b => b.classList.remove('active'));
    
    document.getElementById(`sec-${tabId}`).classList.add('active');
    document.getElementById(`nav-${tabId}`).classList.add('active');
    
    const titles = { input: '売上入力', analysis: '経営分析', multi: '2店舗比較', settings: '設定' };
    document.getElementById('header-title').textContent = titles[tabId];

    if (tabId === 'analysis') renderAnalysis();
    if (tabId === 'multi') renderMultiStore();
    if (tabId === 'input') renderRecentSales();
}

// --- 日次売上入力 ---
async function renderRecentSales() {
    const sales = await getAllData('dailySales');
    const list = document.getElementById('recent-sales-list');
    list.innerHTML = '';
    
    const sorted = sales.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
    sorted.forEach(s => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${s.date}</td>
            <td>¥${s.total.toLocaleString()}</td>
            <td>${s.guests}名</td>
            <td><button onclick="editSale('${s.date}')">編集</button></td>
        `;
        list.appendChild(tr);
    });
}

async function editSale(date) {
    const sale = await getData('dailySales', date);
    if (sale) {
        document.getElementById('sale-date').value = sale.date;
        document.getElementById('sale-cash').value = sale.cash;
        document.getElementById('sale-credit').value = sale.credit;
        document.getElementById('sale-guests').value = sale.guests;
        document.getElementById('sale-memo').value = sale.memo || '';
        switchTab('input');
    }
}

// --- 分析機能 ---
async function renderAnalysis() {
    const month = document.getElementById('analysis-month').value || new Date().toISOString().slice(0, 7);
    const allSales = await getAllData('dailySales');
    const monthlySales = allSales.filter(s => s.date.startsWith(month)).sort((a,b) => a.date.localeCompare(b.date));
    
    const total = monthlySales.reduce((sum, s) => sum + s.total, 0);
    const guests = monthlySales.reduce((sum, s) => sum + (s.guests || 0), 0);
    const avg = monthlySales.length ? Math.round(total / monthlySales.length) : 0;
    
    document.getElementById('sales-metrics').innerHTML = `
        <div class="metric-card"><span>月間売上</span><strong>¥${total.toLocaleString()}</strong></div>
        <div class="metric-card"><span>月間客数</span><strong>${guests}名</strong></div>
        <div class="metric-card"><span>1日平均</span><strong>¥${avg.toLocaleString()}</strong></div>
        <div class="metric-card"><span>客単価</span><strong>¥${guests ? Math.round(total/guests).toLocaleString() : 0}</strong></div>
    `;

    updateChart(monthlySales);
    renderWeekdayAnalysis(monthlySales);
}

function updateChart(data) {
    const ctx = document.getElementById('sales-chart').getContext('2d');
    if (salesChart) salesChart.destroy();
    
    salesChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.map(d => d.date.split('-')[2]),
            datasets: [{
                label: '売上',
                data: data.map(d => d.total),
                borderColor: '#a29bfe',
                tension: 0.3,
                fill: true,
                backgroundColor: 'rgba(162, 155, 254, 0.1)'
            }]
        },
        options: { responsive: true, maintainAspectRatio: false }
    });
}

function renderWeekdayAnalysis(data) {
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    const stats = Array.from({length: 7}, () => ({ total: 0, guests: 0, count: 0 }));
    
    data.forEach(d => {
        const day = new Date(d.date).getDay();
        stats[day].total += d.total;
        stats[day].guests += d.guests;
        stats[day].count++;
    });

    const list = document.getElementById('weekday-analysis-list');
    list.innerHTML = '';
    weekdays.forEach((name, i) => {
        const s = stats[i];
        if (s.count === 0) return;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${name}</td>
            <td>¥${Math.round(s.total/s.count).toLocaleString()}</td>
            <td>${(s.guests/s.count).toFixed(1)}名</td>
        `;
        list.appendChild(tr);
    });
}

// --- 複数店舗比較 ---
async function renderMultiStore() {
    const container = document.getElementById('multi-store-table-container');
    const nameA = await getSettings('store_name_a', '店舗A');
    const nameB = await getSettings('store_name_b', '店舗B');
    document.getElementById('name-a').value = nameA;
    document.getElementById('name-b').value = nameB;
    
    const monthlyData = await getAllData('monthlyStoreSales');
    let html = `<table><thead><tr><th>年月</th><th>${nameA}</th><th>${nameB}</th><th>合計</th></tr></thead><tbody>`;
    
    const sortedYM = Array.from(new Set(monthlyData.map(m => m.yearMonth))).sort().reverse().slice(0, 12);
    
    sortedYM.forEach(ym => {
        const record = monthlyData.find(m => m.yearMonth === ym) || { a: 0, b: 0 };
        html += `<tr><td>${ym}</td><td>¥${record.a.toLocaleString()}</td><td>¥${record.b.toLocaleString()}</td><td>¥${(record.a + record.b).toLocaleString()}</td></tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

async function saveStoreNames() {
    await saveSettings('store_name_a', document.getElementById('name-a').value);
    await saveSettings('store_name_b', document.getElementById('name-b').value);
    renderMultiStore();
}

// --- イベントリスナー ---
function setupEventListeners() {
    document.getElementById('daily-sales-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const cash = parseInt(document.getElementById('sale-cash').value) || 0;
        const credit = parseInt(document.getElementById('sale-credit').value) || 0;
        const data = {
            date: document.getElementById('sale-date').value,
            cash: cash,
            credit: credit,
            total: cash + credit,
            guests: parseInt(document.getElementById('sale-guests').value) || 0,
            memo: document.getElementById('sale-memo').value
        };
        await saveData('dailySales', data);
        alert('保存しました');
        renderRecentSales();
        autoBackup();
    });

    document.getElementById('monthly-sales-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const ym = document.getElementById('monthly-ym').value;
        const store = document.getElementById('monthly-store-id').value;
        const amount = parseInt(document.getElementById('monthly-amount').value) || 0;
        
        let record = await getData('monthlyStoreSales', ym) || { yearMonth: ym, a: 0, b: 0 };
        record[store] = amount;
        await saveData('monthlyStoreSales', record);
        alert('ログを保存しました');
        renderMultiStore();
        autoBackup();
    });
}

function updateAnalysisMonths() {
    const sel = document.getElementById('analysis-month');
    sel.innerHTML = '';
    const now = new Date();
    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const ym = d.toISOString().slice(0, 7);
        const opt = document.createElement('option');
        opt.value = ym; opt.textContent = ym;
        sel.appendChild(opt);
    }
}

// --- バックアップ & インポート ---
function autoBackup() {
    const lastTime = new Date().toLocaleString();
    document.getElementById('last-backup-time').textContent = lastTime;
    localStorage.setItem('barber_sales_last_sync', lastTime);
}

async function exportToCSV() {
    const sales = await getAllData('dailySales');
    const multi = await getAllData('monthlyStoreSales');
    let csv = 'Type,Key,Val1,Val2,Val3,Val4\n';
    sales.forEach(s => csv += `Daily,${s.date},${s.cash},${s.credit},${s.total},${s.guests}\n`);
    multi.forEach(m => csv += `Monthly,${m.yearMonth},${m.a},${m.b}\n`);
    
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `barber_sales_backup_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
}

async function importSalesCSV(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        const lines = e.target.result.split('\n');
        let added = 0;
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',');
            if (cols.length < 5 || !cols[0].match(/^\d{4}-\d{2}-\d{2}$/)) continue;
            await saveData('dailySales', {
                date: cols[0], cash: parseInt(cols[2]) || 0, credit: parseInt(cols[3]) || 0,
                total: parseInt(cols[4]) || 0, guests: parseInt(cols[10]) || 0
            });
            added++;
        }
        alert(`${added}件取り込みました`);
        renderRecentSales();
    };
    reader.readAsText(file, 'UTF-8');
}

async function importMultiStoreCSV(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        const lines = e.target.result.split('\n');
        let added = 0;
        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',');
            if (cols.length < 4) continue;
            const ym = `${cols[0]}-${cols[1].padStart(2, '0')}`;
            if (!ym.match(/^\d{4}-\d{2}$/)) continue;
            await saveData('monthlyStoreSales', { yearMonth: ym, a: parseInt(cols[2]) || 0, b: parseInt(cols[3]) || 0 });
            added++;
        }
        alert(`${added}件取り込みました`);
        renderMultiStore();
    };
    reader.readAsText(file, 'UTF-8');
}

async function clearAllData() {
    if (confirm('全データを削除しますか？')) {
        indexedDB.deleteDatabase('BarberSalesManagerDB');
        alert('削除しました。再起動します。');
        location.reload();
    }
}

async function changePIN() {
    const newPin = prompt('新しい4桁のPINを入力してください');
    if (newPin && newPin.length === 4 && !isNaN(newPin)) {
        await saveSettings('app_pin', newPin);
        currentPin = newPin;
        alert('PINを変更しました');
    } else {
        alert('4桁の数字を入力してください');
    }
}
