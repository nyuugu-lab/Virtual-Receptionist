const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// GET /api/technicians
router.get('/', (req, res) => {
  const db = getDb();
  const { active } = req.query;
  let sql = 'SELECT * FROM technicians';
  const params = [];

  if (active !== undefined) {
    sql += ' WHERE is_active = ?';
    params.push(active === 'false' || active === '0' ? 0 : 1);
  }
  sql += ' ORDER BY name ASC';

  const technicians = db.prepare(sql).all(...params);
  res.json(technicians);
});

// GET /api/technicians/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const tech = db.prepare('SELECT * FROM technicians WHERE id = ?').get(req.params.id);
  if (!tech) return res.status(404).json({ error: 'Technician not found' });
  res.json(tech);
});

// POST /api/technicians
router.post('/', (req, res) => {
  const db = getDb();
  const { name, phone, specialties } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const result = db.prepare(
    'INSERT INTO technicians (name, phone, specialties) VALUES (?, ?, ?)'
  ).run(name, phone || null, JSON.stringify(specialties || []));

  const tech = db.prepare('SELECT * FROM technicians WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(tech);
});

// PUT /api/technicians/:id
router.put('/:id', (req, res) => {
  const db = getDb();
  const tech = db.prepare('SELECT id FROM technicians WHERE id = ?').get(req.params.id);
  if (!tech) return res.status(404).json({ error: 'Technician not found' });

  const { name, phone, specialties, is_active } = req.body;
  db.prepare(`
    UPDATE technicians
    SET name = COALESCE(?, name),
        phone = COALESCE(?, phone),
        specialties = COALESCE(?, specialties),
        is_active = COALESCE(?, is_active)
    WHERE id = ?
  `).run(
    name || null,
    phone || null,
    specialties !== undefined ? JSON.stringify(specialties) : null,
    is_active !== undefined ? (is_active ? 1 : 0) : null,
    req.params.id
  );

  res.json(db.prepare('SELECT * FROM technicians WHERE id = ?').get(req.params.id));
});

// DELETE /api/technicians/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  const tech = db.prepare('SELECT id FROM technicians WHERE id = ?').get(req.params.id);
  if (!tech) return res.status(404).json({ error: 'Technician not found' });

  db.prepare('DELETE FROM technicians WHERE id = ?').run(req.params.id);
  res.json({ message: 'Technician deleted' });
});

// GET /api/technicians/:id/availability
router.get('/:id/availability', (req, res) => {
  const db = getDb();
  const tech = db.prepare('SELECT id FROM technicians WHERE id = ?').get(req.params.id);
  if (!tech) return res.status(404).json({ error: 'Technician not found' });

  const availability = db.prepare(
    'SELECT * FROM technician_availability WHERE technician_id = ? ORDER BY day_of_week ASC'
  ).all(req.params.id);

  res.json(availability);
});

// PUT /api/technicians/:id/availability — replace all availability slots
router.put('/:id/availability', (req, res) => {
  const db = getDb();
  const tech = db.prepare('SELECT id FROM technicians WHERE id = ?').get(req.params.id);
  if (!tech) return res.status(404).json({ error: 'Technician not found' });

  const { slots } = req.body; // [{day_of_week, start_time, end_time}]
  if (!Array.isArray(slots)) return res.status(400).json({ error: 'slots array required' });

  const replaceAll = db.transaction(() => {
    db.prepare('DELETE FROM technician_availability WHERE technician_id = ?').run(req.params.id);
    const insert = db.prepare(
      'INSERT INTO technician_availability (technician_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)'
    );
    slots.forEach(({ day_of_week, start_time, end_time }) => {
      insert.run(req.params.id, day_of_week, start_time, end_time);
    });
  });

  replaceAll();
  const updated = db.prepare(
    'SELECT * FROM technician_availability WHERE technician_id = ? ORDER BY day_of_week ASC'
  ).all(req.params.id);

  res.json(updated);
});

// GET /api/technicians/:id/appointments — upcoming appointments for technician
router.get('/:id/appointments', (req, res) => {
  const db = getDb();
  const tech = db.prepare('SELECT id FROM technicians WHERE id = ?').get(req.params.id);
  if (!tech) return res.status(404).json({ error: 'Technician not found' });

  const appointments = db.prepare(`
    SELECT a.*, c.name AS customer_name, c.phone AS customer_phone, s.name AS service_name, s.duration_minutes
    FROM appointments a
    JOIN customers c ON a.customer_id = c.id
    JOIN services s ON a.service_id = s.id
    WHERE a.technician_id = ? AND a.status NOT IN ('cancelled', 'completed')
    ORDER BY a.scheduled_at ASC
  `).all(req.params.id);

  res.json(appointments);
});

module.exports = router;
