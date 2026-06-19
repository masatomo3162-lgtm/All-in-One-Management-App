let calendar;
let selectedDate = new Date().toISOString().split('T')[0];
let pinBuffer = '';
let currentPin = '';
let salesChart = null;
let pieChart = null;

// --- 初期化 ---
document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    await checkPinStatus();
    initCalendar();
    renderCustomers();
    setupEventListeners();
    updateAnalysisMonths();
});

// --- PIN認証ロジック ---
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
        if (pinBuffer.length === 4) {
            verifyPin();
        }
    }
}

function pinDel() {
    pinBuffer = pinBuffer.slice(0, -1);
    updatePinDots();
}

function updatePinDots() {
    const dots = document.querySelectorAll('#pin-dots .dot');
    dots.forEach((dot, i) => {
        dot.classList.toggle('active', i < pinBuffer.length);
    });
}

async function verifyPin() {
    if (!currentPin) {
        // 初回設定
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
    calendar.render();
}

// --- タブ切り替え ---
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.bottom-nav button').forEach(b => b.classList.remove('active'));
    
    document.getElementById(`sec-${tabId}`).classList.add('active');
    document.getElementById(`nav-${tabId}`).classList.add('active');
    
    const titles = { reservation: '予約管理', customer: '顧客管理', sales: '売上分析', settings: '設定' };
    document.getElementById('header-title').textContent = titles[tabId];

    if (tabId === 'sales') renderSalesAnalysis();
}

function showSubSales(subId) {
    document.querySelectorAll('.sub-sales-content').forEach(c => c.classList.remove('active'));
    document.querySelectorAll('.sub-tab').forEach(b => b.classList.remove('active'));
    
    document.getElementById(subId).classList.add('active');
    event.target.classList.add('active');
    
    if (subId === 'sales-analysis') renderSalesAnalysis();
    if (subId === 'multi-store') renderMultiStore();
}

// --- 予約管理 (既存機能の移植 + 売上連携) ---
function initCalendar() {
    const calendarEl = document.getElementById('calendar-view');
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'ja',
        headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,timeGridWeek' },
        dateClick: (info) => openDayView(info.dateStr),
        events: async (fetchInfo, success) => {
            const res = await getAllData('reservations');
            success(res.map(r => ({
                id: r.id, title: r.menus.join(', '),
                start: `${r.date}T${r.startTime}`,
                end: calculateEndTimeISO(r.date, r.startTime, r.duration),
                backgroundColor: r.color || '#a29bfe', textColor: '#333'
            })));
        }
    });
}

function openDayView(date) {
    selectedDate = date;
    document.getElementById('calendar-view').style.display = 'none';
    document.getElementById('day-view').style.display = 'block';
    document.getElementById('selected-date-display').textContent = date;
    renderTimeline(date);
}

function backToCalendar() {
    document.getElementById('calendar-view').style.display = 'block';
    document.getElementById('day-view').style.display = 'none';
    calendar.refetchEvents();
}

async function renderTimeline(date) {
    const timeline = document.getElementById('reservation-timeline');
    timeline.innerHTML = '';
    
    // スロット作成
    for (let h = 8; h <= 20; h++) {
        const slot = document.createElement('div');
        slot.className = 'timeline-slot';
        slot.style.top = `${(h - 8) * 60}px`;
        slot.textContent = `${h}:00`;
        timeline.appendChild(slot);
    }

    const reservations = await getAllData('reservations');
    const customers = await getAllData('customers');
    const filtered = reservations.filter(r => r.date === date);

    filtered.forEach(r => {
        const customer = customers.find(c => c.id === r.customerId);
        const [h, m] = r.startTime.split(':').map(Number);
        const top = (h - 8) * 60 + m;
        
        const block = document.createElement('div');
        block.className = 'reservation-block';
        block.style.top = `${top}px`;
        block.style.height = `${r.duration}px`;
        block.style.backgroundColor = r.color || '#a29bfe';
        block.innerHTML = `
            <div style="display:flex; justify-content:space-between;">
                <strong>${r.startTime} ${customer ? customer.name : '客'}</strong>
                <button onclick="editReservation(${r.id})" style="font-size:10px;">編集</button>
            </div>
            <div>${r.menus.join('/')} (${r.price}円)</div>
        `;
        timeline.appendChild(block);
    });
}

// --- 売上自動連携 ---
async function syncReservationToSales(date) {
    const reservations = await getAllData('reservations');
    const daily = reservations.filter(r => r.date === date);
    
    let cash = 0;
    let credit = 0;
    let guests = { male: 0, female: 0, child: 0 }; // 簡易化
    
    daily.forEach(r => {
        cash += r.price; // デフォルトは現金
    });

    await saveData('dailySales', {
        date: date,
        cash: cash,
        credit: credit,
        total: cash + credit,
        reservationCount: daily.length
    });
    
    autoBackup();
}

// --- 売上分析 (Chart.js) ---
async function renderSalesAnalysis() {
    const month = document.getElementById('analysis-month').value || new Date().toISOString().slice(0, 7);
    const allSales = await getAllData('dailySales');
    const monthlySales = allSales.filter(s => s.date.startsWith(month));
    
    const total = monthlySales.reduce((sum, s) => sum + s.total, 0);
    const count = monthlySales.reduce((sum, s) => sum + (s.reservationCount || 0), 0);
    
    document.getElementById('sales-metrics').innerHTML = `
        <div class="metric-card"><span>今月の売上</span><strong>¥${total.toLocaleString()}</strong></div>
        <div class="metric-card"><span>来店数</span><strong>${count}名</strong></div>
    `;

    updateCharts(monthlySales);
}

function updateCharts(data) {
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

// --- 複数店舗管理 ---
async function renderMultiStore() {
    const container = document.getElementById('multi-store-table-container');
    const nameA = await getSettings('store_name_a', '店舗A');
    const nameB = await getSettings('store_name_b', '店舗B');
    document.getElementById('name-a').value = nameA;
    document.getElementById('name-b').value = nameB;

    const monthlyData = await getAllData('monthlyStoreSales');
    let html = `<table><thead><tr><th>月</th><th>${nameA}</th><th>${nameB}</th><th>合計</th></tr></thead><tbody>`;
    
    // 直近12ヶ月
    for (let i = 0; i < 12; i++) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const ym = d.toISOString().slice(0, 7);
        const record = monthlyData.find(m => m.yearMonth === ym) || { a: 0, b: 0 };
        html += `<tr><td>${ym}</td><td>${record.a.toLocaleString()}</td><td>${record.b.toLocaleString()}</td><td>${(record.a + record.b).toLocaleString()}</td></tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}

async function saveStoreNames() {
    await saveSettings('store_name_a', document.getElementById('name-a').value);
    await saveSettings('store_name_b', document.getElementById('name-b').value);
}

// --- 顧客管理 ---
async function renderCustomers(filter = '') {
    const customers = await getAllData('customers');
    const reservations = await getAllData('reservations');
    const list = document.getElementById('customer-list');
    const select = document.getElementById('res-customer-id');
    
    list.innerHTML = '';
    select.innerHTML = '<option value="">選択してください</option>';
    
    const filtered = customers.filter(c => c.name.includes(filter) || (c.phone && c.phone.includes(filter)));

    filtered.forEach(c => {
        const cRes = reservations.filter(r => r.customerId === c.id).sort((a,b) => b.date.localeCompare(a.date));
        const lastVisit = cRes.length > 0 ? cRes[0].date : 'なし';
        
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><a href="#" onclick="showCustomerDetail(${c.id}); return false;">${c.name}</a></td>
            <td>${c.phone || ''}</td>
            <td>${lastVisit}</td>
            <td><button onclick="editCustomer(${c.id})">編集</button></td>
        `;
        list.appendChild(tr);
        
        const opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.name;
        select.appendChild(opt);
    });
}

// --- ユーティリティ ---
function calculateEndTimeISO(date, start, duration) {
    const [h, m] = start.split(':').map(Number);
    const d = new Date(date);
    d.setHours(h, m + duration);
    return d.toISOString();
}

function closeModal(id) { document.getElementById(id).style.display = 'none'; }

function updateAnalysisMonths() {
    const sel = document.getElementById('analysis-month');
    const now = new Date();
    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const ym = d.toISOString().slice(0, 7);
        const opt = document.createElement('option');
        opt.value = ym; opt.textContent = ym;
        sel.appendChild(opt);
    }
}

// --- 自動バックアップ ---
function autoBackup() {
    const lastTime = new Date().toLocaleString();
    document.getElementById('last-backup-time').textContent = lastTime;
    // IndexedDBは自動で永続化されるが、LocalStorageにフラグを立てる
    localStorage.setItem('barber_last_sync', lastTime);
}

async function exportToCSV() {
    const res = await getAllData('reservations');
    const cust = await getAllData('customers');
    const sales = await getAllData('dailySales');
    const multi = await getAllData('monthlyStoreSales');
    
    let csv = 'Type,Key,Val1,Val2,Val3,Val4,Val5\n';
    cust.forEach(c => csv += `Customer,${c.id},${c.name},${c.phone},${c.note.replace(/\n/g, ' ')}\n`);
    res.forEach(r => csv += `Reservation,${r.id},${r.date},${r.startTime},${r.duration},${r.menus.join('|')},${r.price}\n`);
    sales.forEach(s => csv += `DailySales,${s.date},${s.cash},${s.credit},${s.total},${s.reservationCount}\n`);
    multi.forEach(m => csv += `MultiStore,${m.yearMonth},${m.a},${m.b}\n`);
    
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `barber_all_backup_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
}

// 売上分析CSV (barber-sales-v4) の取り込み
async function importSalesCSV(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const lines = e.target.result.split('\n');
            let added = 0;
            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split(',');
                if (cols.length < 5 || !cols[0].match(/^\d{4}-\d{2}-\d{2}$/)) continue;
                const data = {
                    date: cols[0],
                    cash: parseInt(cols[2]) || 0,
                    credit: parseInt(cols[3]) || 0,
                    total: parseInt(cols[4]) || 0,
                    reservationCount: parseInt(cols[10]) || 0
                };
                await saveData('dailySales', data);
                added++;
            }
            alert(`売上分析データを ${added} 件取り込みました。`);
            if (added > 0) renderSalesAnalysis();
        } catch (err) {
            alert('読み込みに失敗しました: ' + err.message);
        }
    };
    reader.readAsText(file, 'UTF-8');
}

// 2店舗管理CSV (store-sales-pwa) の取り込み
async function importMultiStoreCSV(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const lines = e.target.result.split('\n');
            let added = 0;
            for (let i = 1; i < lines.length; i++) {
                const cols = lines[i].split(',');
                if (cols.length < 4) continue;
                const year = cols[0];
                const month = cols[1].padStart(2, '0');
                const ym = `${year}-${month}`;
                if (!ym.match(/^\d{4}-\d{2}$/)) continue;
                const data = {
                    yearMonth: ym,
                    a: parseInt(cols[2]) || 0,
                    b: parseInt(cols[3]) || 0
                };
                await saveData('monthlyStoreSales', data);
                added++;
            }
            alert(`2店舗管理データを ${added} 件取り込みました。`);
            if (added > 0) renderMultiStore();
        } catch (err) {
            alert('読み込みに失敗しました: ' + err.message);
        }
    };
    reader.readAsText(file, 'UTF-8');
}

async function clearAllData() {
    if (confirm('すべてのデータを削除しますか？この操作は取り消せません。')) {
        const stores = ['customers', 'reservations', 'dailySales', 'monthlyStoreSales', 'settings'];
        for (const s of stores) {
            const transaction = db.transaction([s], 'readwrite');
            transaction.objectStore(s).clear();
        }
        alert('すべてのデータを削除しました。アプリを再起動します。');
        location.reload();
    }
}

// --- イベントリスナー設定 ---
function setupEventListeners() {
    document.getElementById('reservation-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('res-id').value;
        const checkboxes = document.querySelectorAll('input[name="menu"]:checked');
        const menus = Array.from(checkboxes).map(cb => cb.parentNode.textContent.trim());
        const duration = Array.from(checkboxes).reduce((sum, cb) => sum + parseInt(cb.dataset.time), 0);
        
        const data = {
            customerId: parseInt(document.getElementById('res-customer-id').value),
            date: selectedDate,
            startTime: document.getElementById('res-start-time').value,
            duration: duration,
            menus: menus,
            price: parseInt(document.getElementById('res-price').value) || 0,
            color: getRandomPastelColor()
        };

        if (id) { data.id = parseInt(id); await saveData('reservations', data); }
        else { await saveData('reservations', data); }
        
        await syncReservationToSales(selectedDate);
        closeModal('reservation-modal');
        renderTimeline(selectedDate);
        calendar.refetchEvents();
    });

    document.getElementById('customer-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('cust-id').value;
        const data = {
            name: document.getElementById('cust-name').value,
            phone: document.getElementById('cust-phone').value,
            note: document.getElementById('cust-note').value
        };
        if (id) data.id = parseInt(id);
        await saveData('customers', data);
        closeModal('customer-modal');
        renderCustomers();
    });
}

function getRandomPastelColor() {
    return `hsl(${Math.floor(Math.random() * 360)}, 70%, 90%)`;
}

function openReservationModal() {
    document.getElementById('res-modal-title').textContent = '新規予約登録';
    document.getElementById('res-id').value = '';
    document.getElementById('reservation-form').reset();
    document.getElementById('reservation-modal').style.display = 'block';
}

function openCustomerModal() {
    document.getElementById('cust-modal-title').textContent = '新規顧客登録';
    document.getElementById('cust-id').value = '';
    document.getElementById('customer-form').reset();
    document.getElementById('customer-modal').style.display = 'block';
}
