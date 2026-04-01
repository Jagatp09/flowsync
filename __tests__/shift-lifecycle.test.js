const { Op } = require('sequelize');
const {
  app,
  sequelize,
  User,
  Shift,
  ShiftAssignment,
  Checklist,
  ChecklistItem,
  ChecklistCompletion,
  login,
  loginManager,
  loginStaff,
  getCsrfToken
} = require('../jest-setup');
const request = require('supertest');

const TEST_PREFIX = 'TEST_SCN5_';
const TEST_SHIFT_DATE = new Date().toISOString().split('T')[0]; // Today
const TEST_SHIFT_TITLE_STAFF_A = `${TEST_PREFIX}StaffA Shift`;
const TEST_SHIFT_TITLE_STAFF_B = `${TEST_PREFIX}StaffB Shift`;

describe('Scenario 5: Shift Lifecycle and Checklist Execution', () => {
  let manager, staffA, staffB, shiftA, shiftB, morningItem;

  beforeAll(async () => {
    await sequelize.sync({ alter: true });
  });

  beforeEach(async () => {
    manager = await User.findOne({ where: { email: 'manager@flowsync.com' } });
    staffA = await User.findOne({ where: { email: 'staff@flowsync.com' } });

    // Find a staff member NOT staff@flowsync.com for unassigned tests
    staffB = await User.findOne({
      where: {
        role: 'STAFF',
        email: { [Op.ne]: 'staff@flowsync.com' }
      }
    });

    // Find a morning checklist item
    morningItem = await ChecklistItem.findOne({
      include: [{
        model: Checklist,
        as: 'Checklist',
        where: { shiftType: 'MORNING' }
      }]
    });

    // Create an OPENING shift assigned to Staff A for today
    shiftA = await Shift.create({
      title: TEST_SHIFT_TITLE_STAFF_A,
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
      shiftId: shiftA.id,
      userId: staffA.id,
      roleLabel: 'Staff',
      scheduledStart: '09:00',
      duration: 8
    });
  });

  afterEach(async () => {
    // Clean up assignments first
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

    // Clean up checklist completions for test items
    if (morningItem) {
      await ChecklistCompletion.destroy({
        where: { checklistItemId: morningItem.id }
      });
    }
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('Shift lifecycle', () => {
    test('Manager starts a scheduled shift returns 302 and sets status to ACTIVE', async () => {
      const agent = request.agent(app);
      await loginManager(agent);

      const csrfToken = await getCsrfToken(agent, '/manager/shifts');
      const response = await agent
        .post(`/manager/shifts/${shiftA.id}/start`)
        .type('form')
        .send({ _csrf: csrfToken });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/manager/shifts');

      await shiftA.reload();
      expect(shiftA.status).toBe('ACTIVE');
      expect(shiftA.startedAt).not.toBeNull();
    });

    test('Manager closes an active shift returns 302 and sets status to CLOSED', async () => {
      // First start the shift
      await shiftA.update({ status: 'ACTIVE', startedAt: new Date() });

      const agent = request.agent(app);
      await loginManager(agent);

      const csrfToken = await getCsrfToken(agent, '/manager/shifts');
      const response = await agent
        .post(`/manager/shifts/${shiftA.id}/close`)
        .type('form')
        .send({ _csrf: csrfToken });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/manager/shifts');

      await shiftA.reload();
      expect(shiftA.status).toBe('CLOSED');
      expect(shiftA.endedAt).not.toBeNull();
    });

    test('Staff cannot start a shift', async () => {
      const agent = request.agent(app);
      await loginStaff(agent);

      const csrfToken = await getCsrfToken(agent, '/staff/dashboard');
      const response = await agent
        .post(`/manager/shifts/${shiftA.id}/start`)
        .type('form')
        .send({ _csrf: csrfToken });

      expect([302, 403]).toContain(response.status);

      await shiftA.reload();
      expect(shiftA.status).toBe('SCHEDULED'); // Unchanged
    });

    test('Staff cannot close a shift', async () => {
      await shiftA.update({ status: 'ACTIVE', startedAt: new Date() });

      const agent = request.agent(app);
      await loginStaff(agent);

      const csrfToken = await getCsrfToken(agent, '/staff/dashboard');
      const response = await agent
        .post(`/manager/shifts/${shiftA.id}/close`)
        .type('form')
        .send({ _csrf: csrfToken });

      expect([302, 403]).toContain(response.status);

      await shiftA.reload();
      expect(shiftA.status).toBe('ACTIVE'); // Unchanged
    });
  });

  describe('Checklist completion', () => {
    test('Assigned staff can complete a checklist item returns 302 and creates completion record', async () => {
      expect(morningItem).not.toBeNull();

      const agent = request.agent(app);
      await login(agent, staffA.email, 'Password123');

      const csrfToken = await getCsrfToken(agent, '/checklists/daily');
      const response = await agent
        .post(`/checklists/items/${morningItem.id}/complete`)
        .type('form')
        .send({
          _csrf: csrfToken,
          status: 'COMPLETED',
          notes: 'Test completion'
        });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/checklists/daily');

      // Verify completion record
      const completion = await ChecklistCompletion.findOne({
        where: {
          checklistItemId: morningItem.id,
          userId: staffA.id,
          date: TEST_SHIFT_DATE
        }
      });
      expect(completion).not.toBeNull();
      expect(completion.status).toBe('COMPLETED');
    });

    test('Assigned staff can undo a completed checklist item returns 302 and resets to PENDING', async () => {
      expect(morningItem).not.toBeNull();

      // First complete it
      await ChecklistCompletion.create({
        checklistItemId: morningItem.id,
        userId: staffA.id,
        date: TEST_SHIFT_DATE,
        status: 'COMPLETED',
        notes: 'Initially completed'
      });

      const agent = request.agent(app);
      await login(agent, staffA.email, 'Password123');

      const csrfToken = await getCsrfToken(agent, '/checklists/daily');
      const response = await agent
        .post(`/checklists/items/${morningItem.id}/undo`)
        .type('form')
        .send({ _csrf: csrfToken });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/checklists/daily');

      // Verify completion reset
      const completion = await ChecklistCompletion.findOne({
        where: {
          checklistItemId: morningItem.id,
          userId: staffA.id,
          date: TEST_SHIFT_DATE
        }
      });
      expect(completion).not.toBeNull();
      expect(completion.status).toBe('PENDING');
    });

    test('Unassigned staff cannot complete a checklist item returns 302 and no record created', async () => {
      expect(morningItem).not.toBeNull();
      expect(staffB).not.toBeNull();

      const agent = request.agent(app);
      await login(agent, staffB.email, 'Password123');

      const csrfToken = await getCsrfToken(agent, '/checklists/daily');
      const response = await agent
        .post(`/checklists/items/${morningItem.id}/complete`)
        .type('form')
        .send({
          _csrf: csrfToken,
          status: 'COMPLETED',
          notes: 'Should be blocked'
        });

      // Should redirect back with error
      expect(response.status).toBe(302);

      // Verify no completion record for unassigned staff
      const completion = await ChecklistCompletion.findOne({
        where: {
          checklistItemId: morningItem.id,
          userId: staffB.id,
          date: TEST_SHIFT_DATE
        }
      });
      expect(completion).toBeNull();
    });

    test('Unassigned staff cannot undo a checklist item', async () => {
      expect(morningItem).not.toBeNull();
      expect(staffB).not.toBeNull();

      const agent = request.agent(app);
      await login(agent, staffB.email, 'Password123');

      const csrfToken = await getCsrfToken(agent, '/checklists/daily');
      const response = await agent
        .post(`/checklists/items/${morningItem.id}/undo`)
        .type('form')
        .send({ _csrf: csrfToken });

      expect(response.status).toBe(302);
    });
  });

  describe('Manager assignment during shift', () => {
    test('Manager can assign additional staff to existing shift', async () => {
      expect(staffB).not.toBeNull();

      const agent = request.agent(app);
      await loginManager(agent);

      const csrfToken = await getCsrfToken(agent, `/manager/shifts/${shiftA.id}`);
      const response = await agent
        .post(`/manager/shifts/${shiftA.id}/assign`)
        .type('form')
        .send({
          _csrf: csrfToken,
          userId: String(staffB.id),
          roleLabel: 'Staff'
        });

      expect(response.status).toBe(302);

      // Verify both assignments exist
      const assignments = await ShiftAssignment.findAll({
        where: { shiftId: shiftA.id }
      });
      expect(assignments.length).toBe(2);
    });

    test('Manager cannot assign staff already on shift (duplicate)', async () => {
      const agent = request.agent(app);
      await loginManager(agent);

      // Try to assign staffA again (already assigned in beforeEach)
      const csrfToken = await getCsrfToken(agent, `/manager/shifts/${shiftA.id}`);
      const response = await agent
        .post(`/manager/shifts/${shiftA.id}/assign`)
        .type('form')
        .send({
          _csrf: csrfToken,
          userId: String(staffA.id),
          roleLabel: 'Staff'
        });

      expect(response.status).toBe(302);
      // Should redirect back with error
    });
  });
});
