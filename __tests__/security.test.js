process.env.NODE_ENV = 'test';

const request = require('supertest');
const { Op } = require('sequelize');
const { app } = require('../index');
const {
  Checklist,
  sequelize,
  ChecklistItem,
  ChecklistCompletion,
  LeaveRequest,
  Shift,
  ShiftAssignment,
  ShiftSwap,
  User
} = require('../models');

const TEST_SHIFT_DATE = '2099-01-01';
const TEST_EXISTING_SHIFT_TITLE = 'Overlap Existing Test Shift';
const TEST_NEW_SHIFT_TITLE = 'Overlap Candidate Test Shift';
const TEST_SWAP_SHIFT_TITLE = 'Swap Request Test Shift';
const TEST_SWAP_REASON = 'Need to swap because of a personal appointment';
const TEST_LEAVE_REASON = 'Family event coverage';

function extractCsrfToken(html) {
  const match = html.match(/<meta name="csrf-token" content="([^"]+)">/);
  if (!match) {
    throw new Error('CSRF token not found in response HTML');
  }

  return match[1];
}

async function getCsrfToken(agent, path) {
  const response = await agent.get(path);
  return extractCsrfToken(response.text);
}

async function login(agent, email, password) {
  const csrfToken = await getCsrfToken(agent, '/login');
  return agent
    .post('/login')
    .type('form')
    .send({ email, password, _csrf: csrfToken });
}

describe('FlowSync security regressions', () => {
  beforeAll(async () => {
    await sequelize.sync({ alter: true });
  });

  afterEach(async () => {
    const testShiftIds = (await Shift.findAll({
      where: {
        title: {
          [Op.in]: [TEST_EXISTING_SHIFT_TITLE, TEST_NEW_SHIFT_TITLE, TEST_SWAP_SHIFT_TITLE]
        }
      },
      attributes: ['id']
    })).map((shift) => shift.id);

    if (testShiftIds.length > 0) {
      await ShiftAssignment.destroy({
        where: {
          shiftId: {
            [Op.in]: testShiftIds
          }
        }
      });
    }

    await ShiftSwap.destroy({
      where: {
        reason: TEST_SWAP_REASON
      }
    });

    await LeaveRequest.destroy({
      where: {
        reason: TEST_LEAVE_REASON
      }
    });

    await Shift.destroy({
      where: {
        title: {
          [Op.in]: [TEST_EXISTING_SHIFT_TITLE, TEST_NEW_SHIFT_TITLE, TEST_SWAP_SHIFT_TITLE]
        }
      }
    });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  test('login succeeds for a valid manager account', async () => {
    const agent = request.agent(app);

    const response = await login(agent, 'manager@flowsync.com', 'Password123');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/manager/dashboard');
  });

  test('login fails for invalid credentials', async () => {
    const agent = request.agent(app);

    const response = await login(agent, 'manager@flowsync.com', 'wrong-password');

    expect(response.status).toBe(401);
    expect(response.text).toContain('Invalid email or password');
  });

  test('protected dashboards redirect unauthenticated users to login', async () => {
    await request(app).get('/manager/dashboard').expect(302).expect('Location', '/login');
    await request(app).get('/staff/dashboard').expect(302).expect('Location', '/login');
  });

  test('manager-only routes block staff users', async () => {
    const agent = request.agent(app);
    await login(agent, 'staff@flowsync.com', 'Password123');

    const response = await agent.get('/manager/staff');

    expect([302, 403]).toContain(response.status);
    expect(response.headers.location).toBe('/staff/dashboard');
  });

  test('shift creation rejects invalid input', async () => {
    const agent = request.agent(app);
    await login(agent, 'manager@flowsync.com', 'Password123');

    const csrfToken = await getCsrfToken(agent, '/manager/shifts/new');
    const response = await agent
      .post('/manager/shifts')
      .type('form')
      .send({
        _csrf: csrfToken,
        title: 'Invalid Shift',
        shiftDate: 'not-a-date',
        shiftType: 'OPENING',
        priority: 'MEDIUM'
      });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/manager/shifts/new');
  });

  test('shift creation prevents overlapping assignments for the same staff member', async () => {
    const manager = await User.findOne({ where: { email: 'manager@flowsync.com' } });
    const staffMember = await User.findOne({ where: { email: 'staff@flowsync.com' } });

    const existingShift = await Shift.create({
      title: TEST_EXISTING_SHIFT_TITLE,
      shiftDate: TEST_SHIFT_DATE,
      shiftType: 'OPENING',
      scheduledStart: '09:00',
      scheduledEnd: '17:00',
      priority: 'MEDIUM',
      status: 'SCHEDULED',
      createdBy: manager.id,
      managerId: manager.id
    });

    await ShiftAssignment.create({
      shiftId: existingShift.id,
      userId: staffMember.id,
      roleLabel: 'Staff',
      scheduledStart: '09:00',
      duration: 8
    });

    const agent = request.agent(app);
    await login(agent, 'manager@flowsync.com', 'Password123');
    const csrfToken = await getCsrfToken(agent, '/manager/shifts/new');

    const response = await agent
      .post('/manager/shifts')
      .type('form')
      .send({
        _csrf: csrfToken,
        title: TEST_NEW_SHIFT_TITLE,
        shiftDate: TEST_SHIFT_DATE,
        shiftType: 'MID_SHIFT',
        scheduledStart: '10:00',
        scheduledEnd: '14:00',
        priority: 'HIGH',
        staffIds: [String(staffMember.id)],
        staffStartTimes: ['10:00'],
        staffDurations: ['4']
      });

    const createdShift = await Shift.findOne({ where: { title: TEST_NEW_SHIFT_TITLE } });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/manager/shifts/new');
    expect(createdShift).toBeNull();
  });

  test('staff cannot complete checklist items for shifts they are not assigned to', async () => {
    const today = new Date().toISOString().split('T')[0];
    const openingAssignments = await ShiftAssignment.findAll({
      include: [{
        model: Shift,
        as: 'Shift',
        required: true,
        where: { shiftDate: today, shiftType: 'OPENING' }
      }]
    });
    const openingUserIds = openingAssignments.map((assignment) => assignment.userId);
    const unauthorizedUser = await User.findOne({
      where: {
        role: 'STAFF',
        id: { [Op.notIn]: openingUserIds }
      }
    });
    const morningItem = await ChecklistItem.findOne({
      include: [{
        model: Checklist,
        where: { shiftType: 'MORNING' }
      }]
    });

    expect(unauthorizedUser).toBeTruthy();
    expect(morningItem).toBeTruthy();

    const agent = request.agent(app);
    await login(agent, unauthorizedUser.email, 'Password123');
    const csrfToken = await getCsrfToken(agent, '/checklists/daily');

    const response = await agent
      .post(`/checklists/items/${morningItem.id}/complete`)
      .type('form')
      .send({
        _csrf: csrfToken,
        status: 'COMPLETED',
        notes: 'Should be blocked'
      });

    const completion = await ChecklistCompletion.findOne({
      where: {
        checklistItemId: morningItem.id,
        userId: unauthorizedUser.id,
        date: today
      }
    });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/checklists/daily');
    expect(completion).toBeNull();
  });

  test('logout clears the authenticated session', async () => {
    const agent = request.agent(app);
    await login(agent, 'manager@flowsync.com', 'Password123');

    const csrfToken = await getCsrfToken(agent, '/manager/dashboard');
    const logoutResponse = await agent
      .post('/logout')
      .type('form')
      .send({ _csrf: csrfToken });

    expect(logoutResponse.status).toBe(302);
    expect(logoutResponse.headers.location).toBe('/login');

    const protectedResponse = await agent.get('/manager/dashboard');
    expect(protectedResponse.status).toBe(302);
    expect(protectedResponse.headers.location).toBe('/login');
  });

  test('staff can submit a valid leave request', async () => {
    const agent = request.agent(app);
    await login(agent, 'staff@flowsync.com', 'Password123');

    const csrfToken = await getCsrfToken(agent, '/staff/leave-requests');
    const response = await agent
      .post('/staff/leave-requests')
      .type('form')
      .send({
        _csrf: csrfToken,
        leaveType: 'PERSONAL',
        startDate: '2099-02-01',
        endDate: '2099-02-02',
        reason: TEST_LEAVE_REASON
      });

    const leaveRequest = await LeaveRequest.findOne({
      where: {
        reason: TEST_LEAVE_REASON
      }
    });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/staff/leave-requests');
    expect(leaveRequest).toBeTruthy();
    expect(leaveRequest.status).toBe('PENDING');
  });

  test('staff can create and respond to a shift swap request within the current workflow', async () => {
    const requester = await User.findOne({ where: { email: 'staff@flowsync.com' } });
    const targetUser = await User.findOne({
      where: {
        role: 'STAFF',
        email: { [Op.ne]: 'staff@flowsync.com' }
      }
    });
    const manager = await User.findOne({ where: { email: 'manager@flowsync.com' } });

    expect(requester).toBeTruthy();
    expect(targetUser).toBeTruthy();

    const shift = await Shift.create({
      title: TEST_SWAP_SHIFT_TITLE,
      shiftDate: TEST_SHIFT_DATE,
      shiftType: 'OPENING',
      scheduledStart: '09:00',
      scheduledEnd: '17:00',
      priority: 'MEDIUM',
      status: 'SCHEDULED',
      createdBy: manager.id,
      managerId: manager.id
    });

    await ShiftAssignment.create({
      shiftId: shift.id,
      userId: requester.id,
      roleLabel: 'Staff',
      scheduledStart: '09:00',
      duration: 8
    });

    const requesterAgent = request.agent(app);
    await login(requesterAgent, 'staff@flowsync.com', 'Password123');
    const createCsrfToken = await getCsrfToken(requesterAgent, '/staff/swap-requests');

    const createResponse = await requesterAgent
      .post('/staff/swap-requests')
      .type('form')
      .send({
        _csrf: createCsrfToken,
        targetShiftId: String(shift.id),
        targetUserId: String(targetUser.id),
        reason: TEST_SWAP_REASON
      });

    const createdSwap = await ShiftSwap.findOne({
      where: {
        requesterId: requester.id,
        targetUserId: targetUser.id,
        reason: TEST_SWAP_REASON
      }
    });

    expect(createResponse.status).toBe(302);
    expect(createResponse.headers.location).toBe('/staff/swap-requests');
    expect(createdSwap).toBeTruthy();

    const targetAgent = request.agent(app);
    await login(targetAgent, targetUser.email, 'Password123');
    const acceptCsrfToken = await getCsrfToken(targetAgent, '/staff/incoming-swap-requests');

    const acceptResponse = await targetAgent
      .post(`/staff/swap-requests/${createdSwap.id}/accept`)
      .type('form')
      .send({ _csrf: acceptCsrfToken });

    await createdSwap.reload();

    expect(acceptResponse.status).toBe(302);
    expect(acceptResponse.headers.location).toBe('/staff/incoming-swap-requests');
    expect(createdSwap.targetAccepted).toBe(true);
    expect(createdSwap.status).toBe('PENDING');
  });
});
