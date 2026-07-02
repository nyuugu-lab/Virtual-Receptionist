require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { initDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Rate limiting – protect all API routes from abuse
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,                  // 300 requests per window per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});

// Slightly looser limit for Twilio webhook endpoints (they come from Twilio IPs, not browsers)
const twilioLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests.' }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database
initDatabase();

// API Routes (rate-limited)
app.use('/api/customers', apiLimiter, require('./routes/customers'));
app.use('/api/technicians', apiLimiter, require('./routes/technicians'));
app.use('/api/services', apiLimiter, require('./routes/services'));
app.use('/api/appointments', apiLimiter, require('./routes/appointments'));
app.use('/api/visits', apiLimiter, require('./routes/visits'));
app.use('/api/calls', twilioLimiter, require('./routes/calls'));
app.use('/api/stats', apiLimiter, require('./routes/stats'));

// Catch-all: serve the dashboard for any non-API route (rate-limited to prevent abuse)
app.get('*', apiLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Virtual Receptionist server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
