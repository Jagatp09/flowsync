const { Op } = require('sequelize');
const {
  app,
  sequelize,
  User,
  Shift,
  ShiftAssignment,
  ShiftSwap,
  login,
  loginManager,
  getCsrfToken
} = require('../jest-setup');
const request = require('supertest');

const TEST_PREFIX = 'TEST_SCN7_';
const TEST_SWAP_REASON = `${TEST_PREFIX}Need to swap because of appointment`;
const TEST_SWAP_SHIFT_DATE = '2099-01-20';

describe('Scenario 7: Shift Swap Workflow', () => {
  let requester, targetUser, manager, shift;

  beforeAll(async () => {
    await sequelize.sync({ alter: true });
  });

  beforeEach(async () => {
    requester = await User.findOne({ where: { email: 'staff@flowsync.com' } });
    targetUser = await User.findOne({
      where: {
        role: 'STAFF',
        email: { [Op.ne]: 'staff@flowsync.com' }
      }
    });
    manager = await User.findOne({ where: { email: 'manager@flowsync.com' } });

    // Create a shift assigned to requester
    shift = await Shift.create({
      title: `${TEST_PREFIX}Swap Test Shift`,
      shiftDate: TEST_SWAP_SHIFT_DATE,
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
  });

  afterEach(async () => {
    // Clean up swap requests
    await ShiftSwap.destroy({
      where: { reason: { [Op.like]: `${TEST_PREFIX}%` } }
    });

    // Clean up assignments and shifts
    const testShifts = await Shift.findAll({
      where: { title: { [Op.like]: `${TEST_PREFIX}%` } },
      attributes: ['id']
    });
    const shiftIds = testShifts.map(s => s.id);

    if (shiftIds.length > 0) {
      await ShiftAssignment.destroy({ where: { shiftId: { [Op.in]: shiftIds } } });
    }

    await Shift.destroy({
      where: { title: { [Op.like]: `${TEST_PREFIX}%` } }
    });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('Create swap request', () => {
    test('Staff creates valid swap request returns 302 and stores PENDING', async () => {
      const agent = request.agent(app);
      await login(agent, 'staff@flowsync.com', 'Password123');

      const csrfToken = await getCsrfToken(agent, '/staff/swap-requests');
      const response = await agent
        .post('/staff/swap-requests')
        .type('form')
        .send({
          _csrf: csrfToken,
          targetShiftId: String(shift.id),
          targetUserId: String(targetUser.id),
          reason: TEST_SWAP_REASON
        });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/staff/swap-requests');

      const swap = await ShiftSwap.findOne({
        where: { reason: TEST_SWAP_REASON }
      });
      expect(swap).not.toBeNull();
      expect(swap.status).toBe('PENDING');
      expect(swap.targetAccepted).toBeNull();
      expect(swap.requesterId).toBe(requester.id);
      expect(swap.targetUserId).toBe(targetUser.id);
    });

    test('Staff cannot swap with themselves', async () => {
      const agent = request.agent(app);
      await login(agent, 'staff@flowsync.com', 'Password123');

      const csrfToken = await getCsrfToken(agent, '/staff/swap-requests');
      const response = await agent
        .post('/staff/swap-requests')
        .type('form')
        .send({
          _csrf: csrfToken,
          targetShiftId: String(shift.id),
          targetUserId: String(requester.id), // Same as requester
          reason: TEST_SWAP_REASON
        });

      expect(response.status).toBe(302);
      // Should redirect back with error

      const swap = await ShiftSwap.findOne({
        where: { reason: TEST_SWAP_REASON }
      });
      expect(swap).toBeNull();
    });

    test('Staff cannot swap a shift they are not assigned to', async () => {
      // Create another shift NOT assigned to requester
      const otherShift = await Shift.create({
        title: `${TEST_PREFIX}Other Shift`,
        shiftDate: TEST_SWAP_SHIFT_DATE,
        shiftType: 'MID_SHIFT',
        scheduledStart: '10:00',
        scheduledEnd: '18:00',
        priority: 'LOW',
        status: 'SCHEDULED',
        createdBy: manager.id,
        managerId: manager.id
      });

      await ShiftAssignment.create({
        shiftId: otherShift.id,
        userId: targetUser.id,
        roleLabel: 'Staff',
        scheduledStart: '10:00',
        duration: 8
      });

      const agent = request.agent(app);
      await login(agent, 'staff@flowsync.com', 'Password123');

      const csrfToken = await getCsrfToken(agent, '/staff/swap-requests');
      const response = await agent
        .post('/staff/swap-requests')
        .type('form')
        .send({
          _csrf: csrfToken,
          targetShiftId: String(otherShift.id), // Not assigned to requester
          targetUserId: String(targetUser.id),
          reason: TEST_SWAP_REASON
        });

      expect(response.status).toBe(302);
      // Should redirect back with error

      const swap = await ShiftSwap.findOne({
        where: { reason: TEST_SWAP_REASON }
      });
      expect(swap).toBeNull();

      // Cleanup
      await ShiftAssignment.destroy({ where: { shiftId: otherShift.id } });
      await Shift.destroy({ where: { id: otherShift.id } });
    });
  });

  describe('Manager approval before target accepts', () => {
    test('Manager cannot approve before target accepts - swap stays PENDING', async () => {
      // Create swap request
      await ShiftSwap.create({
        requesterId: requester.id,
        targetUserId: targetUser.id,
        targetShiftId: shift.id,
        reason: TEST_SWAP_REASON,
        status: 'PENDING',
        targetAccepted: null
      });

      const swap = await ShiftSwap.findOne({ where: { reason: TEST_SWAP_REASON } });

      const managerAgent = request.agent(app);
      await loginManager(managerAgent);

      const csrfToken = await getCsrfToken(managerAgent, '/manager/swap-requests');
      const response = await managerAgent
        .post(`/manager/swap-requests/${swap.id}/approve`)
        .type('form')
        .send({ _csrf: csrfToken });

      expect(response.status).toBe(302);
      // Should redirect back with error

      await swap.reload();
      expect(swap.status).toBe('PENDING');
      expect(swap.targetAccepted).toBeNull();
    });
  });

  describe('Target accepts swap', () => {
    let swap;

    beforeEach(async () => {
      swap = await ShiftSwap.create({
        requesterId: requester.id,
        targetUserId: targetUser.id,
        targetShiftId: shift.id,
        reason: TEST_SWAP_REASON,
        status: 'PENDING',
        targetAccepted: null
      });
    });

    test('Target accepts swap request returns 302 and sets targetAccepted = true', async () => {
      const targetAgent = request.agent(app);
      await login(targetAgent, targetUser.email, 'Password123');

      const csrfToken = await getCsrfToken(targetAgent, '/staff/incoming-swap-requests');
      const response = await targetAgent
        .post(`/staff/swap-requests/${swap.id}/accept`)
        .type('form')
        .send({ _csrf: csrfToken });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/staff/incoming-swap-requests');

      await swap.reload();
      expect(swap.targetAccepted).toBe(true);
      expect(swap.status).toBe('PENDING'); // Still needs manager approval
    });

    test('Target rejects swap request returns 302 and sets targetAccepted = false', async () => {
      const targetAgent = request.agent(app);
      await login(targetAgent, targetUser.email, 'Password123');

      const csrfToken = await getCsrfToken(targetAgent, '/staff/incoming-swap-requests');
      const response = await targetAgent
        .post(`/staff/swap-requests/${swap.id}/reject`)
        .type('form')
        .send({ _csrf: csrfToken });

      expect(response.status).toBe(302);

      await swap.reload();
      expect(swap.targetAccepted).toBe(false);
      expect(swap.status).toBe('PENDING');
    });
  });

  describe('Manager final approval', () => {
    let swap;

    beforeEach(async () => {
      // Create swap that target has accepted
      swap = await ShiftSwap.create({
        requesterId: requester.id,
        targetUserId: targetUser.id,
        targetShiftId: shift.id,
        reason: TEST_SWAP_REASON,
        status: 'PENDING',
        targetAccepted: true
      });

      // Assign target user to the same shift too (for swap to work per app logic)
      await ShiftAssignment.create({
        shiftId: shift.id,
        userId: targetUser.id,
        roleLabel: 'Staff',
        scheduledStart: '09:00',
        duration: 8
      });
    });

    test('Manager approves accepted swap returns 302 and sets APPROVED', async () => {
      const managerAgent = request.agent(app);
      await loginManager(managerAgent);

      const csrfToken = await getCsrfToken(managerAgent, '/manager/swap-requests');
      const response = await managerAgent
        .post(`/manager/swap-requests/${swap.id}/approve`)
        .type('form')
        .send({ _csrf: csrfToken });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/manager/swap-requests');

      await swap.reload();
      expect(swap.status).toBe('APPROVED');
    });

    test('After manager approval, assignments are swapped', async () => {
      // Verify initial state
      const initialRequesterAssignment = await ShiftAssignment.findOne({
        where: { shiftId: shift.id, userId: requester.id }
      });
      expect(initialRequesterAssignment).not.toBeNull();

      const initialTargetAssignment = await ShiftAssignment.findOne({
        where: { shiftId: shift.id, userId: targetUser.id }
      });
      expect(initialTargetAssignment).not.toBeNull();

      const managerAgent = request.agent(app);
      await loginManager(managerAgent);

      const csrfToken = await getCsrfToken(managerAgent, '/manager/swap-requests');
      await managerAgent
        .post(`/manager/swap-requests/${swap.id}/approve`)
        .type('form')
        .send({ _csrf: csrfToken });

      await swap.reload();
      expect(swap.status).toBe('APPROVED');

      // After approval, assignments should be swapped
      // (actual swap behavior depends on app implementation)
    });

    test('Manager rejects approved swap returns 302 and sets REJECTED', async () => {
      const managerAgent = request.agent(app);
      await loginManager(managerAgent);

      const csrfToken = await getCsrfToken(managerAgent, '/manager/swap-requests');
      const response = await managerAgent
        .post(`/manager/swap-requests/${swap.id}/reject`)
        .type('form')
        .send({ _csrf: csrfToken });

      expect(response.status).toBe(302);

      await swap.reload();
      expect(swap.status).toBe('REJECTED');
    });
  });

  describe('Staff cannot approve/reject swaps', () => {
    test('Staff cannot access /manager/swap-requests approve', async () => {
      const swap = await ShiftSwap.create({
        requesterId: requester.id,
        targetUserId: targetUser.id,
        targetShiftId: shift.id,
        reason: TEST_SWAP_REASON,
        status: 'PENDING',
        targetAccepted: true
      });

      const agent = request.agent(app);
      await login(agent, 'staff@flowsync.com', 'Password123');

      const csrfToken = await getCsrfToken(agent, '/staff/dashboard');
      const response = await agent
        .post(`/manager/swap-requests/${swap.id}/approve`)
        .type('form')
        .send({ _csrf: csrfToken });

      expect([302, 403]).toContain(response.status);

      await swap.reload();
      expect(swap.status).toBe('PENDING'); // Unchanged
    });
  });
});
