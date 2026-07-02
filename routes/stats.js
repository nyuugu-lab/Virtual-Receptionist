const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// GET /api/stats/overview — dashboard summary
router.get('/overview', (req, res) => {
  const db = getDb();

  const totalCustomers = db.prepare('SELECT COUNT(*) as count FROM customers').get();
  const flaggedCustomers = db.prepare('SELECT COUNT(*) as count FROM customers WHERE is_flagged = 1').get();
  const totalVisitsToday = db.prepare(
    "SELECT COUNT(*) as count FROM visits WHERE DATE(checked_in_at) = DATE('now')"
  ).get();
  const checkedInNow = db.prepare(
    'SELECT COUNT(*) as count FROM visits WHERE checked_out_at IS NULL'
  ).get();
  const revenueToday = db.prepare(
    "SELECT COALESCE(SUM(total_amount), 0) as total FROM visits WHERE DATE(checked_in_at) = DATE('now') AND total_amount IS NOT NULL"
  ).get();
  const appointmentsToday = db.prepare(
    "SELECT COUNT(*) as count FROM appointments WHERE DATE(scheduled_at) = DATE('now') AND status NOT IN ('cancelled')"
  ).get();
  const pendingAppointments = db.prepare(
    "SELECT COUNT(*) as count FROM appointments WHERE status = 'scheduled' AND scheduled_at >= datetime('now')"
  ).get();
  const totalCallsToday = db.prepare(
    "SELECT COUNT(*) as count FROM call_logs WHERE DATE(created_at) = DATE('now')"
  ).get();

  res.json({
    total_customers: totalCustomers.count,
    flagged_customers: flaggedCustomers.count,
    visits_today: totalVisitsToday.count,
    currently_checked_in: checkedInNow.count,
    revenue_today: revenueToday.total,
    appointments_today: appointmentsToday.count,
    pending_appointments: pendingAppointments.count,
    calls_today: totalCallsToday.count
  });
});

// GET /api/stats/revenue — revenue over time
router.get('/revenue', (req, res) => {
  const db = getDb();
  const { period = 'week' } = req.query;

  let dateExpr;
  if (period === 'month') dateExpr = "strftime('%Y-%m', checked_in_at)";
  else if (period === 'year') dateExpr = "strftime('%Y', checked_in_at)";
  else dateExpr = "DATE(checked_in_at)"; // week/default

  const limit = period === 'year' ? 12 : period === 'month' ? 12 : 30;

  const rows = db.prepare(`
    SELECT ${dateExpr} AS period,
           COUNT(*) AS visit_count,
           COALESCE(SUM(total_amount), 0) AS revenue
    FROM visits
    WHERE total_amount IS NOT NULL
    GROUP BY period
    ORDER BY period DESC
    LIMIT ?
  `).all(limit);

  res.json(rows.reverse());
});

// GET /api/stats/customers — customer activity stats
router.get('/customers', (req, res) => {
  const db = getDb();

  const topCustomers = db.prepare(`
    SELECT c.id, c.name, c.phone, c.points,
           COUNT(v.id) AS visit_count,
           COALESCE(SUM(v.total_amount), 0) AS total_spent
    FROM customers c
    LEFT JOIN visits v ON c.id = v.customer_id
    GROUP BY c.id
    ORDER BY visit_count DESC
    LIMIT 10
  `).all();

  const newThisMonth = db.prepare(
    "SELECT COUNT(*) as count FROM customers WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')"
  ).get();

  const retentionData = db.prepare(`
    SELECT COUNT(DISTINCT customer_id) as returning_customers
    FROM visits
    WHERE customer_id IN (
      SELECT customer_id FROM visits GROUP BY customer_id HAVING COUNT(*) > 1
    )
  `).get();

  res.json({
    top_customers: topCustomers,
    new_customers_this_month: newThisMonth.count,
    returning_customers: retentionData.returning_customers
  });
});

// GET /api/stats/technicians — technician performance
router.get('/technicians', (req, res) => {
  const db = getDb();

  const stats = db.prepare(`
    SELECT t.id, t.name,
           COUNT(v.id) AS total_visits,
           COALESCE(SUM(v.total_amount), 0) AS total_revenue,
           COUNT(DISTINCT v.customer_id) AS unique_customers
    FROM technicians t
    LEFT JOIN visits v ON t.id = v.technician_id
    GROUP BY t.id
    ORDER BY total_visits DESC
  `).all();

  res.json(stats);
});

// GET /api/stats/services — most popular services
router.get('/services', (req, res) => {
  const db = getDb();

  const stats = db.prepare(`
    SELECT s.id, s.name, s.price,
           COUNT(v.id) AS booking_count,
           COALESCE(SUM(v.total_amount), 0) AS total_revenue
    FROM services s
    LEFT JOIN visits v ON s.id = v.service_id
    GROUP BY s.id
    ORDER BY booking_count DESC
  `).all();

  res.json(stats);
});

module.exports = router;
