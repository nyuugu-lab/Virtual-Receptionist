const express = require('express');
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

const app = express();
const PORT = 3000;
const DATA_FILE    = path.join(__dirname, 'data', 'visitors.json');
const CLIENTS_FILE = path.join(__dirname, 'data', 'clients.json');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

function buildClientSummary() {
  const visitors = readVisitors();
  const clientStore = readClients();
  const map = {};

  for (const v of visitors) {
    if (!v.phone || v.status === 'pending-services' || v.status === 'pending-stylist') continue;
    const phone = v.phone;
    if (!map[phone]) {
      map[phone] = { phone, name: v.name, visits: [], stylists: new Set(), days: new Set() };
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

app.get('/kiosk', (req, res) => res.sendFile(path.join(__dirname, 'views', 'kiosk.html')));

app.post('/kiosk/checkin', (req, res) => {
  const { name, phone } = req.body;
  if (!name || !phone) return res.redirect('/kiosk?error=missing');
  const visitors = readVisitors();
  const visitor = {
    id: Date.now().toString(), name: name.trim(), phone: phone.trim(),
    checkedInAt: new Date().toISOString(), checkedOutAt: null, services: [], status: 'pending-services'
  };
  visitors.push(visitor);
  writeVisitors(visitors);
  res.redirect(`/kiosk/services?id=${visitor.id}`);
});

app.get('/kiosk/services', (req, res) => res.sendFile(path.join(__dirname, 'views', 'services.html')));

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

app.get('/kiosk/stylist', (req, res) => res.sendFile(path.join(__dirname, 'views', 'stylist.html')));

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

app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));

app.get('/api/visitors', (req, res) => res.json(readVisitors()));

app.post('/checkout/:id', (req, res) => {
  const visitors = readVisitors();
  const visitor = visitors.find(v => v.id === req.params.id);
  if (!visitor) return res.status(404).json({ error: 'Visitor not found' });
  visitor.status = 'checked-out';
  visitor.checkedOutAt = new Date().toISOString();
  writeVisitors(visitors);
  res.json({ success: true, visitor });
});

app.get('/clients', (req, res) => res.sendFile(path.join(__dirname, 'views', 'clients.html')));

app.get('/api/clients', (req, res) => res.json(buildClientSummary()));

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

app.get('/clients/:phone', (req, res) => res.sendFile(path.join(__dirname, 'views', 'client-profile.html')));

app.post('/api/clients/:phone/edit', (req, res) => {
  const phone = req.params.phone;
  const { name } = req.body;
  const clients = readClients();
  if (!clients[phone]) clients[phone] = { phone, comments: [], archived: false };
  if (name) clients[phone].name = name.trim();
  writeClients(clients);
  res.json({ success: true });
});

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

app.delete('/api/clients/:phone/comment/:id', (req, res) => {
  const { phone, id } = req.params;
  const clients = readClients();
  if (clients[phone]) {
    clients[phone].comments = (clients[phone].comments || []).filter(c => c.id !== id);
    writeClients(clients);
  }
  res.json({ success: true });
});

app.delete('/api/clients/:phone', (req, res) => {
  const phone = req.params.phone;
  const clients = readClients();
  if (!clients[phone]) clients[phone] = { phone, comments: [], archived: false };
  clients[phone].archived = true;
  writeClients(clients);
  res.json({ success: true });
});

// --- /export/excel --- Export clients to Excel
app.get('/export/excel', async (req, res) => {
  const clients = buildClientSummary();
  const visitors = readVisitors();

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Virtual Receptionist';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Clients', { views: [{ state: 'frozen', ySplit: 1 }] });

  sheet.columns = [
    { header: 'Name',                 key: 'name',        width: 22 },
    { header: 'Phone',                key: 'phone',       width: 16 },
    { header: 'Total Visits',         key: 'totalVisits', width: 14 },
    { header: 'Last Visit',           key: 'lastVisit',   width: 18 },
    { header: 'Days They Visit',      key: 'days',        width: 28 },
    { header: 'Preferred Technician', key: 'stylists',    width: 28 },
    { header: 'Services',             key: 'services',    width: 36 },
    { header: 'Status',               key: 'status',      width: 12 },
  ];

  sheet.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2D3748' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });
  sheet.getRow(1).height = 28;

  const serviceMap = {};
  for (const v of visitors) {
    if (!v.phone || !v.services || !v.services.length) continue;
    if (!serviceMap[v.phone]) serviceMap[v.phone] = new Set();
    v.services.forEach(s => serviceMap[v.phone].add(s));
  }

  for (const c of clients) {
    const row = sheet.addRow({
      name:        c.name,
      phone:       c.phone,
      totalVisits: c.totalVisits,
      lastVisit:   c.lastVisit ? new Date(c.lastVisit).toLocaleDateString() : '—',
      days:        c.days.join(', ') || '—',
      stylists:    c.stylists.join(', ') || '—',
      services:    serviceMap[c.phone] ? [...serviceMap[c.phone]].join(', ') : '—',
      status:      c.inactive ? 'Inactive' : 'Active',
    });
    row.getCell('status').font = { color: { argb: c.inactive ? 'FF9B2C2C' : 'FF276749' }, bold: true };
    row.alignment = { vertical: 'middle', wrapText: true };
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="clients.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

// --- /export/pdf --- Export clients to PDF
app.get('/export/pdf', (req, res) => {
  const clients = buildClientSummary();
  const visitors = readVisitors();

  const serviceMap = {};
  for (const v of visitors) {
    if (!v.phone || !v.services || !v.services.length) continue;
    if (!serviceMap[v.phone]) serviceMap[v.phone] = new Set();
    v.services.forEach(s => serviceMap[v.phone].add(s));
  }

  const doc = new PDFDocument({ margin: 40, size: 'LETTER' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="clients.pdf"');
  doc.pipe(res);

  doc.fontSize(20).fillColor('#2d3748').text('Virtual Receptionist — Client Report', { align: 'center' });
  doc.fontSize(10).fillColor('#718096').text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
  doc.moveDown(1.5);

  for (const c of clients) {
    doc.fontSize(13).fillColor(c.inactive ? '#9b2c2c' : '#2d3748').text(c.name, { continued: true });
    doc.fontSize(10).fillColor('#718096').text(`  •  ${c.inactive ? 'Inactive' : 'Active'}  •  ${c.totalVisits} visits`);
    doc.moveDown(0.3);

    const services = serviceMap[c.phone] ? [...serviceMap[c.phone]].join(', ') : '—';
    const rows = [
      ['Phone',                c.phone],
      ['Preferred Technician', c.stylists.join(', ') || '—'],
      ['Services',             services],
      ['Days They Visit',      c.days.join(', ') || '—'],
      ['Last Visit',           c.lastVisit ? new Date(c.lastVisit).toLocaleDateString() : '—'],
    ];

    for (const [label, value] of rows) {
      doc.fontSize(9).fillColor('#4a5568').text(`${label}: `, { continued: true });
      doc.fillColor('#1a202c').text(value);
    }

    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(570, doc.y).strokeColor('#e2e8f0').stroke();
    doc.moveDown(0.5);
    if (doc.y > 680) doc.addPage();
  }

  doc.end();
});

app.listen(PORT, () => {
  console.log(`Virtual Receptionist running at http://localhost:${PORT}`);
  console.log(`  Kiosk:     http://localhost:${PORT}/kiosk`);
  console.log(`  Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`  Clients:   http://localhost:${PORT}/clients`);
});
