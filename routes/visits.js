const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// GET /api/visits — list visits (optionally filtered)
router.get('/', (req, res) => {
  const db = getDb();
  const { customer_id, date, active } = req.query;

  let sql = `
    SELECT v.*, c.name AS customer_name, c.phone AS customer_phone,
           s.name AS service_name, t.name AS technician_name
    FROM visits v
    JOIN customers c ON v.customer_id = c.id
    LEFT JOIN services s ON v.service_id = s.id
    LEFT JOIN technicians t ON v.technician_id = t.id
    WHERE 1=1
  `;
  const params = [];

  if (customer_id) { sql += ' AND v.customer_id = ?'; params.push(customer_id); }
  if (date) { sql += ' AND DATE(v.checked_in_at) = ?'; params.push(date); }
  if (active === 'true') { sql += ' AND v.checked_out_at IS NULL'; }

  sql += ' ORDER BY v.checked_in_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/visits/current — currently checked-in customers
router.get('/current', (req, res) => {
  const db = getDb();
  const current = db.prepare(`
    SELECT v.*, c.name AS customer_name, c.phone AS customer_phone,
           s.name AS service_name, t.name AS technician_name
    FROM visits v
    JOIN customers c ON v.customer_id = c.id
    LEFT JOIN services s ON v.service_id = s.id
    LEFT JOIN technicians t ON v.technician_id = t.id
    WHERE v.checked_out_at IS NULL
    ORDER BY v.checked_in_at ASC
  `).all();
  res.json(current);
});

// POST /api/visits/checkin — check a customer in
router.post('/checkin', (req, res) => {
  const db = getDb();
  const { customer_id, appointment_id, service_id, technician_id, notes } = req.body;

  if (!customer_id) return res.status(400).json({ error: 'customer_id is required' });

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  // Warn if customer is flagged
  const flagWarning = customer.is_flagged
    ? { warning: 'Customer is flagged', flag_reason: customer.flag_reason }
    : null;

  // If linked to an appointment, update its status
  if (appointment_id) {
    const appt = db.prepare('SELECT id FROM appointments WHERE id = ?').get(appointment_id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });
    db.prepare("UPDATE appointments SET status = 'checked_in' WHERE id = ?").run(appointment_id);
  }

  const result = db.prepare(`
    INSERT INTO visits (customer_id, appointment_id, service_id, technician_id, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    customer_id,
    appointment_id || null,
    service_id || null,
    technician_id || null,
    notes || null
  );

  const visit = db.prepare(`
    SELECT v.*, c.name AS customer_name, s.name AS service_name, t.name AS technician_name
    FROM visits v
    JOIN customers c ON v.customer_id = c.id
    LEFT JOIN services s ON v.service_id = s.id
    LEFT JOIN technicians t ON v.technician_id = t.id
    WHERE v.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json({ visit, ...(flagWarning || {}) });
});

// PUT /api/visits/:id/checkout — check a customer out
router.put('/:id/checkout', (req, res) => {
  const db = getDb();
  const visit = db.prepare('SELECT * FROM visits WHERE id = ?').get(req.params.id);
  if (!visit) return res.status(404).json({ error: 'Visit not found' });
  if (visit.checked_out_at) return res.status(400).json({ error: 'Customer already checked out' });

  const { total_amount, notes, service_id, technician_id } = req.body;

  // Calculate points earned: 1 point per dollar spent (rounded down)
  const amount = total_amount !== undefined ? Number(total_amount) : null;
  const pointsEarned = amount ? Math.floor(amount) : 0;

  db.prepare(`
    UPDATE visits
    SET checked_out_at = CURRENT_TIMESTAMP,
        total_amount = COALESCE(?, total_amount),
        points_earned = ?,
        notes = COALESCE(?, notes),
        service_id = COALESCE(?, service_id),
        technician_id = COALESCE(?, technician_id)
    WHERE id = ?
  `).run(amount, pointsEarned, notes || null, service_id || null, technician_id || null, req.params.id);

  // Update customer's points and last_visit
  if (pointsEarned > 0) {
    db.prepare('UPDATE customers SET points = points + ?, last_visit = CURRENT_TIMESTAMP WHERE id = ?')
      .run(pointsEarned, visit.customer_id);
  } else {
    db.prepare('UPDATE customers SET last_visit = CURRENT_TIMESTAMP WHERE id = ?')
      .run(visit.customer_id);
  }

  // If linked to an appointment, mark it completed
  if (visit.appointment_id) {
    db.prepare("UPDATE appointments SET status = 'completed' WHERE id = ?").run(visit.appointment_id);
  }

  const updated = db.prepare(`
    SELECT v.*, c.name AS customer_name, s.name AS service_name, t.name AS technician_name
    FROM visits v
    JOIN customers c ON v.customer_id = c.id
    LEFT JOIN services s ON v.service_id = s.id
    LEFT JOIN technicians t ON v.technician_id = t.id
    WHERE v.id = ?
  `).get(req.params.id);

  res.json({ visit: updated, points_earned: pointsEarned });
});

// GET /api/visits/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const visit = db.prepare(`
    SELECT v.*, c.name AS customer_name, c.phone AS customer_phone,
           s.name AS service_name, t.name AS technician_name
    FROM visits v
    JOIN customers c ON v.customer_id = c.id
    LEFT JOIN services s ON v.service_id = s.id
    LEFT JOIN technicians t ON v.technician_id = t.id
    WHERE v.id = ?
  `).get(req.params.id);

  if (!visit) return res.status(404).json({ error: 'Visit not found' });
  res.json(visit);
});

module.exports = router;
