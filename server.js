const path = require("path");
const fs = require("fs");
const express = require("express");
const Database = require("better-sqlite3");

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "budget.db");

// Identity header injected by Cloudflare Access (or any upstream proxy).
// Falls back to the user picked in the request body if the header isn't present,
// which keeps the app usable in local/dev environments without Access in front of it.
const IDENTITY_HEADER = process.env.IDENTITY_HEADER || "Cf-Access-Authenticated-User-Email";

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const hadStoresTable = !!db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='stores'"
).get();

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS budgets (
    month TEXT PRIMARY KEY,        -- 'YYYY-MM'
    amount REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,          -- positive = spent, negative = refund/income
    date TEXT NOT NULL,            -- 'YYYY-MM-DD'
    description TEXT NOT NULL DEFAULT '',
    store TEXT NOT NULL DEFAULT '',
    user_name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
  );
`);
// Migrate databases created before the store column existed.
const txColumns = db.prepare("PRAGMA table_info(transactions)").all().map((c) => c.name);
if (!txColumns.includes("store")) {
  db.exec("ALTER TABLE transactions ADD COLUMN store TEXT NOT NULL DEFAULT ''");
}
// One-time backfill: seed the new table from existing transactions so current
// stores keep working in autocomplete. Skipped when the table already existed,
// so a store the user declined is never resurrected by a later restart.
if (!hadStoresTable) {
  db.exec(`INSERT OR IGNORE INTO stores (name)
    SELECT store FROM (
      SELECT store, ROW_NUMBER() OVER (PARTITION BY lower(store) ORDER BY date DESC, id DESC) AS rn
      FROM transactions WHERE store != ''
    ) WHERE rn = 1`);
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function isValidMonth(m) {
  return typeof m === "string" && /^\d{4}-\d{2}$/.test(m);
}

function isValidDate(d) {
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

// Middleware: figure out who the caller is. Prefers the Cloudflare Access
// identity header; falls back to a name supplied by the client.
function resolveIdentity(req, res, next) {
  req.accessIdentity = req.get(IDENTITY_HEADER) || null;
  next();
}
app.use(resolveIdentity);

// ---------- Users ----------

app.get("/api/users", (req, res) => {
  const users = db.prepare("SELECT id, name FROM users ORDER BY name COLLATE NOCASE").all();
  res.json(users);
});

app.post("/api/users", (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Name is required." });
  if (name.length > 60) return res.status(400).json({ error: "Name is too long." });
  try {
    db.prepare("INSERT INTO users (name) VALUES (?)").run(name);
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "That name is already in the list." });
    }
    return res.status(500).json({ error: "Could not add user." });
  }
  const users = db.prepare("SELECT id, name FROM users ORDER BY name COLLATE NOCASE").all();
  res.status(201).json(users);
});

app.delete("/api/users/:id", (req, res) => {
  db.prepare("DELETE FROM users WHERE id = ?").run(req.params.id);
  const users = db.prepare("SELECT id, name FROM users ORDER BY name COLLATE NOCASE").all();
  res.json(users);
});

// ---------- Budgets ----------

app.get("/api/budget", (req, res) => {
  const month = isValidMonth(req.query.month) ? req.query.month : currentMonth();
  const row = db.prepare("SELECT amount FROM budgets WHERE month = ?").get(month);
  res.json({ month, amount: row ? row.amount : null });
});

app.post("/api/budget", (req, res) => {
  const month = req.body.month;
  const amount = Number(req.body.amount);
  if (!isValidMonth(month)) return res.status(400).json({ error: "Invalid month." });
  if (!Number.isFinite(amount) || amount < 0) {
    return res.status(400).json({ error: "Budget amount must be a positive number." });
  }
  db.prepare(
    `INSERT INTO budgets (month, amount) VALUES (?, ?)
     ON CONFLICT(month) DO UPDATE SET amount = excluded.amount`
  ).run(month, amount);
  res.json({ month, amount });
});

// ---------- Transactions ----------

app.get("/api/transactions", (req, res) => {
  const month = isValidMonth(req.query.month) ? req.query.month : currentMonth();
  const rows = db
    .prepare(
      `SELECT id, amount, date, description, store, user_name AS user, created_at
       FROM transactions
       WHERE substr(date, 1, 7) = ?
       ORDER BY date DESC, id DESC`
    )
    .all(month);
  res.json(rows);
});

app.get("/api/stores", (req, res) => {
  const rows = db
    .prepare(
      `SELECT s.name AS store, COALESCE(MAX(t.date), '') AS last
       FROM stores s
       LEFT JOIN transactions t ON lower(t.store) = lower(s.name)
       GROUP BY s.id
       ORDER BY last DESC, store COLLATE NOCASE`
    )
    .all();
  res.json(rows);
});

app.post("/api/stores", (req, res) => {
  const name = (req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Store name is required." });
  if (name.length > 200) return res.status(400).json({ error: "Store name is too long." });
  const existing = db.prepare("SELECT id, name FROM stores WHERE name = ?").get(name);
  if (existing) return res.json(existing); // 200 — already known (case-insensitive via column collation)
  try {
    const info = db.prepare("INSERT INTO stores (name) VALUES (?)").run(name);
    res.status(201).json({ id: info.lastInsertRowid, name });
  } catch (e) {
    if (String(e.message).includes("UNIQUE")) {
      return res.json(db.prepare("SELECT id, name FROM stores WHERE name = ?").get(name));
    }
    return res.status(500).json({ error: "Could not add store." });
  }
});

app.post("/api/transactions", (req, res) => {
  const amount = Number(req.body.amount);
  const date = req.body.date;
  const description = (req.body.description || "").trim();
  const store = (req.body.store || "").trim();
  // Prefer the verified Cloudflare Access identity if present; otherwise trust
  // the picked name from the dropdown (dev / no-Access setups).
  const user = (req.accessIdentity || req.body.user || "").trim();

  if (!Number.isFinite(amount) || amount === 0) {
    return res.status(400).json({ error: "Amount must be a non-zero number." });
  }
  if (!isValidDate(date)) return res.status(400).json({ error: "Invalid date." });
  if (!user) return res.status(400).json({ error: "A user is required." });
  if (description.length > 200) return res.status(400).json({ error: "Description is too long." });
  if (store.length > 200) return res.status(400).json({ error: "Store is too long." });

  const info = db
    .prepare(
      `INSERT INTO transactions (amount, date, description, store, user_name)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(amount, date, description, store, user);

  const row = db
    .prepare(
      `SELECT id, amount, date, description, store, user_name AS user, created_at
       FROM transactions WHERE id = ?`
    )
    .get(info.lastInsertRowid);
  res.status(201).json(row);
});

app.delete("/api/transactions/:id", (req, res) => {
  db.prepare("DELETE FROM transactions WHERE id = ?").run(req.params.id);
  res.status(204).end();
});

app.get("/api/whoami", (req, res) => {
  res.json({ identity: req.accessIdentity });
});

app.listen(PORT, () => {
  console.log(`Budget tracker listening on port ${PORT}`);
});
