const express = require('express');
const router = express.Router();
const { getDb } = require('../database');

// Twilio SDK – only required when Twilio credentials are configured
let twiml;
try {
  const twilio = require('twilio');
  twiml = twilio.twiml;
} catch (_) {
  twiml = null;
}

function buildVoiceResponse() {
  if (twiml) return new twiml.VoiceResponse();
  // Minimal shim for environments without Twilio installed
  return {
    _xml: '',
    say(text) { this._xml += `<Say>${text}</Say>`; return this; },
    gather(opts) {
      const g = { _xml: '', say(text) { this._xml += `<Say>${text}</Say>`; return this; }, toString() { return this._xml; } };
      return g;
    },
    redirect(url) { this._xml += `<Redirect>${url}</Redirect>`; },
    toString() { return `<?xml version="1.0" encoding="UTF-8"?><Response>${this._xml}</Response>`; }
  };
}

// POST /api/calls/incoming — Twilio webhook: handle inbound call
router.post('/incoming', (req, res) => {
  const db = getDb();
  const callerNumber = req.body.From || req.body.Caller || 'unknown';
  const callSid = req.body.CallSid || null;

  // Look up existing customer
  const customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(callerNumber);

  // Log the call
  db.prepare(`
    INSERT INTO call_logs (caller_number, customer_id, call_sid, action)
    VALUES (?, ?, ?, 'incoming')
  `).run(callerNumber, customer ? customer.id : null, callSid);

  const response = buildVoiceResponse();
  const greeting = customer
    ? `Welcome back, ${customer.name}!`
    : 'Welcome to our salon!';

  const gather = response.gather
    ? response.gather({ numDigits: 1, action: '/api/calls/menu', method: 'POST' })
    : null;

  const menu = `${greeting} Press 1 to schedule an appointment. Press 2 to hear our services and prices. Press 3 to check your points and promotions. Press 4 to speak with a receptionist.`;

  if (gather && typeof gather.say === 'function') {
    gather.say(menu);
  } else {
    response.say(menu);
  }

  res.type('text/xml');
  res.send(response.toString());
});

// POST /api/calls/menu — IVR menu handler
router.post('/menu', (req, res) => {
  const db = getDb();
  const digit = req.body.Digits;
  const callerNumber = req.body.From || req.body.Caller || 'unknown';
  const callSid = req.body.CallSid || null;
  const response = buildVoiceResponse();

  switch (digit) {
    case '1': {
      // Schedule appointment
      db.prepare(`
        UPDATE call_logs SET action = 'schedule_request' WHERE call_sid = ?
      `).run(callSid);

      const services = db.prepare("SELECT name, price FROM services WHERE is_active = 1 ORDER BY name ASC").all();
      const serviceList = services.map(s => `${s.name} for $${s.price}`).join('. ');
      response.say(
        `To schedule an appointment, please call back during business hours or visit our website. ` +
        `Our available services include: ${serviceList}.`
      );
      break;
    }
    case '2': {
      // Services and prices
      db.prepare(`UPDATE call_logs SET action = 'inquiry' WHERE call_sid = ?`).run(callSid);

      const services = db.prepare(
        "SELECT name, description, price, duration_minutes FROM services WHERE is_active = 1 ORDER BY name ASC"
      ).all();
      const details = services.map(s =>
        `${s.name}: ${s.description || 'No description'}. Price: $${s.price}. Duration: ${s.duration_minutes} minutes.`
      ).join(' ');
      response.say(`Here are our services. ${details}`);
      break;
    }
    case '3': {
      // Points and promotions
      db.prepare(`UPDATE call_logs SET action = 'points_inquiry' WHERE call_sid = ?`).run(callSid);

      const customer = db.prepare('SELECT * FROM customers WHERE phone = ?').get(callerNumber);
      if (customer) {
        const promos = db.prepare(`
          SELECT p.name FROM customer_promotions cp
          JOIN promotions p ON cp.promotion_id = p.id
          WHERE cp.customer_id = ? AND cp.used_at IS NULL
        `).all(customer.id);
        const promoText = promos.length
          ? `You have ${promos.length} active promotion${promos.length > 1 ? 's' : ''}: ${promos.map(p => p.name).join(', ')}.`
          : 'You have no active promotions at this time.';
        response.say(`You have ${customer.points} loyalty points. ${promoText}`);
      } else {
        response.say('We could not find your account. Please visit us in person to register.');
      }
      break;
    }
    case '4': {
      response.say('Please hold while we connect you to a receptionist.');
      break;
    }
    default: {
      response.say('Invalid selection. Please call back and try again.');
    }
  }

  res.type('text/xml');
  res.send(response.toString());
});

// GET /api/calls/logs — retrieve call log history
router.get('/logs', (req, res) => {
  const db = getDb();
  const { limit = 50 } = req.query;
  const logs = db.prepare(`
    SELECT cl.*, c.name AS customer_name
    FROM call_logs cl
    LEFT JOIN customers c ON cl.customer_id = c.id
    ORDER BY cl.created_at DESC
    LIMIT ?
  `).all(Number(limit));
  res.json(logs);
});

// POST /api/calls/log — manually log a call
router.post('/log', (req, res) => {
  const db = getDb();
  const { caller_number, customer_id, action, notes, duration } = req.body;

  const result = db.prepare(`
    INSERT INTO call_logs (caller_number, customer_id, action, notes, duration)
    VALUES (?, ?, ?, ?, ?)
  `).run(caller_number || null, customer_id || null, action || 'manual', notes || null, duration || null);

  res.status(201).json(db.prepare('SELECT * FROM call_logs WHERE id = ?').get(result.lastInsertRowid));
});

module.exports = router;
