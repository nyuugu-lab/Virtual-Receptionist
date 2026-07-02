const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const DATA_FILE    = path.join(__dirname, 'data', 'visitors.json');
const CLIENTS_FILE = path.join(__dirname, 'data', 'clients.json');

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

function readClients() {
  const raw = fs.readFileSync(CLIENTS_FILE, 'utf8');
  return JSON.parse(raw || '{}');
}

function writeClients(clients) {
  fs.writeFileSync(CLIENTS_FILE, JSON.stringify(clients, null, 2));
}

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

// Build a merged client summary from visitors + clients store
function buildClientSummary() {
  const visitors = readVisitors();
  const clientStore = readClients();
  const map = {};

  for (const v of visitors) {
    if (!v.phone || v.status === 'pending-services' || v.status === 'pending-stylist') continue;
    const phone = v.phone;
    if (!map[phone]) {
      map[phone] = {
        phone,
        name: v.name,
        visits: [],
        stylists: new Set(),
        days: new Set()
      };
    }
    map[phone].visits.push(v);
    if (v.stylist) map[phone].stylists.add(v.stylist);
    if (v.checkedInAt) map[phone].days.add(DAYS[new Date(v.checkedInAt).getDay()]);
  }

  const now = Date.now();
  const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

  return Object.values(map).map(c => {
    const extra = clientStore[c.phone] || {};
    const sorted = c.visits.sort((a, b) => new Date(b.checkedInAt) - new Date(a.checkedInAt));
    const lastVisit = sorted[0]?.checkedInAt || null;
    const inactive = lastVisit && (now - new Date(lastVisit).getTime()) > YEAR_MS;
    return {
      phone: c.phone,
      name: extra.name || c.name,
      totalVisits: c.visits.length,
      lastVisit,
      days: [...c.days],
      stylists: [...c.stylists],
      comments: extra.comments || [],
      archived: extra.archived || false,
      inactive
    };
  }).filter(c => !c.archived);
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
    services: [],
    status: 'pending-services'
  };
  visitors.push(visitor);
  writeVisitors(visitors);

  res.redirect(`/kiosk/services?id=${visitor.id}`);
});

// --- /kiosk/services --- Service selection screen (Step 2)
app.get('/kiosk/services', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'services.html'));
});

app.post('/kiosk/services', (req, res) => {
  const { id, services } = req.body;
  const visitors = readVisitors();
  const visitor = visitors.find(v => v.id === id);
  if (!visitor) return res.redirect('/kiosk?error=missing');

  visitor.services = services ? (Array.isArray(services) ? services : [services]) : [];
  visitor.status = 'pending-stylist';
  writeVisitors(visitors);

  res.redirect(`/kiosk/stylist?id=${id}`);
});

// --- /kiosk/stylist --- Stylist selection screen (Step 3)
app.get('/kiosk/stylist', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'stylist.html'));
});

app.post('/kiosk/stylist', (req, res) => {
  const { id, stylist } = req.body;
  const visitors = readVisitors();
  const visitor = visitors.find(v => v.id === id);
  if (!visitor) return res.redirect('/kiosk?error=missing');

  visitor.stylist = stylist || 'No preference';
  visitor.status = 'waiting';
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

// --- /clients --- Client list page
app.get('/clients', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'clients.html'));
});

// API: get all clients (grouped from visits)
app.get('/api/clients', (req, res) => {
  res.json(buildClientSummary());
});

// API: get single client profile
app.get('/api/clients/:phone', (req, res) => {
  const phone = req.params.phone;
  const all = buildClientSummary();
  const client = all.find(c => c.phone === phone);
  if (!client) return res.status(404).json({ error: 'Client not found' });

  const visitors = readVisitors();
  client.visitHistory = visitors
    .filter(v => v.phone === phone && v.status !== 'pending-services' && v.status !== 'pending-stylist')
    .sort((a, b) => new Date(b.checkedInAt) - new Date(a.checkedInAt));

  res.json(client);
});

// --- /clients/:phone --- Client profile page
app.get('/clients/:phone', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'client-profile.html'));
});

// API: edit client name
app.post('/api/clients/:phone/edit', (req, res) => {
  const phone = req.params.phone;
  const { name } = req.body;
  const clients = readClients();
  if (!clients[phone]) clients[phone] = { phone, comments: [], archived: false };
  if (name) clients[phone].name = name.trim();
  writeClients(clients);
  res.json({ success: true });
});

// API: add a comment
app.post('/api/clients/:phone/comment', (req, res) => {
  const phone = req.params.phone;
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Empty comment' });
  const clients = readClients();
  if (!clients[phone]) clients[phone] = { phone, comments: [], archived: false };
  const comment = { id: Date.now().toString(), text: text.trim(), createdAt: new Date().toISOString() };
  clients[phone].comments.unshift(comment);
  writeClients(clients);
  res.json({ success: true, comment });
});

// API: delete a comment
app.delete('/api/clients/:phone/comment/:id', (req, res) => {
  const { phone, id } = req.params;
  const clients = readClients();
  if (clients[phone]) {
    clients[phone].comments = (clients[phone].comments || []).filter(c => c.id !== id);
    writeClients(clients);
  }
  res.json({ success: true });
});

// API: archive a client
app.delete('/api/clients/:phone', (req, res) => {
  const phone = req.params.phone;
  const clients = readClients();
  if (!clients[phone]) clients[phone] = { phone, comments: [], archived: false };
  clients[phone].archived = true;
  writeClients(clients);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Virtual Receptionist running at http://localhost:${PORT}`);
  console.log(`  Kiosk:     http://localhost:${PORT}/kiosk`);
  console.log(`  Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`  Clients:   http://localhost:${PORT}/clients`);
});
