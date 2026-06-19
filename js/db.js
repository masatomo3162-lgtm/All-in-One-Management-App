let db;

async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('BarberManagerDB', 3);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            // 顧客ストア
            if (!db.objectStoreNames.contains('customers')) {
                db.createObjectStore('customers', { keyPath: 'id', autoIncrement: true });
            }
            
            // 予約ストア
            if (!db.objectStoreNames.contains('reservations')) {
                db.createObjectStore('reservations', { keyPath: 'id', autoIncrement: true });
            }
            
            // 日次売上ストア (詳細分析用)
            if (!db.objectStoreNames.contains('dailySales')) {
                db.createObjectStore('dailySales', { keyPath: 'date' });
            }
            
            // 店舗別月次売上ストア (複数店舗管理用)
            if (!db.objectStoreNames.contains('monthlyStoreSales')) {
                db.createObjectStore('monthlyStoreSales', { keyPath: 'yearMonth' });
            }

            // 設定ストア (PIN, 店舗名など)
            if (!db.objectStoreNames.contains('settings')) {
                db.createObjectStore('settings', { keyPath: 'key' });
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        request.onerror = (event) => reject(event.target.error);
    });
}

// 共通CRUD操作
async function getData(storeName, key) {
    return new Promise((resolve) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.get(key);
        request.onsuccess = () => resolve(request.result);
    });
}

async function getAllData(storeName) {
    return new Promise((resolve) => {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
    });
}

async function saveData(storeName, data) {
    return new Promise((resolve) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.put(data);
        request.onsuccess = () => resolve(request.result);
    });
}

async function deleteData(storeName, key) {
    return new Promise((resolve) => {
        const transaction = db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const request = store.delete(key);
        request.onsuccess = () => resolve(request.result);
    });
}

// 特定のヘルパー関数
async function getSettings(key, defaultValue) {
    const res = await getData('settings', key);
    return res ? res.value : defaultValue;
}

async function saveSettings(key, value) {
    return await saveData('settings', { key, value });
}
