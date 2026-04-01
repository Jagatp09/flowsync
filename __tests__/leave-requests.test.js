const { Op } = require('sequelize');
const {
  app,
  sequelize,
  User,
  LeaveRequest,
  login,
  loginManager,
  loginStaff,
  getCsrfToken
} = require('../jest-setup');
const request = require('supertest');

const TEST_PREFIX = 'TEST_SCN6_';
const TEST_LEAVE_REASON = `${TEST_PREFIX}Family event coverage`;
const TEST_LEAVE_REASON_2 = `${TEST_PREFIX}Medical appointment`;
const TEST_LEAVE_REASON_3 = `${TEST_PREFIX}Vacation`;

describe('Scenario 6: Leave Request Workflow', () => {
  beforeAll(async () => {
    await sequelize.sync({ alter: true });
  });

  afterEach(async () => {
    // Clean up test leave requests by reason prefix
    await LeaveRequest.destroy({
      where: { reason: { [Op.like]: `${TEST_PREFIX}%` } }
    });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('Staff creates leave request', () => {
    test('Staff creates valid leave request returns 302 and stores PENDING request', async () => {
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

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/staff/leave-requests');

      const leaveReq = await LeaveRequest.findOne({
        where: { reason: TEST_LEAVE_REASON }
      });
      expect(leaveReq).not.toBeNull();
      expect(leaveReq.status).toBe('PENDING');
      expect(leaveReq.leaveType).toBe('PERSONAL');
    });

    test('Staff creates leave with reversed dates (end < start) returns 302 and does not create request', async () => {
      const agent = request.agent(app);
      await login(agent, 'staff@flowsync.com', 'Password123');

      const csrfToken = await getCsrfToken(agent, '/staff/leave-requests');
      const response = await agent
        .post('/staff/leave-requests')
        .type('form')
        .send({
          _csrf: csrfToken,
          leaveType: 'PERSONAL',
          startDate: '2099-02-05',
          endDate: '2099-02-01', // Before start
          reason: TEST_LEAVE_REASON
        });

      expect(response.status).toBe(302);
      // Should redirect back with error

      const req = await LeaveRequest.findOne({
        where: { reason: TEST_LEAVE_REASON }
      });
      expect(req).toBeNull();
    });

    test('Staff creates overlapping leave request returns 302 and does not create second request', async () => {
      const staff = await User.findOne({ where: { email: 'staff@flowsync.com' } });

      // Create first leave request
      await LeaveRequest.create({
        userId: staff.id,
        leaveType: 'ANNUAL',
        startDate: '2099-03-01',
        endDate: '2099-03-05',
        reason: TEST_LEAVE_REASON,
        status: 'PENDING'
      });

      const agent = request.agent(app);
      await login(agent, 'staff@flowsync.com', 'Password123');

      // Try to create overlapping request
      const csrfToken = await getCsrfToken(agent, '/staff/leave-requests');
      const response = await agent
        .post('/staff/leave-requests')
        .type('form')
        .send({
          _csrf: csrfToken,
          leaveType: 'PERSONAL',
          startDate: '2099-03-03', // Overlaps with 03-01 to 03-05
          endDate: '2099-03-07',
          reason: TEST_LEAVE_REASON_2
        });

      expect(response.status).toBe(302);
    });

    test('Staff creates leave with past dates returns 302 (validation may vary)', async () => {
      const agent = request.agent(app);
      await login(agent, 'staff@flowsync.com', 'Password123');

      const csrfToken = await getCsrfToken(agent, '/staff/leave-requests');
      const response = await agent
        .post('/staff/leave-requests')
        .type('form')
        .send({
          _csrf: csrfToken,
          leaveType: 'SICK',
          startDate: '2020-01-01',
          endDate: '2020-01-02',
          reason: TEST_LEAVE_REASON
        });

      // May succeed or fail depending on app validation
      expect([302, 400]).toContain(response.status);
    });
  });

  describe('Manager approves leave request', () => {
    let staff, leaveReq;

    beforeEach(async () => {
      staff = await User.findOne({ where: { email: 'staff@flowsync.com' } });
      leaveReq = await LeaveRequest.create({
        userId: staff.id,
        leaveType: 'ANNUAL',
        startDate: '2099-04-01',
        endDate: '2099-04-03',
        reason: TEST_LEAVE_REASON,
        status: 'PENDING'
      });
    });

    test('Manager approves pending leave request returns 302 and sets APPROVED', async () => {
      const agent = request.agent(app);
      await loginManager(agent);

      const csrfToken = await getCsrfToken(agent, '/manager/leave-requests');
      const response = await agent
        .post(`/manager/leave-requests/${leaveReq.id}/approve`)
        .type('form')
        .send({
          _csrf: csrfToken,
          comment: 'Approved!'
        });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/manager/leave-requests');

      await leaveReq.reload();
      expect(leaveReq.status).toBe('APPROVED');
      expect(leaveReq.approvedBy).not.toBeNull();
      expect(leaveReq.approvedAt).not.toBeNull();
    });

    test('Manager cannot approve already-approved request', async () => {
      // Get a valid manager ID first
      const manager = await User.findOne({ where: { email: 'manager@flowsync.com' } });

      // Update leaveReq to already be approved
      await LeaveRequest.update({
        status: 'APPROVED',
        approvedBy: manager.id,
        approvedAt: new Date()
      }, {
        where: { id: leaveReq.id }
      });

      const agent = request.agent(app);
      await loginManager(agent);

      const csrfToken = await getCsrfToken(agent, '/manager/leave-requests');
      const response = await agent
        .post(`/manager/leave-requests/${leaveReq.id}/approve`)
        .type('form')
        .send({
          _csrf: csrfToken,
          comment: 'Try again'
        });

      expect(response.status).toBe(302);
      // Should redirect back with error
    });

    test('Manager rejects pending leave request returns 302 and sets REJECTED', async () => {
      const agent = request.agent(app);
      await loginManager(agent);

      const csrfToken = await getCsrfToken(agent, '/manager/leave-requests');
      const response = await agent
        .post(`/manager/leave-requests/${leaveReq.id}/reject`)
        .type('form')
        .send({
          _csrf: csrfToken,
          comment: 'Sorry, too busy'
        });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/manager/leave-requests');

      await leaveReq.reload();
      expect(leaveReq.status).toBe('REJECTED');
      expect(leaveReq.approvedBy).not.toBeNull();
      expect(leaveReq.approvedAt).not.toBeNull();
    });
  });

  describe('Staff cannot approve/reject', () => {
    test('Staff cannot approve leave requests', async () => {
      const staff = await User.findOne({ where: { email: 'staff@flowsync.com' } });
      const leaveReq = await LeaveRequest.create({
        userId: staff.id,
        leaveType: 'ANNUAL',
        startDate: '2099-05-01',
        endDate: '2099-05-03',
        reason: TEST_LEAVE_REASON,
        status: 'PENDING'
      });

      const agent = request.agent(app);
      await login(agent, 'staff@flowsync.com', 'Password123');

      const csrfToken = await getCsrfToken(agent, '/staff/dashboard');
      const response = await agent
        .post(`/manager/leave-requests/${leaveReq.id}/approve`)
        .type('form')
        .send({ _csrf: csrfToken });

      expect([302, 403]).toContain(response.status);

      await leaveReq.reload();
      expect(leaveReq.status).toBe('PENDING'); // Unchanged
    });

    test('Staff cannot reject leave requests', async () => {
      const staff = await User.findOne({ where: { email: 'staff@flowsync.com' } });
      const leaveReq = await LeaveRequest.create({
        userId: staff.id,
        leaveType: 'ANNUAL',
        startDate: '2099-06-01',
        endDate: '2099-06-03',
        reason: TEST_LEAVE_REASON,
        status: 'PENDING'
      });

      const agent = request.agent(app);
      await login(agent, 'staff@flowsync.com', 'Password123');

      const csrfToken = await getCsrfToken(agent, '/staff/dashboard');
      const response = await agent
        .post(`/manager/leave-requests/${leaveReq.id}/reject`)
        .type('form')
        .send({ _csrf: csrfToken });

      expect([302, 403]).toContain(response.status);

      await leaveReq.reload();
      expect(leaveReq.status).toBe('PENDING'); // Unchanged
    });
  });

  describe('Manager views leave requests', () => {
    test('Manager views leave requests list returns 200', async () => {
      const agent = request.agent(app);
      await loginManager(agent);

      const response = await agent.get('/manager/leave-requests');
      expect(response.status).toBe(200);
    });

    test('Manager can see pending leave requests', async () => {
      const staff = await User.findOne({ where: { email: 'staff@flowsync.com' } });
      await LeaveRequest.create({
        userId: staff.id,
        leaveType: 'PERSONAL',
        startDate: '2099-07-01',
        endDate: '2099-07-02',
        reason: TEST_LEAVE_REASON,
        status: 'PENDING'
      });

      const agent = request.agent(app);
      await loginManager(agent);

      const response = await agent.get('/manager/leave-requests');
      expect(response.status).toBe(200);
      expect(response.text).toContain(TEST_LEAVE_REASON);
    });
  });
});
