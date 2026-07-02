const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// GET /api/customers  — list all or search by name, phone, preferred_technician_id
router.get('/', (req, res) => {
  const db = getDb();
  const { q, phone, technician_id, flagged } = req.query;

  let sql = `
    SELECT c.*, t.name AS preferred_technician_name
    FROM customers c
    LEFT JOIN technicians t ON c.preferred_technician_id = t.id
    WHERE 1=1
  `;
  const params = [];

  if (q) {
    sql += ' AND (c.name LIKE ? OR c.phone LIKE ?)';
    params.push(`%${q}%`, `%${q}%`);
  }
  if (phone) {
    sql += ' AND c.phone LIKE ?';
    params.push(`%${phone}%`);
  }
  if (technician_id) {
    sql += ' AND c.preferred_technician_id = ?';
    params.push(technician_id);
  }
  if (flagged !== undefined) {
    sql += ' AND c.is_flagged = ?';
    params.push(flagged === 'true' || flagged === '1' ? 1 : 0);
  }

  sql += ' ORDER BY c.name ASC';

  const customers = db.prepare(sql).all(...params);
  res.json(customers);
});

// GET /api/customers/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const customer = db.prepare(`
    SELECT c.*, t.name AS preferred_technician_name
    FROM customers c
    LEFT JOIN technicians t ON c.preferred_technician_id = t.id
    WHERE c.id = ?
  `).get(req.params.id);

  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  res.json(customer);
});

// POST /api/customers
router.post('/', (req, res) => {
  const db = getDb();
  const { name, phone, email, preferred_technician_id, notes } = req.body;

  if (!name || !phone) {
    return res.status(400).json({ error: 'name and phone are required' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO customers (name, phone, email, preferred_technician_id, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, phone, email || null, preferred_technician_id || null, notes || null);

    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(customer);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'A customer with that phone number already exists' });
    }
    throw err;
  }
});

// PUT /api/customers/:id
router.put('/:id', (req, res) => {
  const db = getDb();
  const { name, phone, email, preferred_technician_id, notes } = req.body;

  const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  try {
    db.prepare(`
      UPDATE customers
      SET name = COALESCE(?, name),
          phone = COALESCE(?, phone),
          email = COALESCE(?, email),
          preferred_technician_id = COALESCE(?, preferred_technician_id),
          notes = COALESCE(?, notes)
      WHERE id = ?
    `).run(name || null, phone || null, email || null, preferred_technician_id || null, notes || null, req.params.id);

    const updated = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(409).json({ error: 'A customer with that phone number already exists' });
    }
    throw err;
  }
});

// DELETE /api/customers/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id);
  res.json({ message: 'Customer deleted' });
});

// POST /api/customers/:id/flag — flag a customer
router.post('/:id/flag', (req, res) => {
  const db = getDb();
  const { reason } = req.body;

  const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  db.prepare('UPDATE customers SET is_flagged = 1, flag_reason = ? WHERE id = ?')
    .run(reason || 'Non-compliant', req.params.id);

  res.json({ message: 'Customer flagged', flag_reason: reason || 'Non-compliant' });
});

// POST /api/customers/:id/unflag — remove flag
router.post('/:id/unflag', (req, res) => {
  const db = getDb();
  const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  db.prepare('UPDATE customers SET is_flagged = 0, flag_reason = NULL WHERE id = ?').run(req.params.id);
  res.json({ message: 'Customer flag removed' });
});

// POST /api/customers/:id/points — add or subtract points
router.post('/:id/points', (req, res) => {
  const db = getDb();
  const { delta, reason } = req.body;

  if (delta === undefined) return res.status(400).json({ error: 'delta is required' });

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const newPoints = Math.max(0, (customer.points || 0) + Number(delta));
  db.prepare('UPDATE customers SET points = ? WHERE id = ?').run(newPoints, req.params.id);

  res.json({ message: 'Points updated', points: newPoints, delta, reason: reason || null });
});

// GET /api/customers/:id/visits — visit history
router.get('/:id/visits', (req, res) => {
  const db = getDb();
  const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const visits = db.prepare(`
    SELECT v.*, s.name AS service_name, t.name AS technician_name
    FROM visits v
    LEFT JOIN services s ON v.service_id = s.id
    LEFT JOIN technicians t ON v.technician_id = t.id
    WHERE v.customer_id = ?
    ORDER BY v.checked_in_at DESC
  `).all(req.params.id);

  res.json(visits);
});

// GET /api/customers/:id/promotions — promotions assigned to a customer
router.get('/:id/promotions', (req, res) => {
  const db = getDb();
  const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const promos = db.prepare(`
    SELECT cp.*, p.name, p.description, p.discount_percent, p.discount_amount, p.points_required, p.valid_until
    FROM customer_promotions cp
    JOIN promotions p ON cp.promotion_id = p.id
    WHERE cp.customer_id = ?
    ORDER BY cp.assigned_at DESC
  `).all(req.params.id);

  res.json(promos);
});

// POST /api/customers/:id/promotions — assign a promotion
router.post('/:id/promotions', (req, res) => {
  const db = getDb();
  const { promotion_id } = req.body;
  if (!promotion_id) return res.status(400).json({ error: 'promotion_id is required' });

  const customer = db.prepare('SELECT id, points FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const promo = db.prepare('SELECT * FROM promotions WHERE id = ? AND is_active = 1').get(promotion_id);
  if (!promo) return res.status(404).json({ error: 'Promotion not found or inactive' });

  if (promo.points_required > 0 && customer.points < promo.points_required) {
    return res.status(400).json({
      error: `Insufficient points. Required: ${promo.points_required}, available: ${customer.points}`
    });
  }

  const existing = db.prepare(
    'SELECT id FROM customer_promotions WHERE customer_id = ? AND promotion_id = ? AND used_at IS NULL'
  ).get(req.params.id, promotion_id);
  if (existing) return res.status(409).json({ error: 'Promotion already assigned and unused' });

  db.prepare(
    'INSERT INTO customer_promotions (customer_id, promotion_id) VALUES (?, ?)'
  ).run(req.params.id, promotion_id);

  res.status(201).json({ message: 'Promotion assigned' });
});

// GET /api/customers/:id/stats — individual customer statistics
router.get('/:id/stats', (req, res) => {
  const db = getDb();
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const totalVisits = db.prepare('SELECT COUNT(*) as count FROM visits WHERE customer_id = ?').get(req.params.id);
  const totalSpent = db.prepare(
    'SELECT COALESCE(SUM(total_amount), 0) as total FROM visits WHERE customer_id = ? AND total_amount IS NOT NULL'
  ).get(req.params.id);
  const lastVisit = db.prepare(
    'SELECT checked_in_at FROM visits WHERE customer_id = ? ORDER BY checked_in_at DESC LIMIT 1'
  ).get(req.params.id);
  const favService = db.prepare(`
    SELECT s.name, COUNT(*) as count
    FROM visits v
    JOIN services s ON v.service_id = s.id
    WHERE v.customer_id = ?
    GROUP BY v.service_id
    ORDER BY count DESC
    LIMIT 1
  `).get(req.params.id);

  res.json({
    customer_id: Number(req.params.id),
    total_visits: totalVisits.count,
    total_spent: totalSpent.total,
    points: customer.points,
    last_visit: lastVisit ? lastVisit.checked_in_at : null,
    favorite_service: favService ? favService.name : null
  });
});

module.exports = router;
