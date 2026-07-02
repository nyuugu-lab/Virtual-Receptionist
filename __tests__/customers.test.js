/**
 * Integration tests for the Customers API.
 * Uses an in-memory SQLite database so tests are isolated.
 */

process.env.DB_PATH = ':memory:';
const request = require('supertest');
const app = require('../server');
const { resetDb } = require('../database');

beforeEach(() => {
  resetDb(); // fresh DB for each test
  // Re-initialise after reset
  require('../database').initDatabase();
});

afterAll(() => {
  resetDb();
});

describe('GET /api/customers', () => {
  it('returns an empty array when no customers exist (beyond seed)', async () => {
    const res = await request(app).get('/api/customers');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('POST /api/customers', () => {
  it('creates a new customer', async () => {
    const res = await request(app)
      .post('/api/customers')
      .send({ name: 'Jane Doe', phone: '555-1111' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Jane Doe');
    expect(res.body.phone).toBe('555-1111');
    expect(res.body.points).toBe(0);
    expect(res.body.is_flagged).toBe(0);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/customers')
      .send({ phone: '555-2222' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when phone is missing', async () => {
    const res = await request(app)
      .post('/api/customers')
      .send({ name: 'No Phone' });
    expect(res.status).toBe(400);
  });

  it('returns 409 on duplicate phone', async () => {
    await request(app).post('/api/customers').send({ name: 'A', phone: '555-3333' });
    const res = await request(app).post('/api/customers').send({ name: 'B', phone: '555-3333' });
    expect(res.status).toBe(409);
  });
});

describe('GET /api/customers/:id', () => {
  it('returns a customer by ID', async () => {
    const created = await request(app)
      .post('/api/customers')
      .send({ name: 'John Smith', phone: '555-4444' });

    const res = await request(app).get(`/api/customers/${created.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('John Smith');
  });

  it('returns 404 for non-existent ID', async () => {
    const res = await request(app).get('/api/customers/99999');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/customers/:id', () => {
  it('updates customer fields', async () => {
    const created = await request(app)
      .post('/api/customers')
      .send({ name: 'Update Me', phone: '555-5555' });

    const res = await request(app)
      .put(`/api/customers/${created.body.id}`)
      .send({ name: 'Updated Name', email: 'updated@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Name');
    expect(res.body.email).toBe('updated@test.com');
    expect(res.body.phone).toBe('555-5555'); // unchanged
  });
});

describe('DELETE /api/customers/:id', () => {
  it('deletes a customer', async () => {
    const created = await request(app)
      .post('/api/customers')
      .send({ name: 'Delete Me', phone: '555-6666' });

    const del = await request(app).delete(`/api/customers/${created.body.id}`);
    expect(del.status).toBe(200);

    const get = await request(app).get(`/api/customers/${created.body.id}`);
    expect(get.status).toBe(404);
  });
});

describe('POST /api/customers/:id/flag and /unflag', () => {
  it('flags and unflags a customer', async () => {
    const created = await request(app)
      .post('/api/customers')
      .send({ name: 'Flag Me', phone: '555-7777' });
    const id = created.body.id;

    const flagRes = await request(app)
      .post(`/api/customers/${id}/flag`)
      .send({ reason: 'No-show 3 times' });
    expect(flagRes.status).toBe(200);

    const flagged = await request(app).get(`/api/customers/${id}`);
    expect(flagged.body.is_flagged).toBe(1);
    expect(flagged.body.flag_reason).toBe('No-show 3 times');

    const unflagRes = await request(app).post(`/api/customers/${id}/unflag`);
    expect(unflagRes.status).toBe(200);

    const unflagged = await request(app).get(`/api/customers/${id}`);
    expect(unflagged.body.is_flagged).toBe(0);
  });
});

describe('POST /api/customers/:id/points', () => {
  it('adds and subtracts points', async () => {
    const created = await request(app)
      .post('/api/customers')
      .send({ name: 'Points User', phone: '555-8888' });
    const id = created.body.id;

    await request(app).post(`/api/customers/${id}/points`).send({ delta: 50 });
    const after50 = await request(app).get(`/api/customers/${id}`);
    expect(after50.body.points).toBe(50);

    await request(app).post(`/api/customers/${id}/points`).send({ delta: -20 });
    const after30 = await request(app).get(`/api/customers/${id}`);
    expect(after30.body.points).toBe(30);

    // Should not go below 0
    await request(app).post(`/api/customers/${id}/points`).send({ delta: -100 });
    const afterMin = await request(app).get(`/api/customers/${id}`);
    expect(afterMin.body.points).toBe(0);
  });
});

describe('Search /api/customers?q=', () => {
  it('finds customers by name', async () => {
    await request(app).post('/api/customers').send({ name: 'Alice Wonder', phone: '555-9001' });
    await request(app).post('/api/customers').send({ name: 'Bob Builder', phone: '555-9002' });

    const res = await request(app).get('/api/customers?q=Alice');
    expect(res.status).toBe(200);
    expect(res.body.some(c => c.name === 'Alice Wonder')).toBe(true);
    expect(res.body.some(c => c.name === 'Bob Builder')).toBe(false);
  });

  it('finds customers by phone', async () => {
    await request(app).post('/api/customers').send({ name: 'Charlie Phone', phone: '555-unique' });
    const res = await request(app).get('/api/customers?phone=555-unique');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].name).toBe('Charlie Phone');
  });

  it('returns only flagged customers when flagged=true', async () => {
    const c = await request(app).post('/api/customers').send({ name: 'Flagged Test', phone: '555-flag1' });
    await request(app).post(`/api/customers/${c.body.id}/flag`).send({ reason: 'test' });

    const res = await request(app).get('/api/customers?flagged=true');
    expect(res.body.every(c => c.is_flagged === 1)).toBe(true);
    expect(res.body.some(c => c.name === 'Flagged Test')).toBe(true);
  });
});
