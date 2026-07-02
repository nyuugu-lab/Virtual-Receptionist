const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'receptionist.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDatabase() {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS technicians (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      specialties TEXT DEFAULT '[]',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      duration_minutes INTEGER DEFAULT 30,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      email TEXT,
      preferred_technician_id INTEGER,
      points INTEGER DEFAULT 0,
      is_flagged INTEGER DEFAULT 0,
      flag_reason TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_visit DATETIME,
      FOREIGN KEY (preferred_technician_id) REFERENCES technicians(id)
    );

    CREATE TABLE IF NOT EXISTS technician_availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      technician_id INTEGER NOT NULL,
      day_of_week INTEGER NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      FOREIGN KEY (technician_id) REFERENCES technicians(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      technician_id INTEGER NOT NULL,
      service_id INTEGER NOT NULL,
      scheduled_at DATETIME NOT NULL,
      status TEXT DEFAULT 'scheduled',
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (technician_id) REFERENCES technicians(id),
      FOREIGN KEY (service_id) REFERENCES services(id)
    );

    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      appointment_id INTEGER,
      service_id INTEGER,
      technician_id INTEGER,
      checked_in_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      checked_out_at DATETIME,
      total_amount REAL,
      points_earned INTEGER DEFAULT 0,
      notes TEXT,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (appointment_id) REFERENCES appointments(id),
      FOREIGN KEY (service_id) REFERENCES services(id),
      FOREIGN KEY (technician_id) REFERENCES technicians(id)
    );

    CREATE TABLE IF NOT EXISTS call_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      caller_number TEXT,
      customer_id INTEGER,
      call_sid TEXT,
      duration INTEGER,
      action TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );

    CREATE TABLE IF NOT EXISTS promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      discount_percent REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      points_required INTEGER DEFAULT 0,
      valid_from DATE,
      valid_until DATE,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS customer_promotions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      promotion_id INTEGER NOT NULL,
      assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      used_at DATETIME,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE,
      FOREIGN KEY (promotion_id) REFERENCES promotions(id) ON DELETE CASCADE
    );
  `);

  // Seed initial data only if tables are empty
  const techCount = database.prepare('SELECT COUNT(*) as count FROM technicians').get();
  if (techCount.count === 0) {
    seedData(database);
  }
}

function seedData(database) {
  const insertTech = database.prepare(
    'INSERT INTO technicians (name, phone, specialties) VALUES (?, ?, ?)'
  );
  const t1 = insertTech.run('Alice Johnson', '555-0101', JSON.stringify(['Manicure', 'Pedicure', 'Nail Art']));
  const t2 = insertTech.run('Bob Smith', '555-0102', JSON.stringify(['Haircut', 'Hair Color', 'Highlights']));
  const t3 = insertTech.run('Carol White', '555-0103', JSON.stringify(['Facial', 'Massage', 'Waxing']));

  const insertService = database.prepare(
    'INSERT INTO services (name, description, price, duration_minutes) VALUES (?, ?, ?, ?)'
  );
  insertService.run('Manicure', 'Classic manicure with nail shaping and polish', 25.00, 30);
  insertService.run('Pedicure', 'Relaxing pedicure with foot soak and polish', 35.00, 45);
  insertService.run('Haircut', 'Haircut and blow-dry', 40.00, 45);
  insertService.run('Hair Color', 'Full hair coloring service', 80.00, 90);
  insertService.run('Facial', 'Deep cleansing facial treatment', 60.00, 60);
  insertService.run('Massage', 'Relaxing full-body massage', 70.00, 60);
  insertService.run('Mani-Pedi Combo', 'Manicure and pedicure combo package', 55.00, 75);
  insertService.run('Waxing', 'Full waxing service', 45.00, 45);
  insertService.run('Nail Art', 'Custom nail art design', 15.00, 30);

  // Availability: Mon–Sat (day 1–6), 9:00–18:00
  const insertAvail = database.prepare(
    'INSERT INTO technician_availability (technician_id, day_of_week, start_time, end_time) VALUES (?, ?, ?, ?)'
  );
  [t1.lastInsertRowid, t2.lastInsertRowid, t3.lastInsertRowid].forEach((techId) => {
    for (let day = 1; day <= 6; day++) {
      insertAvail.run(techId, day, '09:00', '18:00');
    }
  });

  const insertPromo = database.prepare(
    `INSERT INTO promotions (name, description, discount_percent, points_required, valid_from, valid_until)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  insertPromo.run('Welcome Discount', '10% off for first-time customers', 10, 0, '2024-01-01', '2026-12-31');
  insertPromo.run('Loyalty Reward', '15% off after earning 100 points', 15, 100, '2024-01-01', '2026-12-31');
  insertPromo.run('Birthday Special', '20% off during your birthday month', 20, 0, '2024-01-01', '2026-12-31');
  insertPromo.run('Referral Bonus', '$10 off when you refer a friend', 0, 0, '2024-01-01', '2026-12-31');
}

// Allow tests to reset the db singleton (use a fresh in-memory db per test suite)
function resetDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, initDatabase, resetDb };
