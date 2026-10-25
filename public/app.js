(() => {
  const state = {
    month: new Date().toISOString().slice(0, 7), // 'YYYY-MM'
    users: [],
    budgetAmount: null,
    transactions: [],
    stores: [],
    identity: null,
  };

  const $ = (id) => document.getElementById(id);

  const monthLabelEl = $("monthLabel");
  const remainingEl = $("remainingAmount");
  const summarySubEl = $("summarySub");
  const summaryLabelEl = $("summaryLabel");
  const barFillEl = $("summaryBarFill");
  const editBudgetBtn = $("editBudgetBtn");

  const entryForm = $("entryForm");
  const txDate = $("txDate");
  const txDesc = $("txDesc");
  const txStore = $("txStore");
  const txUser = $("txUser");
  const txAmount = $("txAmount");
  const entryError = $("entryError");

  const ledgerList = $("ledgerList");
  const ledgerEmpty = $("ledgerEmpty");

  const storesList = $("storesList");
  const storesEmpty = $("storesEmpty");

  const togglePeopleBtn = $("togglePeople");
  const peoplePanel = $("peoplePanel");
  const peopleList = $("peopleList");
  const addPersonForm = $("addPersonForm");
  const newPersonName = $("newPersonName");

  const budgetBackdrop = $("budgetModalBackdrop");
  const budgetForm = $("budgetForm");
  const budgetAmountInput = $("budgetAmount");
  const cancelBudgetBtn = $("cancelBudgetBtn");

  const deleteBackdrop = $("deleteModalBackdrop");
  const deleteModalText = $("deleteModalText");
  const cancelDeleteBtn = $("cancelDeleteBtn");
  const confirmDeleteBtn = $("confirmDeleteBtn");

  const money = (n) =>
    (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const monthName = (ym) => {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  };

  async function api(path, options = {}) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    if (!res.ok) {
      let msg = "Something went wrong.";
      try {
        const body = await res.json();
        if (body.error) msg = body.error;
      } catch (_) {}
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  async function loadAll() {
    monthLabelEl.textContent = monthName(state.month);
    const [whoami, users, budget, transactions, stores] = await Promise.all([
      api("/api/whoami"),
      api("/api/users"),
      api(`/api/budget?month=${state.month}`),
      api(`/api/transactions?month=${state.month}`),
      api("/api/stores"),
    ]);
    state.identity = whoami.identity;
    state.users = users;
    state.budgetAmount = budget.amount;
    state.transactions = transactions;
    state.stores = stores;
    renderUsers();
    renderSummary();
    renderLedger();
    renderStores();
  }

  function renderUsers() {
    txUser.innerHTML = "";
    if (state.users.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "Add a person below first";
      opt.disabled = true;
      opt.selected = true;
      txUser.appendChild(opt);
    } else {
      for (const u of state.users) {
        const opt = document.createElement("option");
        opt.value = u.name;
        opt.textContent = u.name;
        txUser.appendChild(opt);
      }
    }

    peopleList.innerHTML = "";
    for (const u of state.users) {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.textContent = u.name;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "\u2715";
      btn.setAttribute("aria-label", `Remove ${u.name}`);
      btn.addEventListener("click", async () => {
        await api(`/api/users/${u.id}`, { method: "DELETE" });
        await loadAll();
      });
      li.appendChild(span);
      li.appendChild(btn);
      peopleList.appendChild(li);
    }

    // If Cloudflare Access identity is present, hint it but still let the
    // person pick who they're logging for (e.g. shared family device).
    if (state.identity) {
      const match = state.users.find((u) => u.name === state.identity);
      if (match) txUser.value = match.name;
    }
  }

  function renderSummary() {
    const spent = state.transactions.reduce((sum, t) => sum + t.amount, 0);
    const hasBudget = state.budgetAmount !== null;
    const budget = hasBudget ? state.budgetAmount : 0;
    const remaining = budget - spent;

    if (!hasBudget) {
      summaryLabelEl.textContent = "No budget set for this month";
      remainingEl.textContent = money(-spent) === money(0) ? "$0.00" : money(-spent);
      remainingEl.className = "summary-number";
      summarySubEl.textContent = `${money(spent)} logged so far`;
      barFillEl.style.width = "0%";
      barFillEl.className = "summary-bar-fill";
      editBudgetBtn.textContent = "Set budget for this month";
      return;
    }

    summaryLabelEl.textContent = "Remaining this month";
    remainingEl.textContent = money(remaining);
    remainingEl.className = "summary-number " + (remaining < 0 ? "status-over" : "status-good");
    summarySubEl.textContent = `${money(spent)} of ${money(budget)} budget`;

    const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 100;
    barFillEl.style.width = `${pct}%`;
    barFillEl.className = "summary-bar-fill " + (remaining < 0 ? "status-over" : "");
    editBudgetBtn.textContent = "Edit budget for this month";
  }

  function renderLedger() {
    ledgerList.innerHTML = "";
    ledgerEmpty.hidden = state.transactions.length > 0;

    for (const t of state.transactions) {
      const li = document.createElement("li");
      li.className = "ledger-row";

      const dateEl = document.createElement("div");
      dateEl.className = "row-date";
      const d = new Date(t.date + "T00:00:00");
      dateEl.textContent = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });

      const descWrap = document.createElement("div");
      descWrap.className = "row-desc";
      const descText = document.createElement("span");
      descText.className = "desc-text" + (t.description ? "" : " desc-empty");
      descText.textContent = t.description || "No description";
      const userText = document.createElement("span");
      userText.className = "row-user";
      userText.textContent = t.user;
      descWrap.appendChild(descText);
      if (t.store) {
        const storeText = document.createElement("span");
        storeText.className = "row-store";
        storeText.textContent = t.store;
        descWrap.appendChild(storeText);
      }
      descWrap.appendChild(userText);

      const amountEl = document.createElement("div");
      amountEl.className = "row-amount" + (t.amount < 0 ? " negative" : "");
      amountEl.textContent = money(t.amount);

      const delBtn = document.createElement("button");
      delBtn.className = "row-delete";
      delBtn.type = "button";
      delBtn.textContent = "\u2715";
      delBtn.setAttribute("aria-label", "Delete transaction");
      delBtn.addEventListener("click", () => {
        pendingDeleteId = t.id;
        deleteModalText.textContent = entrySummary(t);
        deleteBackdrop.hidden = false;
        cancelDeleteBtn.focus();
      });

      li.appendChild(dateEl);
      li.appendChild(descWrap);
      li.appendChild(amountEl);
      li.appendChild(delBtn);
      ledgerList.appendChild(li);
    }
  }

  function renderStores() {
    if (state.transactions.length === 0) {
      storesEmpty.hidden = false;
      storesList.innerHTML = "";
      return;
    }
    storesEmpty.hidden = true;

    const groups = new Map();
    for (const t of state.transactions) {
      const raw = t.store ? t.store.trim() : "";
      const key = raw ? raw.toLowerCase() : "";
      let g = groups.get(key);
      if (!g) {
        g = { total: 0, label: raw || "No store" };
        groups.set(key, g);
      }
      g.total += t.amount;
    }

    for (const [key, g] of groups) {
      if (key === "") continue;
      const curated = state.stores.find((s) => s.store.toLowerCase() === key);
      if (curated) g.label = curated.store;
    }

    const rows = [...groups.values()].sort(
      (a, b) => b.total - a.total || a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
    );

    storesList.innerHTML = "";
    for (const g of rows) {
      const li = document.createElement("li");
      li.className = "store-row";
      const nameEl = document.createElement("span");
      nameEl.className = "store-name";
      nameEl.textContent = g.label;
      const amountEl = document.createElement("span");
      amountEl.className = "store-amount";
      amountEl.textContent = money(g.total);
      li.appendChild(nameEl);
      li.appendChild(amountEl);
      storesList.appendChild(li);
    }
  }

  // Month navigation
  function shiftMonth(delta) {
    const [y, m] = state.month.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    state.month = d.toISOString().slice(0, 7);
    loadAll().catch(showEntryError);
  }
  $("prevMonth").addEventListener("click", () => shiftMonth(-1));
  $("nextMonth").addEventListener("click", () => shiftMonth(1));

  // Add transaction
  txDate.valueAsDate = new Date();

  function showEntryError(err) {
    entryError.textContent = err.message || "Something went wrong.";
  }

  const storeSuggest = $("storeSuggest");
  let storeSuggestIndex = -1; // highlighted option, -1 = none

  function storeCandidates(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const matches = state.stores.filter((s) => s.store.toLowerCase().includes(q));
    matches.sort((a, b) => {
      const pa = a.store.toLowerCase().startsWith(q) ? 0 : 1;
      const pb = b.store.toLowerCase().startsWith(q) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      if (a.last !== b.last) return a.last < b.last ? 1 : -1; // most recent first
      return a.store.localeCompare(b.store, undefined, { sensitivity: "base" });
    });
    return matches.slice(0, 8);
  }

  function renderStoreSuggestions() {
    storeSuggestIndex = -1;
    const candidates = storeCandidates(txStore.value);
    storeSuggest.innerHTML = "";
    if (candidates.length === 0) {
      storeSuggest.hidden = true;
      return;
    }
    for (const c of candidates) {
      const li = document.createElement("li");
      li.textContent = c.store;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");
      li.addEventListener("mousedown", (e) => e.preventDefault());
      li.addEventListener("click", () => acceptStoreSuggestion(c.store));
      storeSuggest.appendChild(li);
    }
    storeSuggest.hidden = false;
  }

  function closeStoreSuggestions() {
    storeSuggest.hidden = true;
    storeSuggestIndex = -1;
  }

  function acceptStoreSuggestion(store) {
    txStore.value = store;
    closeStoreSuggestions();
    txStore.focus();
  }

  function setStoreSuggestHighlight(i) {
    const lis = storeSuggest.querySelectorAll("li");
    storeSuggestIndex = i;
    lis.forEach((li, j) => {
      li.classList.toggle("active", j === i);
      li.setAttribute("aria-selected", j === i ? "true" : "false");
    });
  }

  txStore.addEventListener("input", () => renderStoreSuggestions());
  txStore.addEventListener("keydown", (e) => {
    const open = !storeSuggest.hidden;
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && open) {
      e.preventDefault();
      const lis = storeSuggest.querySelectorAll("li");
      const n = lis.length;
      if (n === 0) return;
      const cur = storeSuggestIndex < 0 ? -1 : storeSuggestIndex;
      setStoreSuggestHighlight(e.key === "ArrowDown" ? (cur + 1) % n : (cur - 1 + n) % n);
    } else if (e.key === "Enter") {
      if (open && storeSuggestIndex >= 0) {
        e.preventDefault();
        acceptStoreSuggestion(storeSuggest.querySelectorAll("li")[storeSuggestIndex].textContent);
      }
    } else if (e.key === "Escape" || e.key === "Tab") {
      closeStoreSuggestions();
    }
  });

  entryForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    entryError.textContent = "";
    if (!txUser.value) {
      showEntryError(new Error("Add a person before logging a transaction."));
      return;
    }
    try {
      const store = txStore.value.trim();
      if (store && !state.stores.some((s) => s.store.toLowerCase() === store.toLowerCase())) {
        const addIt = window.confirm(
          "The store you entered does not currently exist, would you like to add it?"
        );
        if (!addIt) return; // cancel the entry: nothing saved, form left as-is
        await api("/api/stores", { method: "POST", body: JSON.stringify({ name: store }) });
      }
      await api("/api/transactions", {
        method: "POST",
        body: JSON.stringify({
          amount: Number(txAmount.value),
          date: txDate.value,
          description: txDesc.value,
          store: txStore.value,
          user: txUser.value,
        }),
      });
      txDesc.value = "";
      txStore.value = "";
      closeStoreSuggestions();
      txAmount.value = "";
      txDesc.focus();
      await loadAll();
    } catch (err) {
      showEntryError(err);
    }
  });

  // Manage people
  togglePeopleBtn.addEventListener("click", () => {
    peoplePanel.hidden = !peoplePanel.hidden;
    togglePeopleBtn.textContent = peoplePanel.hidden ? "Manage people" : "Hide people";
  });

  addPersonForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = newPersonName.value.trim();
    if (!name) return;
    try {
      await api("/api/users", { method: "POST", body: JSON.stringify({ name }) });
      newPersonName.value = "";
      await loadAll();
    } catch (err) {
      alert(err.message);
    }
  });

  // Budget modal
  editBudgetBtn.addEventListener("click", () => {
    budgetAmountInput.value = state.budgetAmount !== null ? state.budgetAmount : "";
    budgetBackdrop.hidden = false;
    budgetAmountInput.focus();
  });
  cancelBudgetBtn.addEventListener("click", () => {
    budgetBackdrop.hidden = true;
  });
  budgetBackdrop.addEventListener("click", (e) => {
    if (e.target === budgetBackdrop) budgetBackdrop.hidden = true;
  });
  budgetForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api("/api/budget", {
        method: "POST",
        body: JSON.stringify({ month: state.month, amount: Number(budgetAmountInput.value) }),
      });
      budgetBackdrop.hidden = true;
      await loadAll();
    } catch (err) {
      alert(err.message);
    }
  });

  // Delete confirmation modal
  let pendingDeleteId = null;

  const entrySummary = (t) => {
    const when = new Date(t.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const parts = [when];
    if (t.store) parts.push(t.store);
    if (t.description) parts.push(t.description);
    parts.push(`${money(t.amount)} (${t.user})`);
    return parts.join(" · ");
  };

  cancelDeleteBtn.addEventListener("click", () => {
    pendingDeleteId = null;
    deleteBackdrop.hidden = true;
  });
  deleteBackdrop.addEventListener("click", (e) => {
    if (e.target === deleteBackdrop) {
      pendingDeleteId = null;
      deleteBackdrop.hidden = true;
    }
  });
  confirmDeleteBtn.addEventListener("click", async () => {
    const id = pendingDeleteId;
    pendingDeleteId = null;
    deleteBackdrop.hidden = true;
    try {
      await api(`/api/transactions/${id}`, { method: "DELETE" });
      await loadAll();
    } catch (err) {
      alert(err.message);
    }
  });

  loadAll().catch(showEntryError);
})();
