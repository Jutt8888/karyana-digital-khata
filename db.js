const Database = require('better-sqlite3');
const db = new Database('ledger.db');

// Enable foreign key constraints
db.pragma('foreign_keys = ON');

// Initialize schema with cascade delete support and cleared column
db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    balance REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    amount REAL NOT NULL,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    cleared INTEGER DEFAULT 0,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
  );
`);

module.exports = db;