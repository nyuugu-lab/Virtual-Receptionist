const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data', 'visitors.json');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Data helpers ---
function readVisitors() {
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  return JSON.parse(raw || '[]');
}

function writeVisitors(visitors) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(visitors, null, 2));
}

// --- /kiosk --- iPad visitor check-in page
app.get('/kiosk', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'kiosk.html'));
});

app.post('/kiosk/checkin', (req, res) => {
  const { name, phone } = req.body;
  if (!name || !phone) return res.redirect('/kiosk?error=missing');

  const visitors = readVisitors();
  const visitor = {
    id: Date.now().toString(),
    name: name.trim(),
    phone: phone.trim(),
    checkedInAt: new Date().toISOString(),
    checkedOutAt: null,
    status: 'waiting'
  };
  visitors.push(visitor);
  writeVisitors(visitors);

  res.redirect('/kiosk?success=1');
});

// --- /dashboard --- Receptionist panel
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// API: get all visitors
app.get('/api/visitors', (req, res) => {
  res.json(readVisitors());
});

// --- /checkout/:id --- Check out a visitor
app.post('/checkout/:id', (req, res) => {
  const visitors = readVisitors();
  const visitor = visitors.find(v => v.id === req.params.id);
  if (!visitor) return res.status(404).json({ error: 'Visitor not found' });

  visitor.status = 'checked-out';
  visitor.checkedOutAt = new Date().toISOString();
  writeVisitors(visitors);

  res.json({ success: true, visitor });
});

app.listen(PORT, () => {
  console.log(`Virtual Receptionist running at http://localhost:${PORT}`);
  console.log(`  Kiosk:     http://localhost:${PORT}/kiosk`);
  console.log(`  Dashboard: http://localhost:${PORT}/dashboard`);
});
