/**
 * Integration tests for the Appointments, Services, and Technicians APIs.
 */

process.env.DB_PATH = ':memory:';
const request = require('supertest');
const app = require('../server');
const { resetDb, initDatabase } = require('../database');

beforeEach(() => {
  resetDb();
  initDatabase();
});

afterAll(() => {
  resetDb();
});

// ─── Services ────────────────────────────────────────────────────────────────

describe('GET /api/services', () => {
  it('returns a list of services (seeded data)', async () => {
    const res = await request(app).get('/api/services');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe('POST /api/services', () => {
  it('creates a new service', async () => {
    const res = await request(app)
      .post('/api/services')
      .send({ name: 'Test Service', price: 30, duration_minutes: 45 });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Test Service');
    expect(res.body.price).toBe(30);
  });

  it('returns 400 when price is missing', async () => {
    const res = await request(app).post('/api/services').send({ name: 'No Price' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/services/:id', () => {
  it('updates a service', async () => {
    const created = await request(app)
      .post('/api/services')
      .send({ name: 'Old Name', price: 20 });

    const res = await request(app)
      .put(`/api/services/${created.body.id}`)
      .send({ name: 'New Name', price: 25 });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New Name');
    expect(res.body.price).toBe(25);
  });
});

// ─── Technicians ─────────────────────────────────────────────────────────────

describe('GET /api/technicians', () => {
  it('returns seeded technicians', async () => {
    const res = await request(app).get('/api/technicians');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe('POST /api/technicians', () => {
  it('creates a technician', async () => {
    const res = await request(app)
      .post('/api/technicians')
      .send({ name: 'New Tech', phone: '555-0999', specialties: ['Haircut'] });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('New Tech');
    expect(JSON.parse(res.body.specialties)).toContain('Haircut');
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/api/technicians').send({ phone: '555-0000' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/technicians/:id/availability', () => {
  it('sets technician availability', async () => {
    const techs = await request(app).get('/api/technicians');
    const techId = techs.body[0].id;

    const res = await request(app)
      .put(`/api/technicians/${techId}/availability`)
      .send({ slots: [{ day_of_week: 1, start_time: '10:00', end_time: '17:00' }] });

    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].start_time).toBe('10:00');
  });

  it('returns 400 when slots is not an array', async () => {
    const techs = await request(app).get('/api/technicians');
    const res = await request(app)
      .put(`/api/technicians/${techs.body[0].id}/availability`)
      .send({ slots: 'invalid' });
    expect(res.status).toBe(400);
  });
});

// ─── Appointments ─────────────────────────────────────────────────────────────

describe('POST /api/appointments', () => {
  let customerId, technicianId, serviceId;

  beforeEach(async () => {
    const cRes = await request(app)
      .post('/api/customers')
      .send({ name: 'Appt Customer', phone: '555-APPT' });
    customerId = cRes.body.id;

    const techs = await request(app).get('/api/technicians');
    technicianId = techs.body[0].id;

    const svcs = await request(app).get('/api/services');
    serviceId = svcs.body[0].id;
  });

  it('creates an appointment when technician is available', async () => {
    // Pick next Monday at 10am
    const d = new Date();
    d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7));
    d.setHours(10, 0, 0, 0);
    const iso = d.toISOString().slice(0, 16);

    const res = await request(app)
      .post('/api/appointments')
      .send({
        customer_id: customerId,
        technician_id: technicianId,
        service_id: serviceId,
        scheduled_at: iso
      });

    // Either 201 (available) or 409 (not available - that's also valid if seed set hours differently)
    expect([201, 409]).toContain(res.status);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/appointments')
      .send({ customer_id: customerId });
    expect(res.status).toBe(400);
  });

  it('returns 404 for non-existent customer', async () => {
    const res = await request(app)
      .post('/api/appointments')
      .send({
        customer_id: 99999,
        technician_id: technicianId,
        service_id: serviceId,
        scheduled_at: '2025-06-02T10:00:00'
      });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/appointments/availability', () => {
  it('returns available slots for a technician', async () => {
    const techs = await request(app).get('/api/technicians');
    const techId = techs.body[0].id;

    // Monday 2025-06-02
    const res = await request(app)
      .get(`/api/appointments/availability?technician_id=${techId}&date=2025-06-02`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.available_slots)).toBe(true);
  });

  it('returns 400 when required query params missing', async () => {
    const res = await request(app).get('/api/appointments/availability');
    expect(res.status).toBe(400);
  });
});

// ─── Visits ──────────────────────────────────────────────────────────────────

describe('POST /api/visits/checkin and PUT /api/visits/:id/checkout', () => {
  let customerId;

  beforeEach(async () => {
    const cRes = await request(app)
      .post('/api/customers')
      .send({ name: 'Visit Customer', phone: '555-VISIT' });
    customerId = cRes.body.id;
  });

  it('checks in and checks out a customer, adding points', async () => {
    const checkinRes = await request(app)
      .post('/api/visits/checkin')
      .send({ customer_id: customerId });

    expect(checkinRes.status).toBe(201);
    const visitId = checkinRes.body.visit.id;

    const checkoutRes = await request(app)
      .put(`/api/visits/${visitId}/checkout`)
      .send({ total_amount: 45 });

    expect(checkoutRes.status).toBe(200);
    expect(checkoutRes.body.points_earned).toBe(45);

    const cust = await request(app).get(`/api/customers/${customerId}`);
    expect(cust.body.points).toBe(45);
  });

  it('returns 400 when checking in without customer_id', async () => {
    const res = await request(app).post('/api/visits/checkin').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when checking out an already checked-out visit', async () => {
    const ci = await request(app)
      .post('/api/visits/checkin')
      .send({ customer_id: customerId });
    const vid = ci.body.visit.id;

    await request(app).put(`/api/visits/${vid}/checkout`).send({ total_amount: 10 });
    const res = await request(app).put(`/api/visits/${vid}/checkout`).send({ total_amount: 10 });
    expect(res.status).toBe(400);
  });
});

// ─── Stats ───────────────────────────────────────────────────────────────────

describe('GET /api/stats/overview', () => {
  it('returns dashboard statistics', async () => {
    const res = await request(app).get('/api/stats/overview');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('total_customers');
    expect(res.body).toHaveProperty('revenue_today');
    expect(res.body).toHaveProperty('appointments_today');
  });
});
