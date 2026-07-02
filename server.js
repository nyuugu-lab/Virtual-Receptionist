require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database
initDatabase();

// API Routes
app.use('/api/customers', require('./routes/customers'));
app.use('/api/technicians', require('./routes/technicians'));
app.use('/api/services', require('./routes/services'));
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/visits', require('./routes/visits'));
app.use('/api/calls', require('./routes/calls'));
app.use('/api/stats', require('./routes/stats'));

// Catch-all: serve the dashboard for any non-API route
app.get('*', (req, res) => {
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
