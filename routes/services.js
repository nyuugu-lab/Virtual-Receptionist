const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// GET /api/services
router.get('/', (req, res) => {
  const db = getDb();
  const { active } = req.query;
  let sql = 'SELECT * FROM services';
  const params = [];

  if (active !== undefined) {
    sql += ' WHERE is_active = ?';
    params.push(active === 'false' || active === '0' ? 0 : 1);
  }
  sql += ' ORDER BY name ASC';

  res.json(db.prepare(sql).all(...params));
});

// GET /api/services/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });
  res.json(service);
});

// POST /api/services
router.post('/', (req, res) => {
  const db = getDb();
  const { name, description, price, duration_minutes } = req.body;
  if (!name || price === undefined) {
    return res.status(400).json({ error: 'name and price are required' });
  }
  if (isNaN(Number(price)) || Number(price) < 0) {
    return res.status(400).json({ error: 'price must be a non-negative number' });
  }

  const result = db.prepare(`
    INSERT INTO services (name, description, price, duration_minutes)
    VALUES (?, ?, ?, ?)
  `).run(name, description || null, Number(price), Number(duration_minutes) || 30);

  res.status(201).json(db.prepare('SELECT * FROM services WHERE id = ?').get(result.lastInsertRowid));
});

// PUT /api/services/:id
router.put('/:id', (req, res) => {
  const db = getDb();
  const service = db.prepare('SELECT id FROM services WHERE id = ?').get(req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });

  const { name, description, price, duration_minutes, is_active } = req.body;
  db.prepare(`
    UPDATE services
    SET name = COALESCE(?, name),
        description = COALESCE(?, description),
        price = COALESCE(?, price),
        duration_minutes = COALESCE(?, duration_minutes),
        is_active = COALESCE(?, is_active)
    WHERE id = ?
  `).run(
    name || null,
    description || null,
    price !== undefined ? Number(price) : null,
    duration_minutes !== undefined ? Number(duration_minutes) : null,
    is_active !== undefined ? (is_active ? 1 : 0) : null,
    req.params.id
  );

  res.json(db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id));
});

// DELETE /api/services/:id
router.delete('/:id', (req, res) => {
  const db = getDb();
  const service = db.prepare('SELECT id FROM services WHERE id = ?').get(req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found' });

  db.prepare('DELETE FROM services WHERE id = ?').run(req.params.id);
  res.json({ message: 'Service deleted' });
});

// GET /api/services/catalog — alias for listing all active services with price info
router.get('/catalog/all', (req, res) => {
  const db = getDb();
  const catalog = db.prepare(
    'SELECT id, name, description, price, duration_minutes FROM services WHERE is_active = 1 ORDER BY name ASC'
  ).all();
  res.json(catalog);
});

module.exports = router;
