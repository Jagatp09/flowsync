const { Op } = require('sequelize');
const {
  app,
  sequelize,
  User,
  login,
  loginManager,
  loginStaff,
  getCsrfToken
} = require('../jest-setup');
const request = require('supertest');

describe('Scenario 2: Role-Based Access Control', () => {
  beforeAll(async () => {
    await sequelize.sync({ alter: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('Unauthenticated access', () => {
    test('Unauthenticated GET /manager/dashboard redirects to /login', async () => {
      const response = await request(app).get('/manager/dashboard');
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login');
    });

    test('Unauthenticated GET /staff/dashboard redirects to /login', async () => {
      const response = await request(app).get('/staff/dashboard');
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login');
    });

    test('Unauthenticated GET /checklists/daily redirects to /login', async () => {
      const response = await request(app).get('/checklists/daily');
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login');
    });

    test('Unauthenticated GET /manager/staff redirects to /login', async () => {
      const response = await request(app).get('/manager/staff');
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login');
    });

    test('Unauthenticated GET /manager/shifts redirects to /login', async () => {
      const response = await request(app).get('/manager/shifts');
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login');
    });

    test('Unauthenticated GET /manager/inventory redirects to /login', async () => {
      const response = await request(app).get('/manager/inventory');
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login');
    });

    test('Unauthenticated GET /manager/leave-requests redirects to /login', async () => {
      const response = await request(app).get('/manager/leave-requests');
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login');
    });

    test('Unauthenticated GET /manager/swap-requests redirects to /login', async () => {
      const response = await request(app).get('/manager/swap-requests');
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login');
    });
  });

  describe('Staff accessing manager-only routes', () => {
    const managerRoutes = [
      '/manager/staff',
      '/manager/staff/new',
      '/manager/shifts',
      '/manager/shifts/new',
      '/manager/inventory',
      '/manager/inventory/new',
      '/manager/leave-requests',
      '/manager/swap-requests'
    ];

    test.each(managerRoutes)('Staff GET %s returns 302 or 403 and redirects to /staff/dashboard', async (path) => {
      const agent = request.agent(app);
      await login(agent, 'staff@flowsync.com', 'Password123');

      const response = await agent.get(path);
      expect([302, 403]).toContain(response.status);
      if (response.status === 302) {
        expect(response.headers.location).toBe('/staff/dashboard');
      }
    });

    test('Staff POST to /manager/staff returns 302 or 403', async () => {
      const agent = request.agent(app);
      await login(agent, 'staff@flowsync.com', 'Password123');

      // Get CSRF from staff dashboard since /login redirects when authenticated
      const csrfToken = await getCsrfToken(agent, '/staff/dashboard');
      const response = await agent
        .post('/manager/staff')
        .type('form')
        .send({
          _csrf: csrfToken,
          fullName: 'Hacker Staff',
          email: 'hacker@test.com',
          password: 'Password123',
          role: 'STAFF'
        });

      expect([302, 403]).toContain(response.status);
    });

    test('Staff POST to /manager/shifts returns 302 or 403', async () => {
      const agent = request.agent(app);
      await login(agent, 'staff@flowsync.com', 'Password123');

      const csrfToken = await getCsrfToken(agent, '/staff/dashboard');
      const response = await agent
        .post('/manager/shifts')
        .type('form')
        .send({
          _csrf: csrfToken,
          title: 'Hacker Shift',
          shiftDate: '2099-01-01',
          shiftType: 'OPENING'
        });

      expect([302, 403]).toContain(response.status);
    });
  });

  describe('Manager accessing staff-only routes', () => {
    test('Manager GET /staff/dashboard should work (manager can view staff pages)', async () => {
      const agent = request.agent(app);
      await login(agent, 'manager@flowsync.com', 'Password123');

      const response = await agent.get('/staff/dashboard');
      // Manager should be able to access staff dashboard
      expect([200, 302]).toContain(response.status);
      if (response.status === 302) {
        expect(response.headers.location).toBe('/manager/dashboard');
      }
    });

    test('Manager GET /checklists/daily should work', async () => {
      const agent = request.agent(app);
      await login(agent, 'manager@flowsync.com', 'Password123');

      const response = await agent.get('/checklists/daily');
      // Manager should be able to access checklist page
      expect([200, 302]).toContain(response.status);
    });

    test('Manager GET /staff/inventory should work', async () => {
      const agent = request.agent(app);
      await login(agent, 'manager@flowsync.com', 'Password123');

      const response = await agent.get('/staff/inventory');
      // Manager should be able to access staff inventory page
      expect([200, 302]).toContain(response.status);
    });
  });

  describe('Cross-role POST prevention', () => {
    test('Staff cannot approve leave requests', async () => {
      const agent = request.agent(app);
      await login(agent, 'staff@flowsync.com', 'Password123');

      const csrfToken = await getCsrfToken(agent, '/staff/dashboard');
      // Try to POST to manager leave approval endpoint
      const response = await agent
        .post('/manager/leave-requests/1/approve')
        .type('form')
        .send({ _csrf: csrfToken });

      expect([302, 403]).toContain(response.status);
    });

    test('Staff cannot approve swap requests', async () => {
      const agent = request.agent(app);
      await login(agent, 'staff@flowsync.com', 'Password123');

      const csrfToken = await getCsrfToken(agent, '/staff/dashboard');
      const response = await agent
        .post('/manager/swap-requests/1/approve')
        .type('form')
        .send({ _csrf: csrfToken });

      expect([302, 403]).toContain(response.status);
    });

    test('Staff cannot access shift start/close endpoints', async () => {
      const agent = request.agent(app);
      await login(agent, 'staff@flowsync.com', 'Password123');

      const csrfToken = await getCsrfToken(agent, '/staff/dashboard');

      const startResponse = await agent
        .post('/manager/shifts/1/start')
        .type('form')
        .send({ _csrf: csrfToken });

      const closeResponse = await agent
        .post('/manager/shifts/1/close')
        .type('form')
        .send({ _csrf: csrfToken });

      expect([302, 403]).toContain(startResponse.status);
      expect([302, 403]).toContain(closeResponse.status);
    });
  });
});
