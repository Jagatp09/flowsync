process.env.NODE_ENV = 'test';

const request = require('supertest');
const { app } = require('./index');
const {
  sequelize,
  User,
  Shift,
  ShiftAssignment,
  ShiftSwap,
  LeaveRequest,
  Checklist,
  ChecklistItem,
  ChecklistCompletion,
  InventoryItem,
  InventoryLog
} = require('./models');

/**
 * Extract CSRF token from HTML meta tag
 */
function extractCsrfToken(html) {
  const match = html.match(/<meta name="csrf-token" content="([^"]+)">/);
  if (!match) {
    throw new Error('CSRF token not found in response HTML');
  }
  return match[1];
}

/**
 * Fetch fresh CSRF token from a page
 */
async function getCsrfToken(agent, path) {
  const response = await agent.get(path);
  return extractCsrfToken(response.text);
}

/**
 * Standard login helper - fetches CSRF then POSTs credentials
 */
async function login(agent, email, password) {
  const csrfToken = await getCsrfToken(agent, '/login');
  return agent
    .post('/login')
    .type('form')
    .send({ email, password, _csrf: csrfToken });
}

/**
 * Login as manager
 */
async function loginManager(agent) {
  return login(agent, 'manager@flowsync.com', 'Password123');
}

/**
 * Login as staff (default: staff@flowsync.com)
 */
async function loginStaff(agent, email = 'staff@flowsync.com') {
  return login(agent, email, 'Password123');
}

/**
 * Prepare a form submission with fresh CSRF token
 * Returns object with agent, csrfToken, and submit function
 */
async function prepareFormSubmission(agent, path) {
  const csrfToken = await getCsrfToken(agent, path);
  return {
    agent,
    csrfToken,
    async submit(formData) {
      return agent
        .post(path)
        .type('form')
        .send({ ...formData, _csrf: csrfToken });
    }
  };
}

module.exports = {
  extractCsrfToken,
  getCsrfToken,
  login,
  loginManager,
  loginStaff,
  prepareFormSubmission,
  app,
  // Re-export models and sequelize for test files
  sequelize,
  User,
  Shift,
  ShiftAssignment,
  ShiftSwap,
  LeaveRequest,
  Checklist,
  ChecklistItem,
  ChecklistCompletion,
  InventoryItem,
  InventoryLog
};
