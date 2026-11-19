// Phone-only backend: everything is stored on this device (localStorage). No Google Sheet, no server.
// Same window.api interface as demo/api.js, plus exportData / importData for backup files.
(function () {
  const KEY = "finance-v1";
  const FORMAT = "finance-backup-v1";

  const DEFAULT_CATEGORIES = {
    income: ["เงินเดือน", "รายได้เสริม", "ทุนการศึกษา"],
    expense: ["ค่าการศึกษา", "ค่าเดินทาง", "ค่าน้ำ-ไฟ", "ค่าของขวัญตัวเอง", "ค่าบำรุงร่างกาย",
      "ค่าเน็ต-เน็ตมือถือ-YT", "ค่าอาหาร", "ภาษีสังคม"],
    invest: ["เงินสด", "Bond", "ETF", "ทอง", "BTC"],
  };

  function defaults() {
    return {
      transactions: [], categories: structuredClone(DEFAULT_CATEGORIES), budgets: {},
      portfolio: [], portfolioHistory: [], recurring: [], recurringDone: {}, archives: {},
      settings: { savingTarget: 20 }, lastBackup: null, nextId: 1,
    };
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? { ...defaults(), ...JSON.parse(raw) } : defaults();
    } catch (e) { return defaults(); }
  }

  let db = load();
  const save = () => localStorage.setItem(KEY, JSON.stringify(db));
  const out = (v) => Promise.resolve(structuredClone(v));
  const today = () => new Date().toISOString().slice(0, 10);
  const sortTx = () => db.transactions.sort((a, b) => b.date.localeCompare(a.date));
  const newId = () => "t" + Date.now().toString(36) + (db.nextId++).toString(36);

  // Ask iOS/Chrome not to clear this app's storage when the phone is low on space.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  window.api = {
    local: true,

    listTransactions: () => out(db.transactions),
    addTransaction(t) {
      const item = { ...t, id: newId() }; delete item.pending;
      db.transactions.unshift(item); sortTx(); save();
      return out(item);
    },
    updateTransaction(t) {
      db.transactions = db.transactions.map((x) => (x.id === t.id ? t : x)); sortTx(); save();
      return out(t);
    },
    deleteTransaction(id) { db.transactions = db.transactions.filter((x) => x.id !== id); save(); return out(true); },
    syncPending: () => out(0),

    getCategories: () => out(db.categories),
    saveCategories(c) { db.categories = c; save(); return out(c); },
    getBudgets: () => out(db.budgets),
    saveBudget(ym, values) { db.budgets[ym] = values; save(); return out(true); },
    getSettings: () => out(db.settings),
    saveSettings(s) { db.settings = s; save(); return out(s); },

    getPortfolio: () => out(db.portfolio),
    getPortfolioHistory: () => out(db.portfolioHistory),
    savePortfolio(list) {
      db.portfolio = list;
      const snap = { date: today(), cost: list.reduce((a, x) => a + x.cost, 0), value: list.reduce((a, x) => a + x.value, 0) };
      db.portfolioHistory = db.portfolioHistory.filter((h) => h.date !== snap.date).concat(snap)
        .sort((a, b) => a.date.localeCompare(b.date));
      save();
      return out({ portfolio: db.portfolio, history: db.portfolioHistory });
    },

    getRecurring: () => out({ items: db.recurring, done: db.recurringDone }),
    saveRecurring(items) { db.recurring = items; save(); return out(items); },
    markRecurring(ym, id) { (db.recurringDone[ym] ||= []).push(id); save(); return out(db.recurringDone); },

    listArchives: () => out(Object.fromEntries(Object.entries(db.archives).map(([y, l]) => [y, l.length]))),
    archiveYear(y) {
      const moved = db.transactions.filter((t) => t.date.startsWith(y));
      db.archives[y] = (db.archives[y] || []).concat(moved);
      db.transactions = db.transactions.filter((t) => !t.date.startsWith(y));
      save();
      return out(moved.length);
    },
    restoreYear(y) {
      const back = db.archives[y] || [];
      db.transactions = db.transactions.concat(back); sortTx();
      delete db.archives[y]; save();
      return out(back.length);
    },

    getBackupInfo: () => out({ lastBackup: db.lastBackup }),

    // ---- backup file ----
    exportData: () => out({ format: FORMAT, exportedAt: new Date().toISOString(), data: db }),
    // Called only after the file was actually shared/saved, so a cancelled share doesn't count.
    markBackedUp() { db.lastBackup = new Date().toISOString(); save(); return out({ lastBackup: db.lastBackup }); },
    importData(file) {
      if (!file || file.format !== FORMAT || !file.data || !Array.isArray(file.data.transactions)) {
        return Promise.reject(new Error("ไฟล์นี้ไม่ใช่ไฟล์สำรองของแอปนี้"));
      }
      db = { ...defaults(), ...file.data }; sortTx(); save();
      return out({ count: db.transactions.length });
    },
    isEmpty: () => db.transactions.length === 0 && db.portfolio.length === 0,
  };
})();
