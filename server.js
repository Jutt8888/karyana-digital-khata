const express = require('express');
const cors = require('cors');
const db = require('./db');
const PORT = process.env.PORT || 3000;

// Migration check: Auto-add 'cleared' column for existing SQLite databases
try {
  db.prepare('ALTER TABLE transactions ADD COLUMN cleared INTEGER DEFAULT 0').run();
  console.log('Database migration: Added missing "cleared" column.');
} catch (err) {
  if (!err.message.includes('duplicate column name')) {
    console.error('Migration notice:', err.message);
  }
}

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Helper Function: Recalculate customer balance dynamically from active transactions
function syncCustomerBalance(customerId) {
  const result = db.prepare(`
    SELECT COALESCE(SUM(
      CASE 
        WHEN cleared = 1 THEN 0
        WHEN type = 'GAVE' THEN amount 
        ELSE -amount 
      END
    ), 0) AS newBalance
    FROM transactions 
    WHERE customer_id = ?
  `).get(customerId);

  db.prepare('UPDATE customers SET balance = ? WHERE id = ?').run(result.newBalance, customerId);
}

// 1. Get all customers
app.get('/api/customers', (req, res) => {
  try {
    const customers = db.prepare('SELECT * FROM customers ORDER BY name ASC').all();
    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Add a customer
app.post('/api/customers', (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name) return res.status(400).json({ error: 'Customer name is required' });

    const stmt = db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)');
    const info = stmt.run(name, phone || '');

    res.json({ id: info.lastInsertRowid, name, phone, balance: 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Edit customer details
app.put('/api/customers/:id', (req, res) => {
  try {
    const { name, phone } = req.body;
    const { id } = req.params;

    if (!name) return res.status(400).json({ error: 'Customer name is required' });

    const stmt = db.prepare('UPDATE customers SET name = ?, phone = ? WHERE id = ?');
    const info = stmt.run(name, phone || '', id);

    if (info.changes === 0) return res.status(404).json({ error: 'Customer not found' });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Delete customer and transactions
app.delete('/api/customers/:id', (req, res) => {
  try {
    const { id } = req.params;

    const deleteCust = db.prepare('DELETE FROM customers WHERE id = ?');
    const info = deleteCust.run(id);

    if (info.changes === 0) return res.status(404).json({ error: 'Customer not found' });

    res.json({ success: true, message: 'Customer and history deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Get transactions for a customer
app.get('/api/customers/:id/transactions', (req, res) => {
  try {
    const history = db.prepare(
      'SELECT * FROM transactions WHERE customer_id = ? ORDER BY created_at DESC'
    ).all(req.params.id);

    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Record transaction
app.post('/api/transactions', (req, res) => {
  try {
    const { customer_id, type, amount, details, created_at, cleared } = req.body;

    if (!customer_id || !type || !amount) {
      return res.status(400).json({ error: 'Missing customer_id, type, or amount' });
    }

    const txDate = created_at ? new Date(created_at).toISOString() : new Date().toISOString();
    const isCleared = cleared ? 1 : 0;

    const insertTx = db.prepare(
      'INSERT INTO transactions (customer_id, type, amount, details, created_at, cleared) VALUES (?, ?, ?, ?, ?, ?)'
    );

    const runTx = db.transaction(() => {
      insertTx.run(customer_id, type, Number(amount), details || '', txDate, isCleared);
      syncCustomerBalance(customer_id);
    });

    runTx();

    res.json({ success: true, created_at: txDate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Edit transaction (Supports status clear toggling and automated balance calculation)
app.put('/api/transactions/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { type, amount, details, created_at, cleared } = req.body;

    const oldTx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
    if (!oldTx) return res.status(404).json({ error: 'Transaction not found' });

    const newType = type !== undefined ? type : oldTx.type;
    const newAmount = amount !== undefined ? Number(amount) : oldTx.amount;
    const newDetails = details !== undefined ? details : (oldTx.details || '');
    const txDate = created_at ? new Date(created_at).toISOString() : oldTx.created_at;
    const newCleared = cleared !== undefined ? (cleared ? 1 : 0) : (oldTx.cleared || 0);

    const updateTx = db.prepare(
      'UPDATE transactions SET type = ?, amount = ?, details = ?, created_at = ?, cleared = ? WHERE id = ?'
    );

    const runEdit = db.transaction(() => {
      updateTx.run(newType, newAmount, newDetails, txDate, newCleared, id);
      syncCustomerBalance(oldTx.customer_id);
    });

    runEdit();

    res.json({ success: true, updated_at: txDate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Delete transaction
app.delete('/api/transactions/:id', (req, res) => {
  try {
    const { id } = req.params;

    const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });

    const deleteTx = db.prepare('DELETE FROM transactions WHERE id = ?');

    const runDeleteTx = db.transaction(() => {
      deleteTx.run(id);
      syncCustomerBalance(tx.customer_id);
    });

    runDeleteTx();

    res.json({ success: true, message: 'Transaction deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Shop Ledger running on port ${PORT}`);
});

module.exports = app;
