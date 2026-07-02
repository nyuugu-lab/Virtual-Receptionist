const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// Helper: check if a technician is available at a given datetime
function isTechnicianAvailable(db, technicianId, scheduledAt, durationMinutes) {
  const dt = new Date(scheduledAt);
  const dayOfWeek = dt.getDay(); // 0=Sun
  const timeStr = dt.toTimeString().slice(0, 5); // HH:MM

  // Check availability window
  const avail = db.prepare(`
    SELECT * FROM technician_availability
    WHERE technician_id = ? AND day_of_week = ?
      AND start_time <= ? AND end_time >= ?
  `).get(technicianId, dayOfWeek, timeStr, timeStr);

  if (!avail) return false;

  // Check for conflicting appointments
  const endTime = new Date(dt.getTime() + durationMinutes * 60000).toISOString();
  const conflict = db.prepare(`
    SELECT a.id FROM appointments a
    JOIN services s ON a.service_id = s.id
    WHERE a.technician_id = ?
      AND a.status NOT IN ('cancelled')
      AND a.scheduled_at < ?
      AND datetime(a.scheduled_at, '+' || s.duration_minutes || ' minutes') > ?
  `).get(technicianId, endTime, scheduledAt);

  return !conflict;
}

// GET /api/appointments
router.get('/', (req, res) => {
  const db = getDb();
  const { status, customer_id, technician_id, date } = req.query;

  let sql = `
    SELECT a.*, c.name AS customer_name, c.phone AS customer_phone,
           t.name AS technician_name, s.name AS service_name, s.price, s.duration_minutes
    FROM appointments a
    JOIN customers c ON a.customer_id = c.id
    JOIN technicians t ON a.technician_id = t.id
    JOIN services s ON a.service_id = s.id
    WHERE 1=1
  `;
  const params = [];

  if (status) { sql += ' AND a.status = ?'; params.push(status); }
  if (customer_id) { sql += ' AND a.customer_id = ?'; params.push(customer_id); }
  if (technician_id) { sql += ' AND a.technician_id = ?'; params.push(technician_id); }
  if (date) {
    sql += ' AND DATE(a.scheduled_at) = ?';
    params.push(date);
  }

  sql += ' ORDER BY a.scheduled_at ASC';

  res.json(db.prepare(sql).all(...params));
});

// GET /api/appointments/availability — check open slots for a technician on a date
router.get('/availability', (req, res) => {
  const db = getDb();
  const { technician_id, date, duration } = req.query;
  if (!technician_id || !date) {
    return res.status(400).json({ error: 'technician_id and date are required' });
  }

  const durationMins = Number(duration) || 30;
  const dayOfWeek = new Date(date + 'T00:00:00').getDay();

  const avail = db.prepare(`
    SELECT start_time, end_time FROM technician_availability
    WHERE technician_id = ? AND day_of_week = ?
  `).all(technician_id, dayOfWeek);

  if (!avail.length) return res.json({ available_slots: [] });

  // Get existing appointments on that day
  const booked = db.prepare(`
    SELECT a.scheduled_at, s.duration_minutes
    FROM appointments a
    JOIN services s ON a.service_id = s.id
    WHERE a.technician_id = ? AND DATE(a.scheduled_at) = ?
      AND a.status NOT IN ('cancelled')
    ORDER BY a.scheduled_at ASC
  `).all(technician_id, date);

  // Generate 30-min slots within availability windows
  const slots = [];
  avail.forEach(({ start_time, end_time }) => {
    const [sh, sm] = start_time.split(':').map(Number);
    const [eh, em] = end_time.split(':').map(Number);
    let current = sh * 60 + sm;
    const end = eh * 60 + em;

    while (current + durationMins <= end) {
      const slotStart = `${String(Math.floor(current / 60)).padStart(2, '0')}:${String(current % 60).padStart(2, '0')}`;
      const slotEnd = `${String(Math.floor((current + durationMins) / 60)).padStart(2, '0')}:${String((current + durationMins) % 60).padStart(2, '0')}`;
      const slotISO = `${date}T${slotStart}:00`;

      const conflict = booked.some(b => {
        const bStart = new Date(b.scheduled_at).getTime();
        const bEnd = bStart + b.duration_minutes * 60000;
        const sStart = new Date(slotISO).getTime();
        const sEnd = sStart + durationMins * 60000;
        return sStart < bEnd && sEnd > bStart;
      });

      if (!conflict) {
        slots.push({ start: slotStart, end: slotEnd, iso: slotISO });
      }
      current += 30;
    }
  });

  res.json({ date, technician_id: Number(technician_id), duration_minutes: durationMins, available_slots: slots });
});

// GET /api/appointments/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const appt = db.prepare(`
    SELECT a.*, c.name AS customer_name, c.phone AS customer_phone,
           t.name AS technician_name, s.name AS service_name, s.price, s.duration_minutes
    FROM appointments a
    JOIN customers c ON a.customer_id = c.id
    JOIN technicians t ON a.technician_id = t.id
    JOIN services s ON a.service_id = s.id
    WHERE a.id = ?
  `).get(req.params.id);

  if (!appt) return res.status(404).json({ error: 'Appointment not found' });
  res.json(appt);
});

// POST /api/appointments
router.post('/', (req, res) => {
  const db = getDb();
  const { customer_id, technician_id, service_id, scheduled_at, notes } = req.body;

  if (!customer_id || !technician_id || !service_id || !scheduled_at) {
    return res.status(400).json({ error: 'customer_id, technician_id, service_id, scheduled_at are required' });
  }

  const customer = db.prepare('SELECT id FROM customers WHERE id = ?').get(customer_id);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const tech = db.prepare('SELECT id FROM technicians WHERE id = ? AND is_active = 1').get(technician_id);
  if (!tech) return res.status(404).json({ error: 'Technician not found or inactive' });

  const service = db.prepare('SELECT id, duration_minutes FROM services WHERE id = ?').get(service_id);
  if (!service) return res.status(404).json({ error: 'Service not found' });

  if (!isTechnicianAvailable(db, technician_id, scheduled_at, service.duration_minutes)) {
    return res.status(409).json({ error: 'Technician is not available at that time' });
  }

  const result = db.prepare(`
    INSERT INTO appointments (customer_id, technician_id, service_id, scheduled_at, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(customer_id, technician_id, service_id, scheduled_at, notes || null);

  const appt = db.prepare(`
    SELECT a.*, c.name AS customer_name, t.name AS technician_name, s.name AS service_name
    FROM appointments a
    JOIN customers c ON a.customer_id = c.id
    JOIN technicians t ON a.technician_id = t.id
    JOIN services s ON a.service_id = s.id
    WHERE a.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json(appt);
});

// PUT /api/appointments/:id — update status or notes
router.put('/:id', (req, res) => {
  const db = getDb();
  const appt = db.prepare('SELECT id FROM appointments WHERE id = ?').get(req.params.id);
  if (!appt) return res.status(404).json({ error: 'Appointment not found' });

  const { status, notes, scheduled_at } = req.body;
  const validStatuses = ['scheduled', 'checked_in', 'completed', 'cancelled', 'no_show'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}` });
  }

  db.prepare(`
    UPDATE appointments
    SET status = COALESCE(?, status),
        notes = COALESCE(?, notes),
        scheduled_at = COALESCE(?, scheduled_at)
    WHERE id = ?
  `).run(status || null, notes || null, scheduled_at || null, req.params.id);

  res.json(db.prepare(`
    SELECT a.*, c.name AS customer_name, t.name AS technician_name, s.name AS service_name
    FROM appointments a
    JOIN customers c ON a.customer_id = c.id
    JOIN technicians t ON a.technician_id = t.id
    JOIN services s ON a.service_id = s.id
    WHERE a.id = ?
  `).get(req.params.id));
});

// DELETE /api/appointments/:id — cancel
router.delete('/:id', (req, res) => {
  const db = getDb();
  const appt = db.prepare('SELECT id FROM appointments WHERE id = ?').get(req.params.id);
  if (!appt) return res.status(404).json({ error: 'Appointment not found' });

  db.prepare("UPDATE appointments SET status = 'cancelled' WHERE id = ?").run(req.params.id);
  res.json({ message: 'Appointment cancelled' });
});

module.exports = router;
