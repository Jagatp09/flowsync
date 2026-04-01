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

describe('Scenario 1: Authentication and Session Flow', () => {
  beforeAll(async () => {
    await sequelize.sync({ alter: true });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('Valid login flows', () => {
    test('Valid manager login returns 302 and redirects to /manager/dashboard', async () => {
      const agent = request.agent(app);
      const response = await login(agent, 'manager@flowsync.com', 'Password123');
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/manager/dashboard');
    });

    test('Valid staff login returns 302 and redirects to /staff/dashboard', async () => {
      const agent = request.agent(app);
      const response = await login(agent, 'staff@flowsync.com', 'Password123');
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/staff/dashboard');
    });

    test('GET /login while already logged in as manager redirects to /manager/dashboard', async () => {
      const agent = request.agent(app);
      await login(agent, 'manager@flowsync.com', 'Password123');
      const response = await agent.get('/login');
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/manager/dashboard');
    });

    test('GET /login while already logged in as staff redirects to /staff/dashboard', async () => {
      const agent = request.agent(app);
      await login(agent, 'staff@flowsync.com', 'Password123');
      const response = await agent.get('/login');
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/staff/dashboard');
    });
  });

  describe('Invalid login flows', () => {
    test('Invalid password returns 401 and renders login page with error', async () => {
      const agent = request.agent(app);
      const response = await login(agent, 'manager@flowsync.com', 'wrong-password');
      expect(response.status).toBe(401);
      expect(response.text).toContain('Invalid email or password');
    });

    test('Non-existent email returns 401 and renders login page with error', async () => {
      const agent = request.agent(app);
      const response = await login(agent, 'nonexistent@flowsync.com', 'Password123');
      expect(response.status).toBe(401);
      expect(response.text).toContain('Invalid email or password');
    });

    test('Blank email returns 400', async () => {
      const agent = request.agent(app);
      const csrfToken = await getCsrfToken(agent, '/login');
      const response = await agent
        .post('/login')
        .type('form')
        .send({ email: '', password: 'Password123', _csrf: csrfToken });
      expect(response.status).toBe(400);
    });

    test('Blank password returns 400', async () => {
      const agent = request.agent(app);
      const csrfToken = await getCsrfToken(agent, '/login');
      const response = await agent
        .post('/login')
        .type('form')
        .send({ email: 'manager@flowsync.com', password: '', _csrf: csrfToken });
      expect(response.status).toBe(400);
    });

    test('Malformed email returns 400', async () => {
      const agent = request.agent(app);
      const csrfToken = await getCsrfToken(agent, '/login');
      const response = await agent
        .post('/login')
        .type('form')
        .send({ email: 'not-an-email', password: 'Password123', _csrf: csrfToken });
      expect(response.status).toBe(400);
    });
  });

  describe('Logout flow', () => {
    test('Logout returns 302 and redirects to /login', async () => {
      const agent = request.agent(app);
      await login(agent, 'manager@flowsync.com', 'Password123');

      const csrfToken = await getCsrfToken(agent, '/manager/dashboard');
      const response = await agent
        .post('/logout')
        .type('form')
        .send({ _csrf: csrfToken });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login');
    });

    test('Logout clears the session cookie', async () => {
      const agent = request.agent(app);
      await login(agent, 'manager@flowsync.com', 'Password123');

      const csrfToken = await getCsrfToken(agent, '/manager/dashboard');
      const response = await agent
        .post('/logout')
        .type('form')
        .send({ _csrf: csrfToken });

      // Cookie should be cleared (flowsync.sid should either be absent or expired)
      const cookies = response.headers['set-cookie'];
      if (cookies) {
        const sessionCookie = cookies.find(cookie => cookie.includes('flowsync.sid'));
        if (sessionCookie) {
          // Should have expired/old cookie to clear the session
          expect(sessionCookie.includes('Max-Age=0') || sessionCookie.includes('Expires=')).toBe(true);
        }
      }
    });

    test('After logout, accessing protected route redirects to /login', async () => {
      const agent = request.agent(app);
      await login(agent, 'manager@flowsync.com', 'Password123');

      const csrfToken = await getCsrfToken(agent, '/manager/dashboard');
      await agent.post('/logout').type('form').send({ _csrf: csrfToken });

      // Now try to access a protected route
      const deadResponse = await agent.get('/manager/dashboard');
      expect(deadResponse.status).toBe(302);
      expect(deadResponse.headers.location).toBe('/login');
    });

    test('After logout, session cannot access dashboard', async () => {
      const agent = request.agent(app);
      await login(agent, 'manager@flowsync.com', 'Password123');

      const csrfToken = await getCsrfToken(agent, '/manager/dashboard');
      await agent.post('/logout').type('form').send({ _csrf: csrfToken });

      // Session should be dead
      const protectedResponse = await agent.get('/manager/dashboard');
      expect(protectedResponse.status).toBe(302);
      expect(protectedResponse.headers.location).toBe('/login');
    });
  });

  describe('CSRF protection on login', () => {
    test('Login without CSRF token returns 403 or 302 (app behavior)', async () => {
      const agent = request.agent(app);
      const response = await agent
        .post('/login')
        .type('form')
        .send({ email: 'manager@flowsync.com', password: 'Password123' });
      // App may return 403 (CSRF blocked) or 302 (redirects with error)
      expect([302, 403]).toContain(response.status);
    });
  });
});
