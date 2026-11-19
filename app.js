/* Personal finance app – UI layer. Talks only to window.api (mock now, Apps Script later). */
(function () {
  const TH_M = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const TH_M_FULL = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม",
    "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  const TYPE_LABEL = { income: "รายรับ", expense: "รายจ่าย", invest: "ออม/ลงทุน" };
  const TYPE_ICON = { income: "↓", expense: "↑", invest: "◆" };
  // Category colours = the slice colours of the pie charts in the sheet's "Overall" tab, so the app and the sheet match.
  // Categories without a colour in the sheet (savings/investment, or ones added later) get a pastel from the same family.
  const SHEET_COLORS = {
    "เงินเดือน": "#d9ead3", "รายได้เสริม": "#f4cccc", "ทุนการศึกษา": "#fce5cd",
    "ค่าการศึกษา": "#f4cccc", "ค่าเดินทาง": "#fce5cd", "ค่าน้ำ-ไฟ": "#d0e0e3", "ค่าของขวัญตัวเอง": "#fce5cd",
    "ค่าบำรุงร่างกาย": "#46bdc6", "ค่าเน็ต-เน็ตมือถือ-YT": "#fff2cc", "ค่าอาหาร": "#cfe2f3", "ภาษีสังคม": "#fcd04f",
  };
  const PALETTE = ["#cfe2f3", "#d9d2e9", "#ead1dc", "#fff2cc", "#fce5cd", "#d9ead3", "#f4cccc", "#d0e0e3", "#b4a7d6", "#f9cb9c"];
  const catColor = (c) => { if (SHEET_COLORS[c]) return SHEET_COLORS[c];
    const i = Math.max(0, [S.cats.expense, S.cats.income, S.cats.invest].map((l) => l.indexOf(c)).find((i) => i >= 0) ?? 0); return PALETTE[i % PALETTE.length]; };
  // Default category for a new entry = the one used most often in that type.
  const defaultCat = (type) => { const n = {}; S.tx.forEach((t) => { if (t.type === type) n[t.category] = (n[t.category] || 0) + 1; });
    return S.cats[type].slice().sort((a, b) => (n[b] || 0) - (n[a] || 0))[0]; };

  const S = { tx: [], cats: null, budgets: {}, portfolio: [], settings: {}, ym: "2026-11", view: "home",
    recurring: [], recDone: {}, history: [], archives: {}, backup: {}, online: navigator.onLine,
    listFilter: "all", search: "", budgetPeriod: "month", planYm: null, year: 2026 };

  const $ = (sel, el = document) => el.querySelector(sel);
  const view = $("#view");
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n, dec = 0) => Number(n || 0).toLocaleString("th-TH", { minimumFractionDigits: dec, maximumFractionDigits: 2 });
  const ymLabel = (ym) => { const [y, m] = ym.split("-"); return `${TH_M_FULL[+m - 1]} ${y}`; };
  const dLabel = (d) => { const [y, m, dd] = d.split("-"); return `${+dd} ${TH_M[+m - 1]} ${y}`; };
  const today = () => new Date().toISOString().slice(0, 10);
  const shiftYm = (ym, k) => { let [y, m] = ym.split("-").map(Number); m += k; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return `${y}-${String(m).padStart(2, "0")}`; };
  const typeOf = (cat) => (S.cats.income.includes(cat) ? "income" : S.cats.invest.includes(cat) ? "invest" : "expense");

  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.add("hidden"), 1800); }

  // ---------- aggregates ----------
  function sums(list) {
    const r = { income: 0, expense: 0, invest: 0, byCat: {} };
    for (const t of list) {
      const v = t.type === "invest" && t.side === "sell" ? -t.amount : t.amount;
      r[t.type] += v;
      r.byCat[t.category] = (r.byCat[t.category] || 0) + v;
    }
    return r;
  }
  const inMonth = (ym) => S.tx.filter((t) => t.date.startsWith(ym));
  const inYear = (y) => S.tx.filter((t) => t.date.startsWith(String(y)));
  function budgetFor(period) {
    if (period.length === 7) return S.budgets[period] || {};
    const total = {};
    for (let m = 1; m <= 12; m++) {
      const b = S.budgets[`${period}-${String(m).padStart(2, "0")}`] || {};
      for (const k in b) total[k] = (total[k] || 0) + Number(b[k] || 0);
    }
    return total;
  }

  // ---------- shared widgets ----------
  const monthPicker = (ym) => `<div class="month-picker"><button data-ym="-1">‹</button><b>${ymLabel(ym)}</b><button data-ym="1">›</button></div>`;
  function bindMonthPicker(key) {
    view.querySelectorAll("[data-ym]").forEach((b) => b.onclick = () => { S[key] = shiftYm(S[key], +b.dataset.ym); render(); });
  }
  function txRow(t) {
    const sign = t.type === "income" ? "+" : t.type === "expense" ? "−" : t.side === "sell" ? "ขาย " : "";
    return `<div class="tx" data-id="${t.id}"><div class="dot ${t.type}">${TYPE_ICON[t.type]}</div>
      <div class="mid"><b>${esc(t.category)}${t.pending ? `<span class="tag pending">รอส่ง</span>` : ""}</b><span>${esc(t.note || TYPE_LABEL[t.type])}</span></div>
      <div class="amt ${t.type}">${sign}${money(t.amount)}</div></div>`;
  }
  function bindTxRows() { view.querySelectorAll(".tx").forEach((el) => el.onclick = () => openEdit(S.tx.find((t) => t.id === el.dataset.id))); }
  function donut(entries, centerLabel, centerValue, colorOf = (k, i) => PALETTE[i % PALETTE.length]) {
    const total = entries.reduce((a, e) => a + Math.max(e[1], 0), 0) || 1;
    let acc = 0;
    const stops = entries.map(([, v], i) => { const a = acc; acc += Math.max(v, 0) / total * 360; return `${colorOf(entries[i][0], i)} ${a}deg ${acc}deg`; });
    return `<div class="donut-wrap"><div class="donut" style="background:conic-gradient(${stops.join(",") || "#eee 0 360deg"})">
      <div class="c"><div>${centerLabel}<b>${centerValue}</b></div></div></div>
      <div class="legend">${entries.map(([k, v], i) => `<div><i style="background:${colorOf(k, i)}"></i><span>${esc(k)}</span><b>${Math.round(Math.max(v, 0) / total * 100)}%</b></div>`).join("")}</div></div>`;
  }

  // ---------- views ----------
  const VIEWS = {};

  VIEWS.home = () => {
    const s = sums(inMonth(S.ym));
    const ys = sums(inYear(S.ym.slice(0, 4)));
    const net = s.income - s.expense - s.invest;
    const rate = s.income ? (s.invest / s.income) * 100 : 0;
    const target = S.settings.savingTarget;
    const topExp = Object.entries(s.byCat).filter(([k]) => typeOf(k) === "expense").sort((a, b) => b[1] - a[1]);
    const topInc = Object.entries(s.byCat).filter(([k]) => typeOf(k) === "income").sort((a, b) => b[1] - a[1]);
    const recent = inMonth(S.ym).slice(0, 3);
    const isNow = S.ym === today().slice(0, 7);
    const pending = S.tx.filter((t) => t.pending).length;
    return `${localCard()}${!api.local && (!S.online || pending) ? `<div class="offline-bar">${S.online ? "กำลังส่ง…" : "📴 ออฟไลน์"} · รอส่งเข้าชีต ${pending} รายการ</div>` : ""}
      ${monthPicker(S.ym)}
      ${isNow ? allowanceCard(s) + recurringCard() : ""}
      <div class="card hero"><div class="label">คงเหลือเดือนนี้</div><div class="big">฿${money(net)}</div>
        <div class="row3"><div><span>รายรับ</span><b>${money(s.income)}</b></div><div><span>รายจ่าย</span><b>${money(s.expense)}</b></div><div><span>ออม+ลงทุน</span><b>${money(s.invest)}</b></div></div></div>
      <div class="card"><h2>อัตราการออม <small>เป้าหมาย ${target}%</small></h2>
        <div class="save-rate"><div class="meter"><div class="bar"><i class="${rate >= target ? "" : "near"}" style="width:${Math.min(rate, 100)}%"></i><span class="target" style="left:${target}%"></span></div></div>
        <b>${rate >= target ? "🟢" : "🔻"} ${rate.toFixed(0)}%</b></div>
        <div class="hint">ออม+ลงทุน ÷ รายรับ ของเดือนนี้</div></div>
      <div class="card"><h2>รายจ่ายตามหมวด <small>${ymLabel(S.ym)}</small></h2>
        ${topExp.length ? donut(topExp.slice(0, 6), "รวม", money(s.expense), catColor) : `<div class="empty">ยังไม่มีรายจ่าย</div>`}</div>
      <div class="card"><h2>รายรับตามหมวด <small>${ymLabel(S.ym)}</small></h2>
        ${topInc.length ? donut(topInc.slice(0, 6), "รวม", money(s.income), catColor) : `<div class="empty">ยังไม่มีรายรับ</div>`}</div>
      <div class="card"><h2>รายการล่าสุด <small><a data-go="list" style="color:var(--brand);cursor:pointer">ดูทั้งหมด</a></small></h2>
        ${recent.length ? recent.map(txRow).join("") : `<div class="empty">ยังไม่มีรายการเดือนนี้</div>`}</div>
      <div class="card"><h2>ทั้งปี ${S.ym.slice(0, 4)}</h2>
        <div class="row3" style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;font-size:13px">
          <div><div class="muted">รายรับ</div><b class="amt income">${money(ys.income)}</b></div>
          <div><div class="muted">รายจ่าย</div><b class="amt expense">${money(ys.expense)}</b></div>
          <div><div class="muted">ลงทุน</div><b class="amt invest">${money(ys.invest)}</b></div></div></div>`;
  };
  // "วันนี้ใช้ได้อีกกี่บาท": (expense budget − spent before today) ÷ days left, minus what was spent today.
  function allowanceCard(s) {
    const t = today(), [y, m, d] = t.split("-").map(Number);
    const b = S.budgets[S.ym] || {};
    let budget = S.cats.expense.reduce((a, c) => a + Number(b[c] || 0), 0);
    const fromBudget = budget > 0;
    if (!fromBudget) budget = s.income * (1 - S.settings.savingTarget / 100);
    const exp = inMonth(S.ym).filter((x) => x.type === "expense");
    const before = exp.filter((x) => x.date < t).reduce((a, x) => a + x.amount, 0);
    const spentToday = exp.filter((x) => x.date === t).reduce((a, x) => a + x.amount, 0);
    const daysLeft = new Date(y, m, 0).getDate() - d + 1;
    const perDay = Math.max(0, (budget - before) / daysLeft);
    const left = perDay - spentToday;
    const pct = perDay ? Math.min(spentToday / perDay * 100, 100) : 100;
    return `<div class="card allowance"><div class="label">${left >= 0 ? "วันนี้ใช้ได้อีก" : "วันนี้ใช้เกินไป"}</div>
      <div class="big ${left >= 0 ? "" : "neg"}">฿${money(Math.abs(left))}</div>
      <div class="bar"><i class="${left < 0 ? "over" : pct > 80 ? "near" : ""}" style="width:${pct}%"></i></div>
      <div class="hint">ใช้วันนี้ ${money(spentToday)} จาก ${money(perDay)}/วัน · งบรายจ่ายเหลือ ${money(Math.max(0, budget - before - spentToday))} · อีก ${daysLeft} วัน
      ${fromBudget ? "" : "<br>ยังไม่ตั้งงบรายจ่าย ใช้รายรับหักเป้าออมแทน"}</div></div>`;
  }
  function dueRecurring() {
    const d = +today().slice(8, 10), done = S.recDone[S.ym] || [];
    return S.recurring.filter((r) => r.day <= d && !done.includes(r.id));
  }
  function recurringCard() {
    const due = dueRecurring();
    if (!due.length) return "";
    return `<div class="card"><h2>รายการประจำที่ถึงกำหนด <small>${due.length} รายการ</small></h2>
      ${due.map((r) => `<div class="rec-row" data-rid="${r.id}"><div class="mid"><b>${esc(r.category)}</b><span>${esc(r.note)} · ทุกวันที่ ${r.day}</span></div>
        <input data-ramt inputmode="decimal" value="${r.amount}"><button class="btn" data-rsave style="width:auto;padding:8px 12px">บันทึก</button><button class="btn ghost" data-rskip style="width:auto;padding:8px 10px">ข้าม</button></div>`).join("")}</div>`;
  }
  function bindRecurringCard() {
    view.querySelectorAll(".rec-row").forEach((row) => {
      const r = S.recurring.find((x) => x.id === row.dataset.rid);
      const done = async () => { S.recDone = await api.markRecurring(S.ym, r.id); render(); };
      row.querySelector("[data-rsave]").onclick = async () => {
        const amount = parseFloat(row.querySelector("[data-ramt]").value.replace(/,/g, "")) || 0;
        if (!(amount > 0)) return toast("กรุณาใส่จำนวนเงิน");
        const day = String(Math.min(r.day, 28)).padStart(2, "0");
        await saveNew({ type: r.type, category: r.category, amount, note: r.note, date: `${S.ym}-${day}` });
        await done();
      };
      row.querySelector("[data-rskip]").onclick = done;
    });
  }
  VIEWS.home.bind = () => { bindMonthPicker("ym"); bindTxRows(); bindRecurringCard(); bindLocal(); view.querySelectorAll("[data-go]").forEach((a) => a.onclick = () => go(a.dataset.go)); };

  VIEWS.list = () => {
    let list = inMonth(S.ym);
    if (S.listFilter !== "all") list = list.filter((t) => t.type === S.listFilter);
    if (S.search) { const q = S.search.toLowerCase(); list = list.filter((t) => (t.category + " " + t.note).toLowerCase().includes(q)); }
    const groups = {};
    list.forEach((t) => (groups[t.date] ||= []).push(t));
    const s = sums(list);
    return `${monthPicker(S.ym)}
      <div class="seg">${["all", "income", "expense", "invest"].map((k) => `<button data-f="${k}" class="${S.listFilter === k ? "on" : ""}">${k === "all" ? "ทั้งหมด" : TYPE_LABEL[k]}</button>`).join("")}</div>
      <div class="field"><input id="q" placeholder="ค้นหา หมวด หรือรายละเอียด…" value="${esc(S.search)}"></div>
      <div class="muted" style="margin:0 4px 4px">${list.length} รายการ · รับ ${money(s.income)} · จ่าย ${money(s.expense)}</div>
      ${Object.keys(groups).length ? Object.entries(groups).map(([d, ts]) => `<div class="day-head">${dLabel(d)}</div><div class="card" style="padding:4px 16px">${ts.map(txRow).join("")}</div>`).join("") : `<div class="card empty">ไม่มีรายการ</div>`}`;
  };
  VIEWS.list.bind = () => {
    bindMonthPicker("ym"); bindTxRows();
    view.querySelectorAll("[data-f]").forEach((b) => b.onclick = () => { S.listFilter = b.dataset.f; render(); });
    const q = $("#q"); q.oninput = () => { S.search = q.value; const pos = q.selectionStart; render(); const n = $("#q"); n.focus(); n.setSelectionRange(pos, pos); };
  };

  // add / edit form (shared)
  function formHtml(t, isEdit) {
    const cats = S.cats[t.type];
    return `<div class="seg" id="ftype">${["expense", "income", "invest"].map((k) => `<button data-t="${k}" class="${t.type === k ? "on" : ""}">${TYPE_LABEL[k]}</button>`).join("")}</div>
      <div class="field"><label>จำนวนเงิน (บาท)</label><input id="famount" class="amount-input" inputmode="decimal" value="${t.amount || ""}" placeholder="0"></div>
      <div class="field"><label>หมวด</label><div class="chips" id="fcats">${cats.map((c) => `<button class="chip cat ${c === t.category ? "on" : ""}" data-c="${esc(c)}" style="--c:${catColor(c)}"><i></i>${esc(c)}</button>`).join("")}</div></div>
      ${t.type === "invest" ? `<div class="seg" id="fside"><button data-s="buy" class="${t.side !== "sell" ? "on" : ""}">ซื้อ / ออม</button><button data-s="sell" class="${t.side === "sell" ? "on" : ""}">ขาย / ถอน</button></div>` : ""}
      <div class="field"><label>วันที่</label><input id="fdate" type="date" value="${t.date}"></div>
      <div class="field"><label>รายละเอียด</label><input id="fnote" value="${esc(t.note)}" placeholder="เช่น ข้าวกลางวัน"></div>
      <div class="btn-row"><button class="btn" id="fsave">${isEdit ? "บันทึกการแก้ไข" : "บันทึก"}</button>${isEdit ? `<button class="btn danger" id="fdel" style="width:auto">ลบ</button>` : ""}</div>`;
  }
  function bindForm(root, t, onSave, onDelete) {
    const read = () => { t.amount = parseFloat(String($("#famount", root).value).replace(/,/g, "")) || 0; t.date = $("#fdate", root).value; t.note = $("#fnote", root).value.trim(); };
    const rerender = () => { read(); root.innerHTML = root._head + formHtml(t, !!onDelete); bindForm(root, t, onSave, onDelete); };
    root.querySelectorAll("#ftype [data-t]").forEach((b) => b.onclick = () => { read(); t.type = b.dataset.t; t.category = defaultCat(t.type); if (t.type === "invest") t.side ||= "buy"; rerender(); });
    root.querySelectorAll("#fcats [data-c]").forEach((b) => b.onclick = () => { root.querySelectorAll("#fcats .chip").forEach((x) => x.classList.remove("on")); b.classList.add("on"); t.category = b.dataset.c; });
    root.querySelectorAll("#fside [data-s]").forEach((b) => b.onclick = () => { root.querySelectorAll("#fside button").forEach((x) => x.classList.remove("on")); b.classList.add("on"); t.side = b.dataset.s; });
    $("#fsave", root).onclick = async () => {
      read();
      if (!(t.amount > 0)) return toast("กรุณาใส่จำนวนเงิน");
      if (!t.category) return toast("กรุณาเลือกหมวด");
      if (t.type !== "invest") delete t.side;
      await onSave({ ...t });
    };
    if (onDelete) $("#fdel", root).onclick = onDelete;
  }

  let draft = null;
  VIEWS.add = () => {
    draft ||= { type: "expense", category: defaultCat("expense"), amount: "", date: today(), note: "" };
    return `<div class="card" id="fwrap">${formHtml(draft, false)}</div>`;
  };
  async function saveNew(t, msg = "บันทึกแล้ว") {
    const item = await api.addTransaction(t);
    S.tx.unshift(item); S.tx.sort((a, b) => b.date.localeCompare(a.date));
    draft = null; toast(msg + ` · ${item.category} ${money(item.amount)}`);
  }
  VIEWS.add.bind = () => {
    const root = $("#fwrap"); root._head = "";
    bindForm(root, draft, async (t) => { await saveNew(t); go("home"); });
    setTimeout(() => $("#famount")?.focus(), 50);
  };

  function openEdit(t) {
    const sheet = $("#sheet");
    const copy = { ...t };
    sheet.innerHTML = `<div class="panel"><h3>แก้ไขรายการ</h3><div id="ewrap"></div></div>`;
    const root = $("#ewrap"); root._head = "";
    root.innerHTML = formHtml(copy, true);
    sheet.classList.remove("hidden");
    sheet.onclick = (e) => { if (e.target === sheet) sheet.classList.add("hidden"); };
    bindForm(root, copy, async (u) => {
      await api.updateTransaction(u);
      S.tx = S.tx.map((x) => (x.id === u.id ? u : x)).sort((a, b) => b.date.localeCompare(a.date));
      sheet.classList.add("hidden"); toast("แก้ไขแล้ว"); render();
    }, async () => {
      if (!confirm("ลบรายการนี้?")) return;
      await api.deleteTransaction(t.id);
      S.tx = S.tx.filter((x) => x.id !== t.id);
      sheet.classList.add("hidden"); toast("ลบแล้ว"); render();
    });
  }

  VIEWS.budget = () => {
    const period = S.budgetPeriod === "month" ? S.ym : S.ym.slice(0, 4);
    const s = sums(S.budgetPeriod === "month" ? inMonth(S.ym) : inYear(period));
    const b = budgetFor(period);
    const group = (type, title) => {
      const rows = S.cats[type].map((c) => {
        const actual = s.byCat[c] || 0, bud = Number(b[c] || 0);
        const pct = bud ? (actual / bud) * 100 : 0;
        const isIncome = type !== "expense";
        const over = actual - bud;
        let tag = "";
        if (bud) tag = type === "expense" ? (over > 0 ? `<span class="tag over">เกิน ${money(over)}</span>` : `<span class="tag ok">เหลือ ${money(-over)}</span>`)
          : (over >= 0 ? `<span class="tag ok">ถึงเป้า</span>` : `<span class="tag over">ขาด ${money(-over)}</span>`);
        const cls = !bud ? "" : type === "expense" ? (pct > 100 ? "over" : pct > 80 ? "near" : "") : (pct >= 100 ? "" : "near");
        if (!actual && !bud) return "";
        return `<div class="brow"><div class="top"><div><i class="cdot" style="background:${catColor(c)}"></i>${esc(c)}${tag}</div><div><b>${money(actual)}</b> <span>/ ${bud ? money(bud) : "ไม่ได้ตั้งงบ"}</span></div></div>
          <div class="bar"><i class="${cls}" style="width:${bud ? Math.min(pct, 100) : 0}%;${cls ? "" : `background:${catColor(c)}`}"></i></div></div>`;
      }).join("");
      const tA = s[type], tB = S.cats[type].reduce((a, c) => a + Number(b[c] || 0), 0);
      return `<div class="card"><h2>${title} <small>${money(tA)} / ${money(tB)}</small></h2>${rows || `<div class="empty">ไม่มีข้อมูล</div>`}</div>`;
    };
    return `<div class="seg">${[["month", "รายเดือน"], ["year", "ทั้งปี"]].map(([k, l]) => `<button data-p="${k}" class="${S.budgetPeriod === k ? "on" : ""}">${l}</button>`).join("")}</div>
      ${S.budgetPeriod === "month" ? monthPicker(S.ym) : `<div class="month-picker"><button data-yy="-1">‹</button><b>ปี ${period}</b><button data-yy="1">›</button></div>`}
      ${group("income", "กลุ่มรายรับ")}${group("expense", "กลุ่มค่าใช้จ่าย")}${group("invest", "กลุ่มการลงทุน การออม")}
      <button class="btn ghost" data-go="plan">ตั้งงบ / วางแผน →</button><div style="height:12px"></div>`;
  };
  VIEWS.budget.bind = () => {
    bindMonthPicker("ym");
    view.querySelectorAll("[data-p]").forEach((b) => b.onclick = () => { S.budgetPeriod = b.dataset.p; render(); });
    view.querySelectorAll("[data-yy]").forEach((b) => b.onclick = () => { S.ym = shiftYm(S.ym, 12 * b.dataset.yy); render(); });
    view.querySelectorAll("[data-go]").forEach((a) => a.onclick = () => go(a.dataset.go));
  };

  VIEWS.more = () => `<div class="card menu">
      ${[["plan", "🗓", "วางแผนรายรับ-รายจ่าย", "ตั้งเป้าแต่ละหมวด รายเดือน ล่วงหน้าหลายปี"],
        ["portfolio", "📈", "พอร์ตการลงทุน", "มูลค่าปัจจุบัน กำไร/ขาดทุน สัดส่วน"],
        ["yearly", "📊", "สรุปรายปี", "รายรับ รายจ่าย ออม รายเดือน และเทียบปี"],
        ["recurring", "🔁", "รายการประจำ", "ค่าเน็ต ค่าน้ำ-ไฟ ฯลฯ เตือนทุกเดือน"],
        ["data", "🗄", "จัดการข้อมูล", "สำรองข้อมูล · ย้ายข้อมูลปีเก่าไปเก็บ"],
        ["settings", "⚙", "ตั้งค่า", "หมวดหมู่ เป้าการออม"]].map(([k, ic, t, d]) => `<a data-go="${k}"><span class="ic">${ic}</span><div><b>${t}</b><span>${d}</span></div></a>`).join("")}</div>`;
  VIEWS.more.bind = () => view.querySelectorAll("[data-go]").forEach((a) => a.onclick = () => go(a.dataset.go));

  VIEWS.plan = () => {
    S.planYm ||= S.ym;
    const b = S.budgets[S.planYm] || {};
    const tot = (type) => S.cats[type].reduce((a, c) => a + Number(b[c] || 0), 0);
    const left = tot("income") - tot("expense") - tot("invest");
    const sec = (type, title) => `<div class="card"><h2>${title} <small>รวม ${money(tot(type))}</small></h2>
      ${S.cats[type].map((c) => `<div class="field" style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><label style="flex:1;margin:0;font-size:14px;color:var(--ink)">${esc(c)}</label>
      <input data-b="${esc(c)}" inputmode="decimal" style="width:120px;text-align:right" value="${b[c] || ""}" placeholder="0"></div>`).join("")}</div>`;
    return `<div class="month-picker"><button data-pm="-1">‹</button><b>${ymLabel(S.planYm)}</b><button data-pm="1">›</button></div>
      <div class="card hero"><div class="label">รายรับเหลือให้วางแผน</div><div class="big" id="pleft">฿${money(left)}</div>
        <div class="label">เป้ารายรับ − เป้ารายจ่าย − เป้าออม/ลงทุน</div></div>
      ${sec("income", "เป้าหมายรายรับ")}${sec("expense", "งบรายจ่าย")}${sec("invest", "เป้าการออม ลงทุน")}
      <div class="btn-row" style="margin-bottom:14px"><button class="btn" id="psave">บันทึกเดือนนี้</button><button class="btn ghost" id="pcopy">คัดลอกไปทุกเดือนของปี</button></div>`;
  };
  VIEWS.plan.bind = () => {
    view.querySelectorAll("[data-pm]").forEach((b) => b.onclick = () => { S.planYm = shiftYm(S.planYm, +b.dataset.pm); render(); });
    const collect = () => { const o = {}; view.querySelectorAll("[data-b]").forEach((i) => { const v = parseFloat(i.value.replace(/,/g, "")); if (v) o[i.dataset.b] = v; }); return o; };
    view.querySelectorAll("[data-b]").forEach((i) => i.oninput = () => {
      const o = collect(); const t = (type) => S.cats[type].reduce((a, c) => a + (o[c] || 0), 0);
      $("#pleft").textContent = "฿" + money(t("income") - t("expense") - t("invest"));
    });
    $("#psave").onclick = async () => { const o = collect(); await api.saveBudget(S.planYm, o); S.budgets[S.planYm] = o; toast("บันทึกแผนแล้ว"); };
    $("#pcopy").onclick = async () => {
      const o = collect(), y = S.planYm.slice(0, 4);
      for (let m = 1; m <= 12; m++) { const ym = `${y}-${String(m).padStart(2, "0")}`; await api.saveBudget(ym, { ...o }); S.budgets[ym] = { ...o }; }
      toast(`คัดลอกไปทั้งปี ${y} แล้ว`);
    };
  };

  // Portfolio: user types ทุน (cost) and มูลค่าปัจจุบัน (value) from their broker; P/L can be typed instead of value.
  let pfEdit = null; // working copy while editing
  const num = (v) => parseFloat(String(v).replace(/,/g, "")) || 0;
  VIEWS.portfolio = () => {
    if (pfEdit) {
      return `<div class="card muted" style="font-size:13px">กรอก <b>ทุน</b> (เงินที่คุณลงไป) และ <b>มูลค่าปัจจุบัน</b> จากแอป broker หรือกรอก <b>กำไร/ขาดทุน</b> แทน แล้วแอปคำนวณมูลค่าให้</div>
        ${pfEdit.map((x, i) => `<div class="card pf-edit" data-i="${i}">
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
            <input data-k="name" value="${esc(x.name)}" placeholder="ชื่อสินทรัพย์ เช่น NVDA" style="flex:1;font-weight:600;padding:9px 12px;border:1px solid var(--line);border-radius:10px">
            <button class="btn danger" data-del="${i}" style="width:auto;padding:9px 12px">ลบ</button></div>
          <div class="pf-grid">
            <div class="field"><label>ทุน</label><input data-k="cost" inputmode="decimal" value="${x.cost || ""}" placeholder="0"></div>
            <div class="field"><label>มูลค่าปัจจุบัน</label><input data-k="value" inputmode="decimal" value="${x.value || ""}" placeholder="0"></div>
            <div class="field"><label>กำไร/ขาดทุน</label><input data-k="pnl" inputmode="decimal" value="${x.cost || x.value ? +(x.value - x.cost).toFixed(2) : ""}" placeholder="0"></div>
          </div>
          <div class="hint" data-pct>${pctText(x)}</div></div>`).join("")}
        <button class="btn ghost" id="pfadd">＋ เพิ่มสินทรัพย์</button><div style="height:10px"></div>
        <div class="btn-row" style="position:sticky;bottom:88px"><button class="btn" id="pfsave">บันทึก</button><button class="btn ghost" id="pfcancel" style="width:auto">ยกเลิก</button></div><div style="height:14px"></div>`;
    }
    const p = S.portfolio;
    const cost = p.reduce((a, x) => a + x.cost, 0), val = p.reduce((a, x) => a + x.value, 0);
    const g = val - cost, gp = cost ? (g / cost) * 100 : 0;
    const alloc = p.map((x) => [x.name, x.value]).sort((a, b) => b[1] - a[1]);
    const last = p.map((x) => x.updatedAt).filter(Boolean).sort().pop();
    return `<div class="card hero"><div class="label">มูลค่าพอร์ตปัจจุบัน</div><div class="big">฿${money(val, 2)}</div>
        <div class="row3"><div><span>เงินลงทุน</span><b>${money(cost)}</b></div><div><span>กำไร/ขาดทุน</span><b>${g >= 0 ? "+" : ""}${money(g)}</b></div><div><span>เติบโต</span><b>${gp >= 0 ? "+" : ""}${gp.toFixed(2)}%</b></div></div></div>
      <button class="btn" id="pfedit" style="margin-bottom:12px">✎ อัปเดตตัวเลขจาก broker</button>
      ${historyCard()}
      <div class="card"><h2>สัดส่วน${pfBasis === "cost" ? "ตามเงินทุน" : "ตามมูลค่า"}</h2>
        <div class="seg">${[["value", "ตามมูลค่า"], ["cost", "ตามเงินทุน"]].map(([k, l]) => `<button data-basis="${k}" class="${pfBasis === k ? "on" : ""}">${l}</button>`).join("")}</div>
        ${pfg().length ? `<div class="seg">${[["asset", "รายตัว"], ["group", "ตามหมวด"]].map(([k, l]) => `<button data-donut="${k}" class="${pfDonut === k ? "on" : ""}">${l}</button>`).join("")}</div>` : ""}
        ${!p.length ? `<div class="empty">ยังไม่มีสินทรัพย์</div>` : pfg().length && pfDonut === "group"
          ? donut(groupRows(val).rows.sort((a, b) => b.value - a.value).map((r) => [r.name, r[pfBasis]]), "หมวด", pfg().length + " หมวด")
          : donut(alloc.map(([n]) => [n, p.find((x) => x.name === n)[pfBasis]]), "สินทรัพย์", p.length + " ตัว")}
        <div class="hint">${pfBasis === "cost" ? "คิดจากเงินที่ใส่ไป ไม่เปลี่ยนตามราคา" : "คิดจากมูลค่าตอนนี้ = ความเสี่ยงที่ถืออยู่จริง"} · สีของแต่ละตัวเหมือนกันทั้งสองแบบ</div></div>
      ${p.length ? targetCard(val) : ""}
      <div class="card"><h2>รายตัว <small>${last ? "อัปเดต " + dLabel(last) : ""}</small></h2>
        <table class="t"><tr><th>สินทรัพย์</th><th>ทุน</th><th>มูลค่า</th><th>กำไร/ขาดทุน</th></tr>
        ${p.map((x) => { const d = x.value - x.cost, pc = x.cost ? (d / x.cost) * 100 : 0; return `<tr><td><b>${esc(x.name)}</b></td><td>${money(x.cost)}</td><td>${money(x.value)}</td><td class="${d >= 0 ? "pos" : "neg"}">${d >= 0 ? "+" : ""}${money(d)}<br><small>${pc >= 0 ? "+" : ""}${pc.toFixed(1)}%</small></td></tr>`; }).join("")}</table></div>`;
  };
  // One snapshot (total cost, total value) is stored each day the user saves the portfolio.
  function historyCard() {
    const h = S.history;
    if (h.length < 2) {
      return `<div class="card"><h2>ประวัติพอร์ต</h2><div class="muted">${h.length ? `บันทึกครั้งแรกแล้ว (${dLabel(h[0].date)})` : "ยังไม่มีประวัติ"} · กราฟจะขึ้นเมื่ออัปเดตตัวเลขจาก broker อย่างน้อย 2 วัน</div></div>`;
    }
    const W = 320, H = 130, P = 6;
    const vals = h.flatMap((x) => [x.cost, x.value]);
    const lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
    const X = (i) => P + (i / (h.length - 1)) * (W - 2 * P);
    const Y = (v) => H - P - ((v - lo) / span) * (H - 2 * P);
    const line = (k) => h.map((x, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(x[k]).toFixed(1)}`).join("");
    const first = h[0], last = h[h.length - 1];
    const g = last.value - last.cost;
    return `<div class="card"><h2>ประวัติพอร์ต <small><span style="color:var(--brand)">━</span> มูลค่า <span style="color:var(--muted)">┅</span> ทุน</small></h2>
      <svg viewBox="0 0 ${W} ${H}" class="hist"><path d="${line("cost")}" fill="none" stroke="#9aa39e" stroke-width="2" stroke-dasharray="4 4"/>
      <path d="${line("value")}" fill="none" stroke="var(--brand)" stroke-width="2.5"/>
      ${h.map((x, i) => `<circle cx="${X(i)}" cy="${Y(x.value)}" r="3" fill="var(--brand)"/>`).join("")}</svg>
      <div class="hint">${dLabel(first.date)} → ${dLabel(last.date)} · ${h.length} ครั้ง · กำไรล่าสุด <span class="${g >= 0 ? "pos" : "neg"}">${g >= 0 ? "+" : ""}${money(g)}</span></div></div>`;
  }
  // ---- asset groups: user makes groups (หุ้นรายตัว, ETF, ทอง ...), puts each asset in one, sets target % per group ----
  let gEdit = null;     // {groups, of} working copy while editing
  let newMoney = "";    // amount typed into "มีเงินจะลงเพิ่ม"
  let pfDonut = "asset";
  let pfBasis = "value"; // donut: share of current value or of money put in
  const pfg = () => S.settings.pfGroups || [];      // [{id, name, target}]
  const pfOf = () => S.settings.pfGroupOf || {};    // {assetName: groupId}
  const SUGGEST = [["g_cash", "เงินสด", /เงิน|cash/i], ["g_etf", "ETF / กองทุน", /^(SPY|VOO|QQQ|VTI|VT|SCHD|IVV)$|ETF|กองทุน/i],
    ["g_gold", "ทอง", /gold|ทอง|GLD/i], ["g_crypto", "คริปโต", /BTC|ETH|SOL|คริปโต|crypto/i], ["g_stock", "หุ้นรายตัว", /./]];
  function suggestGroups() {
    const of = {};
    S.portfolio.forEach((x) => { of[x.name] = SUGGEST.find(([, , re]) => re.test(x.name) || re.test(x.symbol || ""))[0]; });
    const used = new Set(Object.values(of));
    return { groups: SUGGEST.filter(([id]) => used.has(id)).map(([id, name]) => ({ id, name, target: 0 })), of };
  }
  // Groups with their assets, current %, normalised target % and baht gap. Last row = assets not in any group.
  function groupRows(val) {
    const gs = pfg(), of = pfOf(), sumT = gs.reduce((a, g) => a + (g.target || 0), 0);
    const rows = gs.map((g) => ({ ...g, assets: S.portfolio.filter((x) => of[x.name] === g.id) }));
    const loose = S.portfolio.filter((x) => !gs.some((g) => g.id === of[x.name]));
    if (loose.length) rows.push({ id: "", name: "ยังไม่จัดหมวด", target: 0, assets: loose, loose: true });
    const costTot = S.portfolio.reduce((a, x) => a + x.cost, 0);
    rows.forEach((r) => {
      r.value = r.assets.reduce((a, x) => a + x.value, 0);
      r.cost = r.assets.reduce((a, x) => a + x.cost, 0);
      r.costPct = costTot ? (r.cost / costTot) * 100 : 0;
      r.cur = val ? (r.value / val) * 100 : 0;
      r.tg = sumT ? ((r.target || 0) / sumT) * 100 : 0;
      r.gap = (r.tg / 100) * val - r.value;
    });
    return { rows, sumT };
  }
  // Split `n` baht of new money: fill the groups furthest below target first, leftover by target %.
  function splitNewMoney(n, val) {
    const { rows, sumT } = groupRows(val);
    if (!n || !sumT) return [];
    const T = val + n;
    const rs = rows.filter((r) => r.target > 0).map((r) => ({ name: r.name, w: r.target / sumT, need: Math.max(0, (r.target / sumT) * T - r.value) }));
    const needSum = rs.reduce((a, r) => a + r.need, 0);
    rs.forEach((r) => { r.add = needSum >= n ? (r.need / needSum) * n : r.need + (n - needSum) * r.w; });
    return rs.filter((r) => r.add >= 0.5).sort((a, b) => b.add - a.add);
  }
  // How much a group's share moved because of price: value% minus cost%.
  const driftText = (r) => { const d = r.cur - r.costPct; return Math.abs(d) < 0.5 ? `<span class="muted">(ใกล้เคียงเดิม)</span>`
    : `<span class="${d > 0 ? "pos" : "neg"}">(${d > 0 ? "โตกว่าที่ใส่ +" : "หดกว่าที่ใส่ "}${d.toFixed(1)}%)</span>`; };
  const gapTag = (r, val) => Math.abs(r.gap) < val * 0.01 ? `<span class="tag ok">ตรงเป้า</span>`
    : r.gap > 0 ? `<span class="tag pending">ขาด ${money(r.gap)}</span>` : `<span class="tag over">เกิน ${money(-r.gap)}</span>`;
  function groupEditCard(val) {
    const s = +gEdit.groups.reduce((a, g) => a + (g.target || 0), 0).toFixed(2);
    return `<div class="card" id="gcard"><h2>หมวดและเป้าหมาย <small id="gsum" class="${Math.abs(s - 100) < 0.01 ? "pos" : "neg"}">รวม ${s}%</small></h2>
      ${gEdit.groups.map((g, i) => `<div class="rec-row"><input data-gname="${i}" value="${esc(g.name)}" placeholder="ชื่อหมวด" style="flex:1;width:auto;text-align:left;font-weight:500">
        <input data-gt="${i}" inputmode="decimal" value="${g.target || ""}" placeholder="0"><span class="muted">%</span>
        <button class="btn danger" data-gdel="${i}" style="width:auto;padding:6px 10px">✕</button></div>`).join("") || `<div class="muted">ยังไม่มีหมวด</div>`}
      <div style="display:flex;gap:8px;margin:10px 0 4px"><button class="btn ghost" id="gadd">＋ เพิ่มหมวด</button>
        ${gEdit.groups.length ? "" : `<button class="btn ghost" id="gsuggest">ใช้หมวดแนะนำ</button>`}</div>
      <div class="hint" style="margin-bottom:14px">เป้าทุกหมวดควรรวมกันได้ 100% · หมวดที่ใส่ 0 จะแสดงผลแต่ไม่นับในการแบ่งเงิน</div>
      <h2>จัดสินทรัพย์เข้าหมวด</h2>
      ${S.portfolio.map((x) => `<div class="rec-row"><div class="mid"><b>${esc(x.name)}</b><span>${money(x.value)} · ${val ? ((x.value / val) * 100).toFixed(1) : 0}%</span></div>
        <select data-gof="${esc(x.name)}" style="max-width:150px;padding:7px 8px;border:1px solid var(--line);border-radius:9px;background:var(--card)">
          <option value="">— ไม่จัดหมวด —</option>${gEdit.groups.map((g) => `<option value="${g.id}" ${gEdit.of[x.name] === g.id ? "selected" : ""}>${esc(g.name || "(ไม่มีชื่อ)")}</option>`).join("")}</select></div>`).join("")}
      <div class="btn-row" style="margin-top:12px"><button class="btn" id="gsave">บันทึก</button><button class="btn ghost" id="gcancel" style="width:auto">ยกเลิก</button></div></div>`;
  }
  function targetCard(val) {
    if (gEdit) return groupEditCard(val);
    if (!pfg().length) return `<div class="card"><h2>หมวดสินทรัพย์และเป้าหมาย</h2><div class="muted" style="margin-bottom:10px">จัดสินทรัพย์เป็นหมวด เช่น หุ้นรายตัว · ETF · ทอง · คริปโต แล้วตั้งเป้าแต่ละหมวด แอปจะบอกว่าหมวดไหนเกินหรือขาด และควรใส่เงินก้อนใหม่ที่ไหน</div>
      <button class="btn ghost" id="gedit">จัดหมวดสินทรัพย์</button></div>`;
    const { rows, sumT } = groupRows(val);
    return `<div class="card"><h2>หมวดและเป้าหมาย <small><a id="gedit" style="color:var(--brand);cursor:pointer">แก้หมวด/เป้า</a></small></h2>
      ${sumT && Math.abs(sumT - 100) > 0.01 ? `<div class="offline-bar">เป้ารวม ${sumT}% ไม่ครบ 100% · คำนวณโดยปรับให้รวมเป็น 100%</div>` : ""}
      ${!sumT ? `<div class="offline-bar">ยังไม่ได้ตั้งเป้า % ของหมวด · กด “แก้หมวด/เป้า”</div>` : ""}
      ${rows.map((r) => `<div class="brow"><div class="top"><b style="font-weight:600;${r.loose ? "color:var(--muted)" : ""}">${esc(r.name)}</b>
        <span>${r.cur.toFixed(1)}%${r.target > 0 ? ` / เป้า ${r.tg.toFixed(0)}% ${gapTag(r, val)}` : ""}</span></div>
        <div class="bar"><i style="width:${Math.min(100, r.cur)}%;background:${r.loose ? "#9aa39e" : "var(--brand)"}"></i>${r.target > 0 ? `<span class="target" style="left:${Math.min(100, r.tg)}%"></span>` : ""}</div>
        <div class="hint">ทุน ${r.costPct.toFixed(1)}% → มูลค่า ${r.cur.toFixed(1)}% ${driftText(r)}</div>
        <div class="hint" style="margin-top:2px">${r.assets.map((x) => `${esc(x.name)} ${money(x.value)}`).join(" · ") || "ไม่มีสินทรัพย์"}</div></div>`).join("")}
      ${sumT ? `<h2 style="margin-top:16px">มีเงินจะลงเพิ่ม</h2>
      <div class="field" style="display:flex;gap:8px;align-items:center"><input id="tnew" inputmode="decimal" value="${esc(newMoney)}" placeholder="เช่น 3000" style="text-align:right"><span>บาท</span></div>
      <div id="tsplit">${splitHtml(splitNewMoney(num(newMoney), val))}</div>
      <div class="hint">เป็นการคำนวณตามเป้าที่คุณตั้งเองเท่านั้น ไม่ใช่คำแนะนำการลงทุน</div>` : ""}</div>`;
  }
  const splitHtml = (split) => split.length ? `<div class="muted" style="margin-bottom:4px">ใส่เพิ่มในหมวดเพื่อให้เข้าใกล้เป้า:</div>` + split.map((r) =>
    `<div style="display:flex;justify-content:space-between;padding:5px 0"><span>${esc(r.name)}</span><b>+${money(r.add)}</b></div>`).join("") : "";
  function pctText(x) {
    const d = x.value - x.cost, pc = x.cost ? (d / x.cost) * 100 : 0;
    return x.cost ? `<span class="${d >= 0 ? "pos" : "neg"}">${d >= 0 ? "▲ +" : "▼ "}${money(d)} (${pc >= 0 ? "+" : ""}${pc.toFixed(2)}%)</span>` : "";
  }
  VIEWS.portfolio.bind = () => {
    if (!pfEdit) {
      $("#pfedit").onclick = () => { pfEdit = structuredClone(S.portfolio); gEdit = null; render(); };
      view.querySelectorAll("[data-donut]").forEach((b) => b.onclick = () => { pfDonut = b.dataset.donut; render(); });
      view.querySelectorAll("[data-basis]").forEach((b) => b.onclick = () => { pfBasis = b.dataset.basis; render(); });
      const ge = $("#gedit");
      if (ge) ge.onclick = () => {
        gEdit = pfg().length ? { groups: structuredClone(pfg()), of: { ...pfOf() } } : suggestGroups();
        render(); $("#gcard")?.scrollIntoView({ block: "start" });
      };
      const tn = $("#tnew");
      if (tn) tn.oninput = () => { newMoney = tn.value; const val = S.portfolio.reduce((a, x) => a + x.value, 0); $("#tsplit").innerHTML = splitHtml(splitNewMoney(num(newMoney), val)); };
      if (gEdit) {
        const sumLabel = () => { const s = +gEdit.groups.reduce((a, g) => a + (g.target || 0), 0).toFixed(2); const l = $("#gsum"); l.textContent = `รวม ${s}%`; l.className = Math.abs(s - 100) < 0.01 ? "pos" : "neg"; };
        view.querySelectorAll("[data-gname]").forEach((el) => el.oninput = () => {
          const g = gEdit.groups[+el.dataset.gname]; g.name = el.value;
          view.querySelectorAll(`select[data-gof] option[value="${g.id}"]`).forEach((o) => o.textContent = el.value || "(ไม่มีชื่อ)");
        });
        view.querySelectorAll("[data-gt]").forEach((el) => el.oninput = () => { gEdit.groups[+el.dataset.gt].target = num(el.value); sumLabel(); });
        view.querySelectorAll("[data-gof]").forEach((el) => el.onchange = () => { if (el.value) gEdit.of[el.dataset.gof] = el.value; else delete gEdit.of[el.dataset.gof]; });
        view.querySelectorAll("[data-gdel]").forEach((b) => b.onclick = () => {
          const g = gEdit.groups[+b.dataset.gdel], n = S.portfolio.filter((x) => gEdit.of[x.name] === g.id).length;
          if (n && !confirm(`ลบหมวด “${g.name}”? สินทรัพย์ ${n} ตัวในหมวดนี้จะกลายเป็น “ยังไม่จัดหมวด”`)) return;
          Object.keys(gEdit.of).forEach((k) => { if (gEdit.of[k] === g.id) delete gEdit.of[k]; });
          gEdit.groups.splice(+b.dataset.gdel, 1); render();
        });
        $("#gadd").onclick = () => { gEdit.groups.push({ id: "g" + Date.now(), name: "", target: 0 }); render(); [...view.querySelectorAll("[data-gname]")].pop()?.focus(); };
        const gs = $("#gsuggest"); if (gs) gs.onclick = () => { gEdit = suggestGroups(); render(); };
        $("#gcancel").onclick = () => { gEdit = null; render(); };
        $("#gsave").onclick = async () => {
          const names = gEdit.groups.map((g) => g.name.trim());
          if (names.some((n) => !n)) return toast("กรุณาตั้งชื่อหมวดให้ครบ");
          if (new Set(names).size !== names.length) return toast("ชื่อหมวดซ้ำกัน");
          S.settings.pfGroups = gEdit.groups.map((g) => ({ ...g, name: g.name.trim() }));
          S.settings.pfGroupOf = Object.fromEntries(Object.entries(gEdit.of).filter(([n, id]) => S.portfolio.some((x) => x.name === n) && gEdit.groups.some((g) => g.id === id)));
          delete S.settings.portfolioTargets;
          await api.saveSettings(S.settings);
          gEdit = null; toast("บันทึกหมวดแล้ว"); render();
        };
      }
      return;
    }
    view.querySelectorAll(".pf-edit").forEach((card) => {
      const x = pfEdit[+card.dataset.i];
      const inp = (k) => card.querySelector(`[data-k="${k}"]`);
      card.querySelectorAll("input").forEach((el) => el.oninput = () => {
        const k = el.dataset.k;
        if (k === "name") { x.name = el.value; return; }
        if (k === "cost") { x.cost = num(el.value); if (inp("value").value !== "") inp("pnl").value = +(x.value - x.cost).toFixed(2); else { x.value = x.cost + num(inp("pnl").value); } }
        if (k === "value") { x.value = num(el.value); inp("pnl").value = +(x.value - x.cost).toFixed(2); }
        if (k === "pnl") { x.value = +(x.cost + num(el.value)).toFixed(2); inp("value").value = x.value; }
        x._touched = true;
        card.querySelector("[data-pct]").innerHTML = pctText(x);
      });
    });
    view.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => {
      const x = pfEdit[+b.dataset.del];
      if (!confirm(`ลบ “${x.name || "สินทรัพย์นี้"}” ออกจากพอร์ต?`)) return;
      pfEdit.splice(+b.dataset.del, 1); render();
    });
    $("#pfadd").onclick = () => { pfEdit.push({ symbol: "", name: "", cost: 0, value: 0, _touched: true }); render(); view.querySelector(".pf-edit:last-of-type [data-k=name]")?.focus(); };
    $("#pfcancel").onclick = () => { pfEdit = null; render(); };
    $("#pfsave").onclick = async () => {
      if (pfEdit.some((x) => !x.name.trim())) return toast("กรุณาใส่ชื่อสินทรัพย์ให้ครบ");
      const list = pfEdit.map(({ _touched, ...x }) => ({ ...x, name: x.name.trim(), symbol: x.symbol || x.name.trim(), updatedAt: _touched ? today() : x.updatedAt }));
      const r = await api.savePortfolio(list);
      S.portfolio = r.portfolio; S.history = r.history;
      pfEdit = null; toast("บันทึกพอร์ตแล้ว"); render();
    };
  };

  VIEWS.yearly = () => {
    const y = S.year;
    const months = Array.from({ length: 12 }, (_, i) => sums(inMonth(`${y}-${String(i + 1).padStart(2, "0")}`)));
    const max = Math.max(1, ...months.flatMap((m) => [m.income, m.expense, m.invest]));
    const ys = sums(inYear(y));
    const rate = ys.income ? (ys.invest / ys.income) * 100 : 0;
    return `<div class="month-picker"><button data-y="-1">‹</button><b>ปี ${y}</b><button data-y="1">›</button></div>
      <div class="card hero"><div class="label">คงเหลือทั้งปี</div><div class="big">฿${money(ys.income - ys.expense - ys.invest)}</div>
        <div class="row3"><div><span>รายรับ</span><b>${money(ys.income)}</b></div><div><span>รายจ่าย</span><b>${money(ys.expense)}</b></div><div><span>ออม ${rate.toFixed(0)}%</span><b>${money(ys.invest)}</b></div></div></div>
      <div class="card"><h2>รายเดือน <small><span style="color:var(--income)">■</span> รับ <span style="color:var(--expense)">■</span> จ่าย <span style="color:var(--invest)">■</span> ลงทุน</small></h2>
        <div class="bars">${months.map((m, i) => `<div class="col"><div class="pair"><i class="i-income" style="height:${m.income / max * 100}%"></i><i class="i-expense" style="height:${m.expense / max * 100}%"></i><i class="i-invest" style="height:${m.invest / max * 100}%"></i></div><span>${TH_M[i].replace(".", "")}</span></div>`).join("")}</div></div>
      <div class="card"><h2>ตาราง</h2><table class="t"><tr><th>เดือน</th><th>รายรับ</th><th>รายจ่าย</th><th>ออม</th><th>คงเหลือ</th></tr>
        ${months.map((m, i) => { const n = m.income - m.expense - m.invest; return `<tr><td>${TH_M[i]}</td><td>${money(m.income)}</td><td>${money(m.expense)}</td><td>${money(m.invest)}</td><td class="${n >= 0 ? "pos" : "neg"}">${money(n)}</td></tr>`; }).join("")}
        <tr><td><b>รวม</b></td><td><b>${money(ys.income)}</b></td><td><b>${money(ys.expense)}</b></td><td><b>${money(ys.invest)}</b></td><td><b>${money(ys.income - ys.expense - ys.invest)}</b></td></tr></table></div>`;
  };
  VIEWS.yearly.bind = () => view.querySelectorAll("[data-y]").forEach((b) => b.onclick = () => { S.year += +b.dataset.y; render(); });

  VIEWS.settings = () => `<div class="card"><h2>ธีม</h2>
      <div class="seg" style="margin:0">${[["auto", "ตามเครื่อง"], ["light", "สว่าง"], ["dark", "มืด"]].map(([k, l]) =>
        `<button data-theme-opt="${k}" class="${(S.settings.theme || "auto") === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
    <div class="card"><h2>เป้าหมายอัตราการออม</h2>
      <div class="field" style="display:flex;gap:10px;align-items:center"><input id="starget" inputmode="numeric" value="${S.settings.savingTarget}" style="width:90px;text-align:right"><span>% ของรายรับ</span></div></div>
      ${["income", "expense", "invest"].map((type) => `<div class="card"><h2>หมวด${TYPE_LABEL[type]}</h2>
        <div class="chips" style="margin-bottom:10px">${S.cats[type].map((c) => `<span class="chip">${esc(c)} <a data-rm="${type}|${esc(c)}" style="color:var(--danger);cursor:pointer;margin-left:4px">✕</a></span>`).join("")}</div>
        <div style="display:flex;gap:8px"><input data-new="${type}" placeholder="เพิ่มหมวดใหม่" style="flex:1;padding:9px 12px;border:1px solid var(--line);border-radius:10px"><button class="btn" data-add="${type}" style="width:auto">เพิ่ม</button></div></div>`).join("")}
      <button class="btn" id="ssave">บันทึกการตั้งค่า</button><div style="height:10px"></div>
      ${api.resetDemo ? `<button class="btn ghost" id="sreset">รีเซ็ตข้อมูล demo กลับเป็นค่าจากชีต</button><div style="height:14px"></div>` : ""}`;
  VIEWS.settings.bind = () => {
    view.querySelectorAll("[data-theme-opt]").forEach((b) => b.onclick = async () => {
      S.settings.theme = b.dataset.themeOpt; applyTheme(); await api.saveSettings(S.settings); render();
    });
    view.querySelectorAll("[data-rm]").forEach((a) => a.onclick = async () => {
      const [type, c] = a.dataset.rm.split("|");
      if (!confirm(`ลบหมวด “${c}”? (รายการเก่ายังอยู่)`)) return;
      S.cats[type] = S.cats[type].filter((x) => x !== c); await api.saveCategories(S.cats); render();
    });
    view.querySelectorAll("[data-add]").forEach((b) => b.onclick = async () => {
      const type = b.dataset.add, inp = view.querySelector(`[data-new="${type}"]`), v = inp.value.trim();
      if (!v || S.cats[type].includes(v)) return;
      S.cats[type].push(v); await api.saveCategories(S.cats); render();
    });
    $("#ssave").onclick = async () => { S.settings.savingTarget = Math.max(0, Math.min(100, +$("#starget").value || 0)); await api.saveSettings(S.settings); toast("บันทึกแล้ว"); };
    if ($("#sreset")) $("#sreset").onclick = async () => { if (!confirm("รีเซ็ตข้อมูล demo ทั้งหมด?")) return; await api.resetDemo(); await loadAll(); toast("รีเซ็ตแล้ว"); go("home"); };
  };

  // ---------- recurring items ----------
  VIEWS.recurring = () => {
    const allCats = ["expense", "income", "invest"].flatMap((t) => S.cats[t]);
    return `<div class="card muted" style="font-size:13px">เมื่อถึงวันที่ที่ตั้งไว้ รายการจะขึ้นที่หน้าหลักให้กด “บันทึก” (แก้ยอดก่อนได้) หรือ “ข้าม”</div>
      ${S.recurring.map((r, i) => `<div class="card rec-edit" data-i="${i}">
        <div class="field"><label>หมวด</label><select data-k="category">${allCats.map((c) => `<option ${c === r.category ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
        <div class="pf-grid" style="grid-template-columns:1fr 1fr">
          <div class="field"><label>จำนวนเงิน</label><input data-k="amount" inputmode="decimal" value="${r.amount}"></div>
          <div class="field"><label>ทุกวันที่</label><input data-k="day" inputmode="numeric" value="${r.day}"></div></div>
        <div class="field"><label>รายละเอียด</label><input data-k="note" value="${esc(r.note)}"></div>
        <button class="btn danger" data-del="${i}">ลบรายการประจำนี้</button></div>`).join("") || `<div class="card empty">ยังไม่มีรายการประจำ</div>`}
      <button class="btn ghost" id="radd">＋ เพิ่มรายการประจำ</button><div style="height:10px"></div>
      <button class="btn" id="rsave">บันทึก</button><div style="height:14px"></div>`;
  };
  VIEWS.recurring.bind = () => {
    const collect = () => {
      view.querySelectorAll(".rec-edit").forEach((card) => {
        const r = S.recurring[+card.dataset.i], v = (k) => card.querySelector(`[data-k="${k}"]`).value;
        r.category = v("category"); r.type = typeOf(r.category);
        r.amount = parseFloat(v("amount").replace(/,/g, "")) || 0;
        r.day = Math.max(1, Math.min(31, parseInt(v("day")) || 1));
        r.note = v("note").trim();
      });
    };
    view.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => { collect(); S.recurring.splice(+b.dataset.del, 1); render(); });
    $("#radd").onclick = () => { collect(); S.recurring.push({ id: "r" + Date.now(), type: "expense", category: S.cats.expense[0], amount: 0, day: 1, note: "" }); render(); };
    $("#rsave").onclick = async () => { collect(); await api.saveRecurring(S.recurring); toast("บันทึกรายการประจำแล้ว"); };
  };

  // ---------- phone-only mode (api.local): backup files ----------
  // Data lives only on this phone, so the app nudges for a backup file and can restore from one.
  async function saveFile(name, text, type) {
    const file = new File([text], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return true; }
      catch (e) { if (e.name === "AbortError") return false; }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return true;
  }
  async function exportBackup() {
    const data = await api.exportData();
    if (!(await saveFile(`finance-backup-${today()}.json`, JSON.stringify(data), "application/json"))) return;
    S.backup = await api.markBackedUp(); toast("สำรองแล้ว"); render();
  }
  async function exportCsv() {
    const cell = (v) => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
    const rows = [["วันที่", "ประเภท", "หมวด", "จำนวนเงิน", "หมายเหตุ", "ซื้อ/ขาย"]].concat(S.tx.map((t) =>
      [t.date, TYPE_LABEL[t.type], t.category, t.amount, t.note || "", t.type === "invest" ? (t.side === "sell" ? "ขาย" : "ซื้อ") : ""]));
    await saveFile(`finance-${today()}.csv`, "\ufeff" + rows.map((r) => r.map(cell).join(",")).join("\r\n"), "text/csv");
  }
  async function importBackup(input) {
    const f = input.files[0]; input.value = "";
    if (!f) return;
    let obj;
    try { obj = JSON.parse(await f.text()); } catch (e) { toast("อ่านไฟล์ไม่ได้ ต้องเป็นไฟล์ .json จากแอปนี้"); return; }
    if (!api.isEmpty() && !confirm("ข้อมูลทั้งหมดในเครื่องนี้จะถูกแทนที่ด้วยข้อมูลจากไฟล์ ทำต่อไหม?")) return;
    try {
      const r = await api.importData(obj);
      await loadAll(); toast(`นำเข้าแล้ว ${r.count} รายการ`); go("home");
    } catch (e) { toast(e.message); }
  }
  const fileInput = (id) => `<input type="file" id="${id}" accept=".json,application/json" style="display:none">`;
  function localCard() {
    if (!api.local) return "";
    if (api.isEmpty()) return `<div class="card"><h2>เริ่มใช้งาน</h2>
      <div class="muted" style="margin-bottom:10px">มีไฟล์สำรอง (.json) อยู่แล้ว เช่นข้อมูลจากชีตเดิม? นำเข้าได้เลย หรือกด ＋ ด้านล่างเพื่อเริ่มบันทึกใหม่</div>
      <button class="btn" id="himport">นำเข้าไฟล์สำรอง</button>${fileInput("hfile")}</div>`;
    const last = S.backup.lastBackup ? new Date(S.backup.lastBackup) : null;
    const days = last ? Math.floor((Date.now() - last) / 864e5) : Infinity;
    if (days < 30) return "";
    return `<div class="offline-bar" style="text-align:left">💾 ${last ? `ไม่ได้สำรองข้อมูลมา ${days} วัน` : "ยังไม่เคยสำรองข้อมูล"} — ข้อมูลอยู่ในเครื่องนี้เท่านั้น
      <button class="btn ghost" id="hbackup" style="margin-top:8px">สำรองตอนนี้</button></div>`;
  }
  function bindLocal() {
    if ($("#hbackup")) $("#hbackup").onclick = exportBackup;
    if ($("#himport")) { $("#himport").onclick = () => $("#hfile").click(); $("#hfile").onchange = (e) => importBackup(e.target); }
  }

  // ---------- data management: archive old years + backup ----------
  VIEWS.data = () => {
    const years = [...new Set(S.tx.map((t) => t.date.slice(0, 4)))].sort();
    const cur = today().slice(0, 4);
    const bk = S.backup.lastBackup ? new Date(S.backup.lastBackup) : null;
    const bkText = `สำรองล่าสุด: <b>${bk ? bk.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" }) : "ยังไม่เคย"}</b>`;
    return `${api.local ? `<div class="card"><h2>สำรองข้อมูล</h2>
        <div class="muted" style="margin-bottom:10px">ข้อมูลทั้งหมดอยู่ในเครื่องนี้เท่านั้น ถ้าลบแอปหรือเครื่องหาย ข้อมูลจะหายด้วย ส่งออกไฟล์สำรองแล้วกด “บันทึกไปยังไฟล์” เก็บไว้ใน iCloud Drive / Google Drive อย่างน้อยเดือนละครั้ง</div>
        <div style="margin-bottom:10px">${bkText}</div>
        <button class="btn" id="bexport">ส่งออกไฟล์สำรอง</button><div style="height:8px"></div>
        <button class="btn ghost" id="bimport">นำเข้าไฟล์สำรอง (กู้คืน / ย้ายเครื่อง)</button><div style="height:8px"></div>
        <button class="btn ghost" id="bcsv">ส่งออกรายการเป็น CSV (เปิดใน Excel / Sheets)</button>${fileInput("bfile")}</div>`
      : `<div class="card"><h2>สำรองข้อมูล</h2>
        <div class="muted" style="margin-bottom:10px">ระบบคัดลอกชีตทั้งไฟล์ไว้ในโฟลเดอร์ Drive “Finance Backups” ทุกวันอาทิตย์ เก็บย้อนหลัง 12 ชุด</div>
        <div style="margin-bottom:10px">${bkText}</div>
        <button class="btn ghost" id="bnow">สำรองตอนนี้</button></div>`}
      <div class="card"><h2>ย้ายข้อมูลเก่าไปเก็บ</h2>
        <div class="muted" style="margin-bottom:10px">${api.local ? "ซ่อนรายการของปีที่เลือกไว้ในที่เก็บแยก (ยังอยู่ในเครื่องและในไฟล์สำรอง) ดึงกลับได้" : "ย้ายรายการของปีที่เลือกไปไว้ในไฟล์ “Archive-ปี” แยกต่างหาก ไม่ได้ลบทิ้ง เปิดดูหรือดึงกลับได้"}</div>
        ${years.map((y) => { const n = S.tx.filter((t) => t.date.startsWith(y)).length;
          return `<div class="brow" style="display:flex;justify-content:space-between;align-items:center"><div><b>ปี ${y}</b> <span class="muted">${n} รายการ</span></div>
          ${y === cur ? `<span class="muted">ปีปัจจุบัน</span>` : `<button class="btn ghost" data-arch="${y}" data-n="${n}" style="width:auto;padding:7px 12px">ย้ายไปเก็บ</button>`}</div>`; }).join("")}
        ${Object.keys(S.archives).length ? `<h2 style="margin-top:14px">ที่เก็บไว้แล้ว</h2>${Object.entries(S.archives).map(([y, n]) =>
          `<div class="brow" style="display:flex;justify-content:space-between;align-items:center"><div>Archive-${y} <span class="muted">${n} รายการ</span></div>
          <button class="btn ghost" data-rest="${y}" style="width:auto;padding:7px 12px">ดึงกลับ</button></div>`).join("")}` : ""}</div>`;
  };
  VIEWS.data.bind = () => {
    if ($("#bnow")) $("#bnow").onclick = async () => { S.backup = await api.backupNow(); toast("สำรองแล้ว"); render(); };
    if ($("#bexport")) {
      $("#bexport").onclick = exportBackup; $("#bcsv").onclick = exportCsv;
      $("#bimport").onclick = () => $("#bfile").click(); $("#bfile").onchange = (e) => importBackup(e.target);
    }
    view.querySelectorAll("[data-arch]").forEach((b) => b.onclick = async () => {
      const y = b.dataset.arch;
      if (!confirm(`ย้าย ${b.dataset.n} รายการของปี ${y} ไปไว้ในไฟล์ Archive-${y}?\nรายการจะหายจากแอป แต่ดึงกลับได้`)) return;
      const n = await api.archiveYear(y);
      S.tx = S.tx.filter((t) => !t.date.startsWith(y)); S.archives = await api.listArchives();
      toast(`ย้ายไปเก็บแล้ว ${n} รายการ`); render();
    });
    view.querySelectorAll("[data-rest]").forEach((b) => b.onclick = async () => {
      const n = await api.restoreYear(b.dataset.rest);
      S.tx = await api.listTransactions(); S.archives = await api.listArchives();
      toast(`ดึงกลับแล้ว ${n} รายการ`); render();
    });
  };

  // ---------- routing ----------
  const TITLES = { home: "หน้าหลัก", list: "รายการ", add: "เพิ่มรายการ", budget: "งบประมาณ", more: "เพิ่มเติม",
    plan: "วางแผน", portfolio: "พอร์ตการลงทุน", yearly: "สรุปรายปี", settings: "ตั้งค่า",
    recurring: "รายการประจำ", data: "จัดการข้อมูล" };
  const TAB_OF = { plan: "more", portfolio: "more", yearly: "more", settings: "more", recurring: "more", data: "more" };
  function go(v) { if (v !== "portfolio") pfEdit = gEdit = null; S.view = v; location.hash = v; render(); window.scrollTo(0, 0); }
  function render() {
    $("#title").textContent = TITLES[S.view];
    document.querySelectorAll(".tabbar [data-nav]").forEach((b) => b.classList.toggle("active", b.dataset.nav === (TAB_OF[S.view] || S.view)));
    view.innerHTML = VIEWS[S.view]();
    VIEWS[S.view].bind?.();
  }
  document.querySelectorAll(".tabbar [data-nav]").forEach((b) => b.onclick = () => go(b.dataset.nav));
  window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (VIEWS[h] && h !== S.view) { S.view = h; render(); } });

  // Theme: "auto" follows the phone's dark mode setting.
  const darkMQ = window.matchMedia("(prefers-color-scheme: dark)");
  function applyTheme() {
    const t = S.settings.theme || "auto";
    const dark = t === "dark" || (t === "auto" && darkMQ.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? "#121816" : "#0f766e";
  }
  darkMQ.addEventListener("change", applyTheme);

  async function loadAll() {
    let rec;
    [S.tx, S.cats, S.budgets, S.portfolio, S.settings, S.history, rec, S.archives, S.backup] = await Promise.all([
      api.listTransactions(), api.getCategories(), api.getBudgets(), api.getPortfolio(), api.getSettings(),
      api.getPortfolioHistory(), api.getRecurring(), api.listArchives(), api.getBackupInfo()]);
    S.recurring = rec.items; S.recDone = rec.done;
    applyTheme();
  }
  // Any failed call to the Sheet (no permission, script error, timeout) shows up as a toast instead of failing silently.
  window.addEventListener("unhandledrejection", (e) => {
    const m = (e.reason && e.reason.message) || String(e.reason || "");
    toast("บันทึกไม่สำเร็จ: " + m.slice(0, 80));
    if (view.querySelector(".loading")) view.innerHTML = `<div class="card empty">โหลดข้อมูลไม่สำเร็จ<br><small>${esc(m.slice(0, 200))}</small></div>`;
  });
  // Offline queue: new entries are kept on the phone and sent when the connection returns.
  if (!api.local) window.addEventListener("offline", () => { S.online = false; toast("ออฟไลน์ · บันทึกไว้ในเครื่องก่อน"); render(); });
  if (!api.local) window.addEventListener("online", async () => {
    S.online = true;
    const n = await api.syncPending();
    S.tx.forEach((t) => delete t.pending);
    if (n) toast(`ส่งเข้าชีตแล้ว ${n} รายการ`);
    render();
  });
  (async () => {
    view.innerHTML = `<div class="loading">กำลังโหลด…</div>`;
    await loadAll();
    S.ym = today().slice(0, 7);
    S.year = +S.ym.slice(0, 4);
    const h = location.hash.slice(1); if (VIEWS[h]) S.view = h;
    render();
  })();
})();
