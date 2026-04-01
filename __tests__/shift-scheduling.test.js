const { Op } = require('sequelize');
const {
  app,
  sequelize,
  User,
  Shift,
  ShiftAssignment,
  loginManager,
  loginStaff,
  getCsrfToken
} = require('../jest-setup');
const request = require('supertest');

const TEST_PREFIX = 'TEST_SCN4_';
const TEST_SHIFT_DATE = '2099-01-15';
const TEST_SHIFT_TITLE = `${TEST_PREFIX}Valid Shift`;
const TEST_SHIFT_TITLE_2 = `${TEST_PREFIX}Overlap Existing`;
const TEST_SHIFT_TITLE_3 = `${TEST_PREFIX}Overlap Candidate`;

describe('Scenario 4: Shift Scheduling and Assignment Validation', () => {
  beforeAll(async () => {
    await sequelize.sync({ alter: true });
  });

  afterEach(async () => {
    // Clean up test shifts by title prefix
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

  describe('Create valid shift', () => {
    test('Manager creates valid shift returns 302 and creates shift + assignments in DB', async () => {
      const manager = await User.findOne({ where: { email: 'manager@flowsync.com' } });
      const staffMember = await User.findOne({ where: { email: 'staff@flowsync.com' } });

      const agent = request.agent(app);
      await loginManager(agent);

      const csrfToken = await getCsrfToken(agent, '/manager/shifts/new');
      const response = await agent
        .post('/manager/shifts')
        .type('form')
        .send({
          _csrf: csrfToken,
          title: TEST_SHIFT_TITLE,
          shiftDate: TEST_SHIFT_DATE,
          shiftType: 'OPENING',
          scheduledStart: '09:00',
          scheduledEnd: '17:00',
          priority: 'MEDIUM',
          staffIds: [String(staffMember.id)],
          staffStartTimes: ['09:00'],
          staffDurations: ['8']
        });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/manager/shifts');

      // Verify shift was created
      const createdShift = await Shift.findOne({ where: { title: TEST_SHIFT_TITLE } });
      expect(createdShift).not.toBeNull();
      expect(createdShift.status).toBe('SCHEDULED');
      expect(createdShift.shiftType).toBe('OPENING');

      // Verify assignment was created
      const assignment = await ShiftAssignment.findOne({
        where: { shiftId: createdShift.id, userId: staffMember.id }
      });
      expect(assignment).not.toBeNull();
      expect(assignment.roleLabel).toBe('Staff');
    });

    test('Manager creates shift with no staff assigned returns 302', async () => {
      const agent = request.agent(app);
      await loginManager(agent);

      const csrfToken = await getCsrfToken(agent, '/manager/shifts/new');
      const response = await agent
        .post('/manager/shifts')
        .type('form')
        .send({
          _csrf: csrfToken,
          title: `${TEST_PREFIX}No Staff Shift`,
          shiftDate: TEST_SHIFT_DATE,
          shiftType: 'MID_SHIFT',
          scheduledStart: '10:00',
          scheduledEnd: '18:00',
          priority: 'LOW'
        });

      expect(response.status).toBe(302);
    });
  });

  describe('Invalid shift creation', () => {
    test('Manager creates shift with invalid date returns 302 and redirects to form', async () => {
      const agent = request.agent(app);
      await loginManager(agent);

      const csrfToken = await getCsrfToken(agent, '/manager/shifts/new');
      const response = await agent
        .post('/manager/shifts')
        .type('form')
        .send({
          _csrf: csrfToken,
          title: TEST_SHIFT_TITLE,
          shiftDate: 'not-a-valid-date',
          shiftType: 'OPENING',
          scheduledStart: '09:00',
          scheduledEnd: '17:00',
          priority: 'MEDIUM'
        });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/manager/shifts/new');

      // Shift should NOT be created
      const createdShift = await Shift.findOne({ where: { title: TEST_SHIFT_TITLE } });
      expect(createdShift).toBeNull();
    });

    test('Manager creates shift with missing shiftType returns 302', async () => {
      const agent = request.agent(app);
      await loginManager(agent);

      const csrfToken = await getCsrfToken(agent, '/manager/shifts/new');
      const response = await agent
        .post('/manager/shifts')
        .type('form')
        .send({
          _csrf: csrfToken,
          title: TEST_SHIFT_TITLE,
          shiftDate: TEST_SHIFT_DATE,
          shiftType: '',
          scheduledStart: '09:00',
          scheduledEnd: '17:00',
          priority: 'MEDIUM'
        });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/manager/shifts/new');
    });

    test('Manager creates shift with invalid time range (end before start) returns 302', async () => {
      const agent = request.agent(app);
      await loginManager(agent);

      const csrfToken = await getCsrfToken(agent, '/manager/shifts/new');
      const response = await agent
        .post('/manager/shifts')
        .type('form')
        .send({
          _csrf: csrfToken,
          title: TEST_SHIFT_TITLE,
          shiftDate: TEST_SHIFT_DATE,
          shiftType: 'OPENING',
          scheduledStart: '17:00',
          scheduledEnd: '09:00',
          priority: 'MEDIUM'
        });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/manager/shifts/new');
    });
  });

  describe('Duplicate staff prevention', () => {
    test('Manager assigns same staff twice to same shift returns 302 with error', async () => {
      const manager = await User.findOne({ where: { email: 'manager@flowsync.com' } });
      const staffMember = await User.findOne({ where: { email: 'staff@flowsync.com' } });

      const agent = request.agent(app);
      await loginManager(agent);

      const csrfToken = await getCsrfToken(agent, '/manager/shifts/new');
      const response = await agent
        .post('/manager/shifts')
        .type('form')
        .send({
          _csrf: csrfToken,
          title: TEST_SHIFT_TITLE,
          shiftDate: TEST_SHIFT_DATE,
          shiftType: 'OPENING',
          scheduledStart: '09:00',
          scheduledEnd: '17:00',
          priority: 'MEDIUM',
          // Same staff ID twice
          staffIds: [String(staffMember.id), String(staffMember.id)],
          staffStartTimes: ['09:00', '09:00'],
          staffDurations: ['8', '8']
        });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/manager/shifts/new');
    });
  });

  describe('Overlapping assignment prevention', () => {
    test('Manager creates overlapping assignment for same staff returns 302 with error', async () => {
      const manager = await User.findOne({ where: { email: 'manager@flowsync.com' } });
      const staffMember = await User.findOne({ where: { email: 'staff@flowsync.com' } });

      // Create existing shift with assignment
      const existingShift = await Shift.create({
        title: TEST_SHIFT_TITLE_2,
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
      await loginManager(agent);

      // Try to create overlapping shift
      const csrfToken = await getCsrfToken(agent, '/manager/shifts/new');
      const response = await agent
        .post('/manager/shifts')
        .type('form')
        .send({
          _csrf: csrfToken,
          title: TEST_SHIFT_TITLE_3,
          shiftDate: TEST_SHIFT_DATE,
          shiftType: 'MID_SHIFT',
          scheduledStart: '10:00',
          scheduledEnd: '14:00',
          priority: 'HIGH',
          staffIds: [String(staffMember.id)],
          staffStartTimes: ['10:00'],
          staffDurations: ['4']
        });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/manager/shifts/new');

      // New shift should NOT be created
      const newShift = await Shift.findOne({ where: { title: TEST_SHIFT_TITLE_3 } });
      expect(newShift).toBeNull();
    });
  });

  describe('Staff access control', () => {
    test('Staff cannot access /manager/shifts/new', async () => {
      const agent = request.agent(app);
      await loginStaff(agent);

      const response = await agent.get('/manager/shifts/new');
      expect([302, 403]).toContain(response.status);
    });

    test('Staff cannot access /manager/shifts', async () => {
      const agent = request.agent(app);
      await loginStaff(agent);

      const response = await agent.get('/manager/shifts');
      expect([302, 403]).toContain(response.status);
    });
  });
});
