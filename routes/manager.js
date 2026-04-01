const express = require('express');
const router = express.Router();
const { Checklist, ChecklistItem, ChecklistCompletion, User, ShiftReport, Shift, ShiftSummary, InventoryItem, InventoryLog, ShiftAssignment, ShiftNote, TaskAssignment, ShiftSwap, LeaveRequest, sequelize } = require('../models');
const { Op } = require('sequelize');
const { requireAuth, requireManager } = require('../utils/middleware');
const { buildManagerDashboardData, getDateRange } = require('../utils/dashboardMetrics');
const { redirectWithFlash, renderWithFlash } = require('../utils/flash');
const {
  normalizeBoolean,
  normalizeDate,
  normalizeEmail,
  normalizeEnum,
  normalizeInteger,
  normalizeTime,
  timeToMinutes,
  toArray,
  toTrimmedString
} = require('../utils/validation');

// Apply middleware to all manager routes
router.use(requireAuth, requireManager);

const SHIFT_TYPES = ['OPENING', 'MID_SHIFT', 'CLOSING'];
const CHECKLIST_SHIFT_TYPES = ['MORNING', 'MIDDAY', 'EVENING'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'];
const USER_ROLES = ['MANAGER', 'STAFF'];
const CHECKLIST_ITEM_CATEGORIES = ['General', 'Operations', 'Maintenance', 'Inventory', 'Management', 'Security'];

function getTimeRange({ scheduledStart, scheduledEnd, duration }) {
  const start = timeToMinutes(scheduledStart);
  if (start === null) {
    return null;
  }

  const endFromSchedule = timeToMinutes(scheduledEnd);
  if (endFromSchedule !== null && endFromSchedule > start) {
    return { start, end: endFromSchedule };
  }

  if (Number.isInteger(duration) && duration > 0) {
    return { start, end: start + (duration * 60) };
  }

  return null;
}

function rangesOverlap(firstRange, secondRange) {
  return firstRange.start < secondRange.end && secondRange.start < firstRange.end;
}

async function findOverlappingAssignment({
  userId,
  shiftDate,
  scheduledStart,
  scheduledEnd,
  duration,
  excludeShiftId = null,
  transaction = null
}) {
  const candidateRange = getTimeRange({ scheduledStart, scheduledEnd, duration });
  if (!candidateRange) {
    return null;
  }

  const shiftWhere = { shiftDate };
  if (excludeShiftId) {
    shiftWhere.id = { [Op.ne]: excludeShiftId };
  }

  const existingAssignments = await ShiftAssignment.findAll({
    where: { userId },
    include: [{
      model: Shift,
      as: 'Shift',
      required: true,
      where: shiftWhere,
      attributes: ['id', 'title', 'shiftType', 'scheduledStart', 'scheduledEnd', 'shiftDate']
    }],
    transaction
  });

  return existingAssignments.find((assignment) => {
    const existingRange = getTimeRange({
      scheduledStart: assignment.scheduledStart || assignment.Shift?.scheduledStart,
      scheduledEnd: assignment.Shift?.scheduledEnd,
      duration: assignment.duration
    });

    return existingRange ? rangesOverlap(candidateRange, existingRange) : false;
  }) || null;
}

// GET /manager/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const dashboardData = await buildManagerDashboardData(req.query.date);

    renderWithFlash(req, res, 'manager/dashboard', {
      title: 'Dashboard',
      activePage: 'dashboard',
      ...dashboardData
    });
  } catch (error) {
    console.error('Error loading manager dashboard:', error);
    renderWithFlash(req, res, 'manager/dashboard', {
      title: 'Dashboard',
      activePage: 'dashboard',
      selectedDate: new Date().toISOString().split('T')[0],
      stats: { completionRate: 0, pendingTasks: 0, activeStaff: 0, totalStaff: 0, totalTasks: 0, completedTasks: 0, pendingApprovals: 0 },
      checklistProgress: [],
      recentCompletions: [],
      allStaff: [],
      missingTasks: [],
      lowStockItems: [],
      activeShift: null,
      recentShiftNotes: []
    });
  }
});

// GET /manager/checklists/:id - View checklist detail
router.get('/checklists/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const checklist = await Checklist.findByPk(id, {
      include: [{ model: ChecklistItem, as: 'items', order: [['sortOrder', 'ASC']] }]
    });

    if (!checklist) {
      req.session.error = 'Checklist not found';
      return res.redirect('/manager/checklists');
    }

    const successMsg = req.session.success;
    const errorMsg = req.session.error;

    res.render('manager/checklist-detail', {
      title: checklist.title,
      activePage: 'checklists',
      checklist: checklist.toJSON(),
      success: successMsg,
      error: errorMsg
    });

    // Clear session messages
    if (successMsg) delete req.session.success;
    if (errorMsg) delete req.session.error;
  } catch (error) {
    console.error('Error loading checklist detail:', error);
    req.session.error = 'Error loading checklist';
    res.redirect('/manager/checklists');
  }
});

// POST /manager/checklists/:id/items - Add item to checklist
router.post('/checklists/:id/items', async (req, res) => {
  try {
    const { id } = req.params;
    const { text, category, sortOrder } = req.body;

    const checklist = await Checklist.findByPk(id);
    if (!checklist) {
      req.session.error = 'Checklist not found';
      return req.session.save(() => res.redirect('/manager/checklists'));
    }

    if (!text || text.trim() === '') {
      req.session.error = 'Task text is required';
      return req.session.save(() => res.redirect(`/manager/checklists/${id}`));
    }

    await ChecklistItem.create({
      text: text.trim(),
      category: category || 'General',
      sortOrder: parseInt(sortOrder) || 0,
      checklistId: id
    });

    req.session.success = 'Task added successfully!';
    req.session.save(() => res.redirect(`/manager/checklists/${id}`));
  } catch (error) {
    console.error('Error adding checklist item:', error);
    req.session.error = 'Error adding task';
    req.session.save(() => res.redirect('/manager/checklists'));
  }
});

// PUT /manager/items/:id - Update checklist item
router.put('/items/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { text, category, sortOrder } = req.body;

    const item = await ChecklistItem.findByPk(id);
    if (!item) {
      req.session.error = 'Task not found';
      return req.session.save(() => res.redirect('/manager/checklists'));
    }

    if (!text || text.trim() === '') {
      req.session.error = 'Task text is required';
      return req.session.save(() => res.redirect(`/manager/checklists/${item.checklistId}`));
    }

    await item.update({
      text: text.trim(),
      category: category || item.category,
      sortOrder: parseInt(sortOrder) || item.sortOrder
    });

    req.session.success = 'Task updated successfully!';
    req.session.save(() => res.redirect(`/manager/checklists/${item.checklistId}`));
  } catch (error) {
    console.error('Error updating checklist item:', error);
    req.session.error = 'Error updating task';
    req.session.save(() => res.redirect('/manager/checklists'));
  }
});

// DELETE /manager/items/:id - Delete checklist item
router.delete('/items/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const item = await ChecklistItem.findByPk(id);
    if (!item) {
      req.session.error = 'Task not found';
      return req.session.save(() => res.redirect('/manager/checklists'));
    }

    const checklistId = item.checklistId;
    await item.destroy();

    req.session.success = 'Task deleted successfully!';
    req.session.save(() => res.redirect(`/manager/checklists/${checklistId}`));
  } catch (error) {
    console.error('Error deleting checklist item:', error);
    req.session.error = 'Error deleting task';
    req.session.save(() => res.redirect('/manager/checklists'));
  }
});

router.get('/dash2', (req, res) => {
  const params = new URLSearchParams(req.query).toString();
  const suffix = params ? `?${params}` : '';
  return res.redirect(`/manager/dashboard${suffix}`);
});

// GET /manager/reports
router.get('/reports', async (req, res) => {
  try {
    const { tab, start, end } = req.query;
    const activeTab = tab || 'daily';

    // Default to last 7 days
    const endDate = end || new Date().toISOString().split('T')[0];
    const startDate = start || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Get checklists
    const checklists = await Checklist.findAll({
      include: [{ model: ChecklistItem, as: 'items' }]
    });

    // Get completions for date range
    const completions = await ChecklistCompletion.findAll({
      where: {
        completedAt: {
          [Op.between]: [new Date(startDate), new Date(endDate + 'T23:59:59')]
        }
      },
      include: [
        { model: User, as: 'User', attributes: ['fullName'] },
        { model: ChecklistItem, as: 'ChecklistItem', attributes: ['text', 'checklistId'] }
      ]
    });

    // Get shift reports
    const shiftReports = await ShiftReport.findAll({
      where: {
        date: {
          [Op.between]: [startDate, endDate]
        }
      },
      include: [{ model: User, as: 'User', attributes: ['fullName'] }],
      order: [['submittedAt', 'DESC']],
      limit: 20
    });

    // Calculate overall stats
    const totalTasks = completions.length;
    const completedTasks = completions.filter(c => c.status === 'COMPLETED').length;
    const overallStats = {
      avgCompletionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      totalIssues: shiftReports.filter(r => r.issues && r.issues.length > 0).length,
      totalCompleted: completedTasks,
      checklistsFinalized: shiftReports.length,
      totalChecklists: checklists.length
    };

    // Build daily report
    const dailyReport = [];
    const dailyMap = {};
    for (let d = new Date(startDate); d <= new Date(endDate); d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      dailyMap[dateStr] = { date: dateStr, morning: { total: 0, completed: 0 }, midday: { total: 0, completed: 0 }, evening: { total: 0, completed: 0 } };
    }

    completions.forEach(c => {
      const date = c.date || c.completedAt?.toISOString().split('T')[0];
      if (date && dailyMap[date]) {
        // Determine shift based on completion time or default
        const hour = c.completedAt ? new Date(c.completedAt).getHours() : 8;
        let shift = 'morning';
        if (hour >= 12 && hour < 17) shift = 'midday';
        else if (hour >= 17) shift = 'evening';

        dailyMap[date][shift].total++;
        if (c.status === 'COMPLETED') dailyMap[date][shift].completed++;
      }
    });

    Object.values(dailyMap).forEach(day => {
      ['morning', 'midday', 'evening'].forEach(shift => {
        day[shift].percent = day[shift].total > 0 ? Math.round((day[shift].completed / day[shift].total) * 100) : 0;
      });
      dailyReport.push(day);
    });

    // Build staff report
    const staffMap = {};
    const staff = await User.findAll({ where: { role: 'STAFF' } });
    staff.forEach(s => {
      staffMap[s.id] = { fullName: s.fullName, tasksCompleted: 0, issuesCount: 0 };
    });

    completions.forEach(c => {
      if (c.userId && staffMap[c.userId] && c.status === 'COMPLETED') {
        staffMap[c.userId].tasksCompleted++;
      }
    });

    const staffReport = Object.values(staffMap);

    // Build checklist report
    const checklistReport = checklists.map(cl => {
      const totalItems = cl.items ? cl.items.length : 0;
      const completedItems = completions.filter(c =>
        cl.items && cl.items.some(i => i.id === c.checklistItemId) && c.status === 'COMPLETED'
      ).length;
      const percent = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : 0;
      let status = percent === 100 ? 'Completed' : percent > 0 ? 'In Progress' : 'Pending';
      return { title: cl.title, shiftType: cl.shiftType, totalItems, completedItems, percent, status };
    });

    // Get inventory report
    const { InventoryItem } = require('../models');
    const inventoryReport = await InventoryItem.findAll({
      order: [['quantityOnHand', 'ASC'], ['name', 'ASC']]
    });

    res.render('manager/reports', {
      title: 'Reports',
      activePage: 'reports',
      activeTab,
      startDate,
      endDate,
      overallStats,
      dailyReport,
      staffReport,
      checklistReport,
      inventoryReport: inventoryReport.map(i => i.toJSON()),
      shiftReports: shiftReports.map(r => ({
        ...r.toJSON(),
        submittedBy: r.User ? r.User.fullName : 'Unknown',
        completionPercent: r.totalTasks > 0 ? Math.round((r.completedTasks / r.totalTasks) * 100) : 0
      }))
    });
  } catch (error) {
    console.error('Error loading reports:', error);
    res.render('manager/reports', {
      title: 'Reports',
      activePage: 'reports',
      activeTab: 'daily',
      startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      endDate: new Date().toISOString().split('T')[0],
      overallStats: { avgCompletionRate: 0, totalIssues: 0, totalCompleted: 0, checklistsFinalized: 0, totalChecklists: 0 },
      dailyReport: [],
      staffReport: [],
      checklistReport: [],
      inventoryReport: [],
      shiftReports: []
    });
  }
});

// GET /manager/activity
router.get('/activity', async (req, res) => {
  try {
    // Get ActivityLog entries
    const { ActivityLog } = require('../models');
    const activityLogs = await ActivityLog.findAll({
      include: [{ model: User, as: 'User', attributes: ['fullName', 'email'] }],
      order: [['createdAt', 'DESC']],
      limit: 100
    });

    // Get checklist completions
    const completions = await ChecklistCompletion.findAll({
      include: [
        { model: User, as: 'User', attributes: ['fullName'] },
        { model: ChecklistItem, as: 'ChecklistItem', attributes: ['text'] }
      ],
      order: [['completedAt', 'DESC']],
      limit: 50
    });

    // Merge and sort by date
    const allActivities = [
      ...activityLogs.map(log => ({
        id: log.id,
        type: 'system',
        action: log.action,
        userName: log.User ? log.User.fullName : 'System',
        details: log.details,
        createdAt: log.createdAt
      })),
      ...completions.map(c => ({
        id: c.id,
        type: 'checklist',
        action: 'checklist_item_completed',
        userName: c.User ? c.User.fullName : 'Unknown',
        details: { itemText: c.ChecklistItem ? c.ChecklistItem.text : 'Unknown item', status: c.status },
        createdAt: c.completedAt || c.createdAt
      }))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.render('manager/activity', {
      title: 'Activity Log',
      activePage: 'activity',
      activities: allActivities
    });
  } catch (error) {
    console.error('Error loading activity:', error);
    res.render('manager/activity', {
      title: 'Activity Log',
      activePage: 'activity',
      activities: []
    });
  }
});

// GET /manager/checklists
router.get('/checklists', async (req, res) => {
  try {
    const checklists = await Checklist.findAll({
      include: [{ model: ChecklistItem, as: 'items' }],
      order: [['shiftType', 'ASC']]
    });

    res.render('manager/checklists', {
      title: 'Checklists',
      activePage: 'checklists',
      checklists: checklists.map(cl => ({
        ...cl.toJSON(),
        itemCount: cl.items ? cl.items.length : 0
      }))
    });
  } catch (error) {
    res.render('manager/checklists', {
      title: 'Checklists',
      activePage: 'checklists',
      checklists: []
    });
  }
});

// POST /manager/checklists
router.post('/checklists', async (req, res) => {
  try {
    const title = toTrimmedString(req.body.title, { maxLength: 255 });
    const shiftType = normalizeEnum(req.body.shiftType, CHECKLIST_SHIFT_TYPES);
    const description = toTrimmedString(req.body.description, { maxLength: 1000, allowEmpty: true });

    if (!title || !shiftType) {
      req.session.error = 'Checklist title and shift type are required.';
      return req.session.save(() => res.redirect('/manager/checklists'));
    }

    await Checklist.create({
      title,
      shiftType,
      description: description || null,
      isActive: normalizeBoolean(req.body.isActive)
    });
    req.session.success = 'Checklist created successfully!';
    req.session.save(() => res.redirect('/manager/checklists'));
  } catch (error) {
    req.session.error = 'Error creating checklist.';
    req.session.save(() => res.redirect('/manager/checklists'));
  }
});

// GET /manager/staff
router.get('/staff', async (req, res) => {
  try {
    const staff = await User.findAll({
      where: { role: 'STAFF' },
      order: [['fullName', 'ASC']]
    });

    const today = new Date().toISOString().split('T')[0];
    const { StaffAttendance } = require('../models');
    const attendance = await StaffAttendance.findAll({
      where: { date: today },
      include: [{ model: User, as: 'User', attributes: ['fullName'] }]
    });

    const attendanceMap = {};
    attendance.forEach(a => {
      attendanceMap[a.userId] = a;
    });

    const activeStaffCount = attendance.filter(a => a.status === 'CLOCKED_IN').length;

    const successMsg = req.session.success;
    const errorMsg = req.session.error;

    res.render('manager/staff', {
      title: 'Staff',
      activePage: 'staff',
      staff: staff.map(s => ({
        ...s.toJSON(),
        todayStatus: attendanceMap[s.id] ? attendanceMap[s.id].status : null,
        clockInTime: attendanceMap[s.id] ? attendanceMap[s.id].clockInTime : null
      })),
      stats: { totalStaff: staff.length, activeStaff: activeStaffCount },
      pagination: { page: 1, total: staff.length },
      error: errorMsg,
      success: successMsg
    });
    // Clear the session messages after displaying
    if (req.session.error) delete req.session.error;
    if (req.session.success) delete req.session.success;
  } catch (error) {
    res.render('manager/staff', {
      title: 'Staff',
      activePage: 'staff',
      staff: [],
      stats: { totalStaff: 0, activeStaff: 0 },
      pagination: null,
      error: req.session.error || null,
      success: req.session.success || null
    });
    // Clear the session messages
    if (req.session.error) delete req.session.error;
    if (req.session.success) delete req.session.success;
  }
});

// POST /manager/staff - Add new staff member
router.post('/staff', async (req, res) => {
  try {
    const fullName = toTrimmedString(req.body.fullName, { maxLength: 120 });
    const email = normalizeEmail(req.body.email);
    const role = normalizeEnum(req.body.role || 'STAFF', USER_ROLES);
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!fullName || !email || !role || password.length < 6) {
      req.session.error = 'Please fill in all required fields';
      return req.session.save(() => res.redirect('/manager/staff'));
    }

    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      req.session.error = 'A user with this email already exists';
      return req.session.save(() => res.redirect('/manager/staff'));
    }

    const newUser = await User.create({
      fullName,
      email,
      passwordHash: password,
      role,
      isActive: true
    });
    const successMessage = `${fullName} has been added as ${role === 'MANAGER' ? 'Manager' : 'Staff'}!`;
    req.session.success = successMessage;
    req.session.save(() => res.redirect('/manager/staff'));
  } catch (error) {
    console.error('=== Error adding staff:', error);
    req.session.error = 'Error adding staff member';
    req.session.save(() => res.redirect('/manager/staff'));
  }
});

// GET /manager/staff/:id - View staff details
router.get('/staff/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const staffMember = await User.findByPk(id);

    if (!staffMember) {
      req.session.error = 'Staff member not found';
      return res.redirect('/manager/staff');
    }

    // Get attendance history
    const { StaffAttendance } = require('../models');
    const attendance = await StaffAttendance.findAll({
      where: { userId: id },
      order: [['date', 'DESC']],
      limit: 10
    });

    // Get task assignments
    const taskAssignments = await TaskAssignment.findAll({
      where: { assignedTo: id },
      include: [{ model: Shift, attributes: ['shiftType', 'shiftDate'] }],
      order: [['createdAt', 'DESC']],
      limit: 10
    });

    res.render('manager/staff-detail', {
      title: 'Staff Details',
      activePage: 'staff',
      staffMember: staffMember.toJSON(),
      attendance: attendance.map(a => a.toJSON()),
      taskAssignments: taskAssignments.map(t => t.toJSON())
    });
  } catch (error) {
    console.error('Error loading staff details:', error);
    req.session.error = 'Error loading staff details';
    res.redirect('/manager/staff');
  }
});

// GET /manager/staff/:id/edit - Edit staff form
router.get('/staff/:id/edit', async (req, res) => {
  try {
    const { id } = req.params;
    const staffMember = await User.findByPk(id);

    if (!staffMember) {
      req.session.error = 'Staff member not found';
      return res.redirect('/manager/staff');
    }

    res.render('manager/staff-edit', {
      title: 'Edit Staff',
      activePage: 'staff',
      staffMember: staffMember.toJSON(),
      error: req.session.error || null
    });

    if (req.session.error) delete req.session.error;
  } catch (error) {
    console.error('Error loading staff edit:', error);
    req.session.error = 'Error loading staff edit form';
    res.redirect('/manager/staff');
  }
});

// PUT /manager/staff/:id - Update staff
router.put('/staff/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const fullName = toTrimmedString(req.body.fullName, { maxLength: 120 });
    const email = normalizeEmail(req.body.email);
    const role = normalizeEnum(req.body.role, USER_ROLES);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const isActive = normalizeBoolean(req.body.isActive);

    const staffMember = await User.findByPk(id);
    if (!staffMember) {
      req.session.error = 'Staff member not found';
      return req.session.save(() => res.redirect('/manager/staff'));
    }

    if (!fullName || !email || !role) {
      req.session.error = 'Full name, email, and role are required.';
      return req.session.save(() => res.redirect(`/manager/staff/${id}/edit`));
    }

    if (password && password.length < 6) {
      req.session.error = 'Password must be at least 6 characters.';
      return req.session.save(() => res.redirect(`/manager/staff/${id}/edit`));
    }

    if (email !== staffMember.email) {
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        req.session.error = 'A user with this email already exists';
        return req.session.save(() => res.redirect(`/manager/staff/${id}/edit`));
      }
    }

    const updateData = {
      fullName,
      email,
      role,
      isActive
    };

    if (password) {
      updateData.passwordHash = password;
    }

    await staffMember.update(updateData);

    req.session.success = 'Staff member updated successfully!';
    req.session.save(() => res.redirect('/manager/staff'));
  } catch (error) {
    console.error('Error updating staff:', error);
    req.session.error = 'Error updating staff member';
    req.session.save(() => res.redirect('/manager/staff'));
  }
});

// DELETE /manager/staff/:id - Delete staff
router.delete('/staff/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const staffMember = await User.findByPk(id);

    if (!staffMember) {
      req.session.error = 'Staff member not found';
      return req.session.save(() => res.redirect('/manager/staff'));
    }

    await staffMember.destroy();
    req.session.success = 'Staff member deleted successfully!';
    req.session.save(() => res.redirect('/manager/staff'));
  } catch (error) {
    console.error('Error deleting staff:', error);
    req.session.error = 'Error deleting staff member';
    req.session.save(() => res.redirect('/manager/staff'));
  }
});

// GET /manager/shifts
router.get('/shifts', async (req, res) => {
  try {
    const { date, status } = req.query;
    let whereClause = {};
    if (date) whereClause.shiftDate = date;
    if (status) whereClause.status = status;

    const shifts = await Shift.findAll({
      where: whereClause,
      order: [['shiftDate', 'DESC'], ['createdAt', 'DESC']]
    });

    // Get active shift for dashboard
    const activeShift = await Shift.findOne({
      where: { status: 'ACTIVE' }
    });

    res.render('manager/shifts', {
      title: 'Shifts',
      activePage: 'shifts',
      shifts: shifts.map(s => ({
        ...s.toJSON(),
        assignments: s.assignments ? s.assignments.map(a => a.toJSON()) : []
      })),
      filters: { date, status },
      activeShift: activeShift ? activeShift.toJSON() : null,
      error: req.session.error || null,
      success: req.session.success || null
    });

    if (req.session.error) delete req.session.error;
    if (req.session.success) delete req.session.success;
  } catch (error) {
    console.error('Error loading shifts:', error);
    res.render('manager/shifts', {
      title: 'Shifts',
      activePage: 'shifts',
      shifts: [],
      filters: {},
      activeShift: null,
      error: req.session.error || null,
      success: req.session.success || null
    });

    if (req.session.error) delete req.session.error;
    if (req.session.success) delete req.session.success;
  }
});

// GET /manager/shifts/new
router.get('/shifts/new', async (req, res) => {
  try {
    const staff = await User.findAll({
      where: { role: 'STAFF' },
      order: [['fullName', 'ASC']]
    });
    res.render('manager/shifts-new', {
      title: 'New Shift',
      activePage: 'shifts',
      staff,
      error: req.session.error || null
    });

    if (req.session.error) delete req.session.error;
  } catch (error) {
    console.error('Error loading staff:', error);
    res.render('manager/shifts-new', {
      title: 'New Shift',
      activePage: 'shifts',
      staff: [],
      error: req.session.error || null
    });

    if (req.session.error) delete req.session.error;
  }
});

// POST /manager/shifts
router.post('/shifts', async (req, res) => {
  try {
    const shiftDate = normalizeDate(req.body.shiftDate);
    const shiftType = normalizeEnum(req.body.shiftType, SHIFT_TYPES);
    const title = toTrimmedString(req.body.title, { maxLength: 255, allowEmpty: true });
    const notes = toTrimmedString(req.body.notes, { maxLength: 2000, allowEmpty: true });
    const scheduledStart = normalizeTime(req.body.scheduledStart);
    const scheduledEnd = normalizeTime(req.body.scheduledEnd);
    const priority = normalizeEnum(req.body.priority || 'MEDIUM', PRIORITIES);
    const submittedStaffIds = toArray(req.body.staffIds);
    const submittedStaffStartTimes = toArray(req.body.staffStartTimes);
    const submittedStaffDurations = toArray(req.body.staffDurations);
    const userId = req.session.user.id;

    if (!shiftDate || !shiftType || !priority) {
      req.session.error = 'Shift date, type, and priority are required.';
      return req.session.save(() => res.redirect('/manager/shifts/new'));
    }

    const shiftRange = getTimeRange({ scheduledStart, scheduledEnd });
    if ((req.body.scheduledStart || req.body.scheduledEnd) && !shiftRange) {
      req.session.error = 'Scheduled shift times must include a valid start and end time.';
      return req.session.save(() => res.redirect('/manager/shifts/new'));
    }

    const seenStaffIds = new Set();
    const staffAssignments = [];

    for (let index = 0; index < submittedStaffIds.length; index += 1) {
      const parsedUserId = normalizeInteger(submittedStaffIds[index], { min: 1 });
      const parsedStartTime = normalizeTime(submittedStaffStartTimes[index]) || scheduledStart;
      const parsedDuration = normalizeInteger(submittedStaffDurations[index], { min: 1, max: 12, allowNull: true });

      if (Number.isNaN(parsedUserId) || Number.isNaN(parsedDuration)) {
        req.session.error = 'Assigned staff must have valid IDs and durations.';
        return req.session.save(() => res.redirect('/manager/shifts/new'));
      }

      if (seenStaffIds.has(parsedUserId)) {
        req.session.error = 'A staff member was selected more than once.';
        return req.session.save(() => res.redirect('/manager/shifts/new'));
      }

      seenStaffIds.add(parsedUserId);
      staffAssignments.push({
        userId: parsedUserId,
        scheduledStart: parsedStartTime,
        duration: parsedDuration
      });
    }

    await sequelize.transaction(async (transaction) => {
      const shift = await Shift.create({
        title: title || null,
        shiftDate,
        shiftType,
        scheduledStart,
        scheduledEnd,
        priority,
        notes: notes || null,
        status: 'SCHEDULED',
        createdBy: userId,
        managerId: userId
      }, { transaction });

      for (const assignment of staffAssignments) {
        const overlappingAssignment = await findOverlappingAssignment({
          userId: assignment.userId,
          shiftDate,
          scheduledStart: assignment.scheduledStart,
          scheduledEnd,
          duration: assignment.duration,
          transaction
        });

        if (overlappingAssignment) {
          throw new Error('One or more staff members already have an overlapping shift assignment.');
        }

        await ShiftAssignment.create({
          shiftId: shift.id,
          userId: assignment.userId,
          roleLabel: 'Staff',
          assignedAt: new Date(),
          scheduledStart: assignment.scheduledStart,
          duration: assignment.duration
        }, { transaction });
      }
    });

    req.session.success = 'Shift created!';
    req.session.save(() => res.redirect('/manager/shifts'));
  } catch (error) {
    if (error.message !== 'One or more staff members already have an overlapping shift assignment.') {
      console.error('Error creating shift:', error);
    }
    req.session.error = error.message || 'Error creating shift.';
    req.session.save(() => res.redirect('/manager/shifts/new'));
  }
});

// POST /manager/shifts/:id/start
router.post('/shifts/:id/start', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.session.user.id;
    const shift = await Shift.findByPk(id);
    if (shift) {
      await shift.update({ status: 'ACTIVE', startedAt: new Date() });

      // Log activity
      const { logActivity, ACTIONS } = require('../utils/activityLogger');
      await logActivity(userId, ACTIONS.SHIFT_STARTED, 'shift', id, { shiftType: shift.shiftType });

      req.session.success = 'Shift started!';
    }
    res.redirect('/manager/shifts');
  } catch (error) {
    console.error('Error starting shift:', error);
    redirectWithFlash(req, res, '/manager/shifts', {
      error: 'Error starting shift.'
    });
  }
});

// POST /manager/shifts/:id/close
router.post('/shifts/:id/close', async (req, res) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const userId = req.session.user.id;
    const shift = await Shift.findByPk(id);
    if (shift) {
      await shift.update({ status: 'CLOSED', endedAt: new Date(), notes: notes || shift.notes });

      // Log activity
      const { logActivity, ACTIONS } = require('../utils/activityLogger');
      await logActivity(userId, ACTIONS.SHIFT_CLOSED, 'shift', id, { shiftType: shift.shiftType });

      req.session.success = 'Shift closed!';
    }
    res.redirect('/manager/shifts');
  } catch (error) {
    console.error('Error closing shift:', error);
    redirectWithFlash(req, res, '/manager/shifts', {
      error: 'Error closing shift.'
    });
  }
});

// GET /manager/shifts/:id
router.get('/shifts/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const shift = await Shift.findByPk(id);
    if (!shift) return res.redirect('/manager/shifts');

    // Get assignments with user details
    const assignments = await ShiftAssignment.findAll({
      where: { shiftId: id },
      include: [{ model: User, as: 'User', attributes: ['id', 'fullName'] }]
    });

    // Get notes with user details
    const notes = await ShiftNote.findAll({
      where: { shiftId: id },
      order: [['createdAt', 'DESC']]
    });

    // Get all staff for assignment dropdown
    const allStaff = await User.findAll({
      where: { role: 'STAFF', isActive: true },
      attributes: ['id', 'fullName']
    });

    // Get previous shift notes (from most recent closed shift of same type)
    const previousShift = await Shift.findOne({
      where: {
        shiftType: shift.shiftType,
        status: 'CLOSED',
        shiftDate: { [Op.lt]: shift.shiftDate }
      },
      order: [['shiftDate', 'DESC']],
      limit: 1
    });

    let previousNotes = [];
    if (previousShift) {
      previousNotes = await ShiftNote.findAll({
        where: { shiftId: previousShift.id },
        order: [['createdAt', 'DESC']]
      });
    }

    let summary = await ShiftSummary.findOne({ where: { shiftId: id } });

    // Map shift type to checklist type
    const shiftToChecklistType = {
      'OPENING': 'MORNING',
      'MID_SHIFT': 'MIDDAY',
      'CLOSING': 'EVENING'
    };
    const checklistShiftType = shiftToChecklistType[shift.shiftType] || 'MORNING';

    // Calculate checklist metrics for this shift
    const checklists = await Checklist.findAll({
      where: { shiftType: checklistShiftType, isActive: true },
      include: [{ model: ChecklistItem, as: 'items' }]
    });

    let totalTasks = 0;
    let completedTasks = 0;
    let pendingTasks = 0;

    checklists.forEach(cl => {
      if (cl.items) {
        totalTasks += cl.items.length;
      }
    });

    // Get completions for this shift date
    const completions = await ChecklistCompletion.findAll({
      where: { date: shift.shiftDate }
    });
    completedTasks = completions.filter(c => c.status === 'COMPLETED').length;
    pendingTasks = totalTasks - completedTasks;

    const checklistStats = {
      total: totalTasks,
      completed: completedTasks,
      pending: pendingTasks,
      percent: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
    };

    // Get task assignments for this shift
    const tasks = await TaskAssignment.findAll({
      where: { shiftId: id },
      include: [
        { model: User, as: 'assignee', attributes: ['id', 'fullName'] },
        { model: ChecklistItem, attributes: ['id', 'text'] }
      ],
      order: [['priority', 'DESC'], ['createdAt', 'DESC']]
    });

    res.render('manager/shifts-detail', {
      title: 'Shift Details',
      activePage: 'shifts',
      shift: shift.toJSON(),
      summary: summary ? summary.toJSON() : null,
      assignments: assignments.map(a => a.toJSON()),
      notes: notes.map(n => n.toJSON()),
      previousShift: previousShift ? previousShift.toJSON() : null,
      previousNotes: previousNotes.map(n => n.toJSON()),
      staff: allStaff.map(s => s.toJSON()),
      checklistStats,
      tasks: tasks.map(t => t.toJSON()),
      error: req.session.error || null,
      success: req.session.success || null
    });

    if (req.session.error) delete req.session.error;
    if (req.session.success) delete req.session.success;
  } catch (error) {
    console.error('Error loading shift detail:', error);
    res.redirect('/manager/shifts');
  }
});

// GET /manager/inventory
router.get('/inventory', async (req, res) => {
  try {
    const { category, search } = req.query;
    let whereClause = {};
    if (category) whereClause.category = category;
    if (search) whereClause.name = { [Op.iLike]: `%${search}%` };

    const items = await InventoryItem.findAll({
      where: whereClause,
      order: [['name', 'ASC']]
    });

    const categories = await InventoryItem.findAll({
      attributes: ['category'],
      where: { category: { [Op.ne]: null } },
      group: ['category']
    });

    const allItems = await InventoryItem.findAll({
      where: { reorderLevel: { [Op.gt]: 0 } }
    });
    const lowStockCount = allItems.filter(item => item.quantityOnHand <= item.reorderLevel).length;

    res.render('manager/inventory', {
      title: 'Inventory',
      activePage: 'inventory',
      items: items.map(i => i.toJSON()),
      categories: categories.map(c => c.category),
      filters: { category, search },
      lowStockCount,
      error: req.session.error || null,
      success: req.session.success || null
    });

    if (req.session.error) delete req.session.error;
    if (req.session.success) delete req.session.success;
  } catch (error) {
    res.render('manager/inventory', {
      title: 'Inventory',
      activePage: 'inventory',
      items: [],
      categories: [],
      filters: {},
      lowStockCount: 0,
      error: req.session.error || null,
      success: req.session.success || null
    });

    if (req.session.error) delete req.session.error;
    if (req.session.success) delete req.session.success;
  }
});

// GET /manager/inventory/new
router.get('/inventory/new', (req, res) => {
  res.render('manager/inventory-new', {
    title: 'New Inventory Item',
    activePage: 'inventory',
    error: req.session.error || null
  });

  if (req.session.error) delete req.session.error;
});

// POST /manager/inventory
router.post('/inventory', async (req, res) => {
  try {
    const name = toTrimmedString(req.body.name, { maxLength: 120 });
    const category = toTrimmedString(req.body.category, { maxLength: 80, allowEmpty: true });
    const quantityOnHand = normalizeInteger(req.body.quantityOnHand, { min: 0 });
    const unit = toTrimmedString(req.body.unit, { maxLength: 30, allowEmpty: true });
    const reorderLevel = normalizeInteger(req.body.reorderLevel, { min: 0 });

    if (!name || Number.isNaN(quantityOnHand) || Number.isNaN(reorderLevel)) {
      req.session.error = 'Inventory name, quantity, and reorder level must be valid.';
      return req.session.save(() => res.redirect('/manager/inventory/new'));
    }

    await InventoryItem.create({
      name,
      category: category || 'Other',
      quantityOnHand,
      unit: unit || '',
      reorderLevel
    });
    req.session.success = 'Inventory item created!';
    req.session.save(() => res.redirect('/manager/inventory'));
  } catch (error) {
    req.session.error = 'Error creating inventory item.';
    req.session.save(() => res.redirect('/manager/inventory/new'));
  }
});

// GET /manager/inventory/:id/edit
router.get('/inventory/:id/edit', async (req, res) => {
  try {
    const { id } = req.params;
    const item = await InventoryItem.findByPk(id);
    if (!item) return res.redirect('/manager/inventory');

    const logs = await InventoryLog.findAll({
      where: { inventoryItemId: id },
      include: [{ model: User, as: 'User', attributes: ['fullName'] }],
      order: [['createdAt', 'DESC']],
      limit: 10
    });

    res.render('manager/inventory-edit', {
      title: 'Edit Inventory Item',
      activePage: 'inventory',
      item: item.toJSON(),
      logs: logs.map(l => l.toJSON()),
      error: req.session.error || null,
      success: req.session.success || null
    });

    if (req.session.error) delete req.session.error;
    if (req.session.success) delete req.session.success;
  } catch (error) {
    res.redirect('/manager/inventory');
  }
});

// PUT /manager/inventory/:id
router.put('/inventory/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const name = toTrimmedString(req.body.name, { maxLength: 120 });
    const category = toTrimmedString(req.body.category, { maxLength: 80, allowEmpty: true });
    const quantityOnHand = normalizeInteger(req.body.quantityOnHand, { min: 0 });
    const unit = toTrimmedString(req.body.unit, { maxLength: 30, allowEmpty: true });
    const reorderLevel = normalizeInteger(req.body.reorderLevel, { min: 0 });
    const item = await InventoryItem.findByPk(id);
    if (item) {
      if (!name || Number.isNaN(quantityOnHand) || Number.isNaN(reorderLevel)) {
        req.session.error = 'Inventory name, quantity, and reorder level must be valid.';
        return req.session.save(() => res.redirect(`/manager/inventory/${id}/edit`));
      }

      await item.update({
        name,
        category: category || 'Other',
        quantityOnHand,
        unit: unit || '',
        reorderLevel
      });
      req.session.success = 'Inventory item updated!';
    }
    req.session.save(() => res.redirect('/manager/inventory'));
  } catch (error) {
    req.session.error = 'Error updating inventory item.';
    req.session.save(() => res.redirect(`/manager/inventory/${req.params.id}/edit`));
  }
});

// POST /manager/inventory/:id/adjust
router.post('/inventory/:id/adjust', async (req, res) => {
  try {
    const { id } = req.params;
    const changeAmount = normalizeInteger(req.body.changeAmount);
    const reason = toTrimmedString(req.body.reason, { maxLength: 255, allowEmpty: true });
    const userId = req.session.user.id;

    const item = await InventoryItem.findByPk(id);
    if (item) {
      if (Number.isNaN(changeAmount)) {
        req.session.error = 'Adjustment amount must be a valid whole number.';
        return req.session.save(() => res.redirect(`/manager/inventory/${id}/edit`));
      }

      const newQuantity = item.quantityOnHand + changeAmount;
      if (newQuantity < 0) {
        req.session.error = 'Inventory adjustments cannot reduce stock below zero.';
        return req.session.save(() => res.redirect(`/manager/inventory/${id}/edit`));
      }

      await InventoryLog.create({
        inventoryItemId: id,
        changeAmount,
        reason: reason || null,
        updatedBy: userId
      });
      await item.update({
        quantityOnHand: newQuantity
      });

      // Log activity
      const { logActivity, ACTIONS } = require('../utils/activityLogger');
      await logActivity(userId, ACTIONS.INVENTORY_UPDATED, 'inventory', id, { itemName: item.name, changeAmount, newQuantity });

      req.session.success = `Stock adjusted by ${changeAmount}!`;
    }
    req.session.save(() => res.redirect(`/manager/inventory/${id}/edit`));
  } catch (error) {
    req.session.error = 'Error adjusting stock.';
    req.session.save(() => res.redirect(`/manager/inventory/${req.params.id}/edit`));
  }
});

// DELETE /manager/inventory/:id
router.delete('/inventory/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const item = await InventoryItem.findByPk(id);
    if (item) {
      await item.destroy();
      req.session.success = 'Inventory item deleted!';
    }
    res.redirect('/manager/inventory');
  } catch (error) {
    req.session.error = 'Error deleting inventory item.';
    res.redirect('/manager/inventory');
  }
});

// POST /manager/shifts/:id/assign - Assign staff to shift
router.post('/shifts/:id/assign', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = normalizeInteger(req.body.userId, { min: 1 });
    const roleLabel = toTrimmedString(req.body.roleLabel, { maxLength: 60, allowEmpty: true });
    const managerId = req.session.user.id;

    if (Number.isNaN(userId)) {
      req.session.error = 'A valid staff member is required.';
      return req.session.save(() => res.redirect(`/manager/shifts/${id}`));
    }

    const shift = await Shift.findByPk(id);
    const staffMember = await User.findOne({ where: { id: userId, role: 'STAFF', isActive: true } });
    if (!shift || !staffMember) {
      req.session.error = 'Shift or staff member not found.';
      return req.session.save(() => res.redirect(`/manager/shifts/${id}`));
    }

    const existingAssignment = await ShiftAssignment.findOne({
      where: { shiftId: id, userId }
    });
    if (existingAssignment) {
      req.session.error = 'That staff member is already assigned to this shift.';
      return req.session.save(() => res.redirect(`/manager/shifts/${id}`));
    }

    const overlappingAssignment = await findOverlappingAssignment({
      userId,
      shiftDate: shift.shiftDate,
      scheduledStart: shift.scheduledStart,
      scheduledEnd: shift.scheduledEnd,
      duration: null,
      excludeShiftId: shift.id
    });
    if (overlappingAssignment) {
      req.session.error = 'That staff member already has an overlapping shift assignment.';
      return req.session.save(() => res.redirect(`/manager/shifts/${id}`));
    }

    const assignment = await ShiftAssignment.create({
      shiftId: id,
      userId,
      roleLabel: roleLabel || 'Staff'
    });

    // Log activity
    const { logActivity, ACTIONS } = require('../utils/activityLogger');
    await logActivity(managerId, ACTIONS.STAFF_ASSIGNED, 'shift', id, { userId: assignment.userId, roleLabel: assignment.roleLabel });

    req.session.success = 'Staff assigned to shift!';
    req.session.save(() => res.redirect(`/manager/shifts/${id}`));
  } catch (error) {
    console.error('Error assigning staff:', error);
    req.session.error = error.message || 'Error assigning staff.';
    req.session.save(() => res.redirect(`/manager/shifts/${req.params.id}`));
  }
});

// DELETE /manager/assignments/:id - Remove staff from shift
router.delete('/assignments/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const assignment = await ShiftAssignment.findByPk(id);

    if (assignment) {
      const shiftId = assignment.shiftId;
      const managerId = req.session.user.id;

      await assignment.destroy();

      // Log activity
      const { logActivity, ACTIONS } = require('../utils/activityLogger');
      await logActivity(managerId, ACTIONS.STAFF_UNASSIGNED, 'shift', shiftId, { assignmentId: id });

      req.session.success = 'Staff removed from shift!';
      res.redirect(`/manager/shifts/${shiftId}`);
    } else {
      res.redirect('/manager/shifts');
    }
  } catch (error) {
    console.error('Error removing assignment:', error);
    req.session.error = 'Error removing staff.';
    res.redirect('/manager/shifts');
  }
});

// POST /manager/shifts/:id/notes - Add note to shift
router.post('/shifts/:id/notes', async (req, res) => {
  try {
    const { id } = req.params;
    const noteText = toTrimmedString(req.body.noteText, { maxLength: 2000 });
    const userId = req.session.user.id;

    if (!noteText) {
      return redirectWithFlash(req, res, `/manager/shifts/${id}`, {
        error: 'Shift note text is required.'
      });
    }

    await ShiftNote.create({
      shiftId: id,
      noteText,
      createdBy: userId
    });

    // Log activity
    const { logActivity, ACTIONS } = require('../utils/activityLogger');
    await logActivity(userId, ACTIONS.NOTE_ADDED, 'shift', id);

    req.session.success = 'Note added!';
    res.redirect(`/manager/shifts/${id}`);
  } catch (error) {
    console.error('Error adding note:', error);
    redirectWithFlash(req, res, `/manager/shifts/${req.params.id}`, {
      error: 'Error adding note.'
    });
  }
});

// POST /manager/shifts/:id/tasks - Assign task to staff
router.post('/shifts/:id/tasks', async (req, res) => {
  try {
    const { id } = req.params;
    const assignedTo = normalizeInteger(req.body.assignedTo, { min: 1 });
    const checklistItemId = normalizeInteger(req.body.checklistItemId, { min: 1, allowNull: true });
    const customTaskText = toTrimmedString(req.body.customTaskText, { maxLength: 255, allowEmpty: true });
    const priority = normalizeEnum(req.body.priority || 'MEDIUM', PRIORITIES);
    const notes = toTrimmedString(req.body.notes, { maxLength: 1000, allowEmpty: true });
    const userId = req.session.user.id;

    if (Number.isNaN(assignedTo) || !priority || (!customTaskText && Number.isNaN(checklistItemId))) {
      return redirectWithFlash(req, res, `/manager/shifts/${id}`, {
        error: 'Assigned staff, priority, and a checklist task or custom task description are required.'
      });
    }

    const [shift, assignee] = await Promise.all([
      Shift.findByPk(id),
      ShiftAssignment.findOne({ where: { shiftId: id, userId: assignedTo } })
    ]);

    if (!shift || !assignee) {
      return redirectWithFlash(req, res, `/manager/shifts/${id}`, {
        error: 'Tasks can only be assigned to staff already assigned to this shift.'
      });
    }

    await TaskAssignment.create({
      shiftId: id,
      assignedTo,
      checklistItemId: Number.isNaN(checklistItemId) ? null : checklistItemId,
      customTaskText: customTaskText || null,
      priority,
      notes: notes || null,
      status: 'OPEN'
    });

    // Log activity
    const { logActivity, ACTIONS } = require('../utils/activityLogger');
    await logActivity(userId, ACTIONS.TASK_ASSIGNED, 'task', id);

    req.session.success = 'Task assigned!';
    res.redirect(`/manager/shifts/${id}`);
  } catch (error) {
    console.error('Error assigning task:', error);
    redirectWithFlash(req, res, `/manager/shifts/${req.params.id}`, {
      error: 'Error assigning task.'
    });
  }
});

// PUT /manager/tasks/:id - Update task
router.put('/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, priority, notes } = req.body;

    const task = await TaskAssignment.findByPk(id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    await task.update({
      status: status || task.status,
      priority: priority || task.priority,
      notes: notes !== undefined ? notes : task.notes
    });

    res.json({ success: true, task });
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Error updating task' });
  }
});

// DELETE /manager/tasks/:id - Delete task
router.delete('/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const task = await TaskAssignment.findByPk(id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    await task.destroy();

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Error deleting task' });
  }
});

// GET /manager/reports/download/:type - Download CSV report
router.get('/reports/download/:type', async (req, res) => {
  try {
    const { type } = req.params;
    const { start, end } = req.query;

    const startDate = start || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const endDate = end || new Date().toISOString().split('T')[0];

    let csvContent = '';
    let filename = '';

    if (type === 'daily') {
      // Daily Operations Report
      const completions = await ChecklistCompletion.findAll({
        where: {
          completedAt: {
            [Op.between]: [new Date(startDate), new Date(endDate + 'T23:59:59')]
          }
        },
        include: [
          { model: User, as: 'User', attributes: ['fullName'] },
          { model: ChecklistItem, as: 'ChecklistItem', attributes: ['text', 'checklistId'] }
        ]
      });

      csvContent = 'Date,Shift,Task,Completed By,Status,Completed At,Notes\n';
      completions.forEach(c => {
        const date = c.date || c.completedAt?.toISOString().split('T')[0];
        const hour = c.completedAt ? new Date(c.completedAt).getHours() : 8;
        let shift = 'Morning';
        if (hour >= 12 && hour < 17) shift = 'Midday';
        else if (hour >= 17) shift = 'Evening';
        const userName = c.User ? c.User.fullName : 'Unknown';
        const taskText = c.ChecklistItem ? c.ChecklistItem.text : 'Unknown';
        const completedAt = c.completedAt ? new Date(c.completedAt).toISOString() : '';
        const notes = (c.notes || '').replace(/,/g, ';').replace(/\n/g, ' ');
        csvContent += `${date},${shift},"${taskText}","${userName}",${c.status},${completedAt},"${notes}"\n`;
      });
      filename = `daily-operations-${startDate}-to-${endDate}.csv`;

    } else if (type === 'staff') {
      // Staff Performance Report
      const completions = await ChecklistCompletion.findAll({
        where: {
          completedAt: {
            [Op.between]: [new Date(startDate), new Date(endDate + 'T23:59:59')]
          },
          status: 'COMPLETED'
        }
      });

      const staff = await User.findAll({ where: { role: 'STAFF' } });
      const staffMap = {};
      staff.forEach(s => {
        staffMap[s.id] = { fullName: s.fullName, tasksCompleted: 0 };
      });
      completions.forEach(c => {
        if (c.userId && staffMap[c.userId]) {
          staffMap[c.userId].tasksCompleted++;
        }
      });

      csvContent = 'Staff Member,Tasks Completed,Performance Rating\n';
      Object.values(staffMap).forEach(s => {
        let rating = 'No Activity';
        if (s.tasksCompleted > 10) rating = 'Excellent';
        else if (s.tasksCompleted > 5) rating = 'Good';
        else if (s.tasksCompleted > 0) rating = 'Fair';
        csvContent += `"${s.fullName}",${s.tasksCompleted},${rating}\n`;
      });
      filename = `staff-performance-${startDate}-to-${endDate}.csv`;

    } else if (type === 'checklist') {
      // Checklist Completion Report
      const checklists = await Checklist.findAll({
        include: [{ model: ChecklistItem, as: 'items' }]
      });

      const completions = await ChecklistCompletion.findAll({
        where: {
          date: { [Op.between]: [startDate, endDate] },
          status: 'COMPLETED'
        }
      });

      csvContent = 'Checklist,Shift Type,Total Items,Completed Items,Completion %,Status\n';
      checklists.forEach(cl => {
        const checklistTotalItems = cl.items ? cl.items.length : 0;
        const completedItems = completions.filter(c =>
          cl.items && cl.items.some(i => i.id === c.checklistItemId)
        ).length;
        const percent = checklistTotalItems > 0 ? Math.round((completedItems / checklistTotalItems) * 100) : 0;
        let status = percent === 100 ? 'Completed' : percent > 0 ? 'In Progress' : 'Pending';
        let shiftType = cl.shiftType || 'Other';
        csvContent += `"${cl.title}",${shiftType},${checklistTotalItems},${completedItems},${percent}%,${status}\n`;
      });
      filename = `checklist-completion-${startDate}-to-${endDate}.csv`;
    } else if (type === 'inventory') {
      // Inventory Report
      const { InventoryItem } = require('../models');
      const inventory = await InventoryItem.findAll({
        order: [['name', 'ASC']]
      });

      csvContent = 'Item Name,Category,Quantity,Unit,Reorder Level,Status\n';
      inventory.forEach(item => {
        let status = 'In Stock';
        if (item.quantityOnHand === 0) status = 'Out of Stock';
        else if (item.quantityOnHand <= item.reorderLevel) status = 'Low Stock';
        csvContent += `"${item.name}","${item.category || 'Uncategorized'}",${item.quantityOnHand},"${item.unit || '-'} ${item.reorderLevel}",${status}\n`;
      });
      filename = `inventory-report-${new Date().toISOString().split('T')[0]}.csv`;
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvContent);
  } catch (error) {
    console.error('Error downloading report:', error);
    res.status(500).send('Error generating report');
  }
});

// GET /manager/swap-requests - View all swap requests
router.get('/swap-requests', async (req, res) => {
  try {
    const { status } = req.query;
    let whereClause = {};
    if (status) whereClause.status = status;

    const swapRequests = await ShiftSwap.findAll({
      where: whereClause,
      include: [
        { model: User, as: 'requester' },
        { model: Shift, as: 'targetShift' },
        { model: Shift, as: 'desiredShift' },
        { model: User, as: 'targetUser' },
        { model: User, as: 'approver' }
      ],
      order: [['createdAt', 'DESC']]
    });

    renderWithFlash(req, res, 'manager/swap-requests', {
      title: 'Shift Swap Requests',
      activePage: 'swap-requests',
      swapRequests,
      filters: { status }
    });
  } catch (error) {
    console.error('Error loading swap requests:', error);
    renderWithFlash(req, res, 'manager/swap-requests', {
      title: 'Shift Swap Requests',
      activePage: 'swap-requests',
      swapRequests: [],
      filters: {}
    });
  }
});

// POST /manager/swap-requests/:id/approve - Approve swap request
router.post('/swap-requests/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const managerId = req.session.user.id;
    const comment = toTrimmedString(req.body.comment, { maxLength: 1000, allowEmpty: true });

    const swapRequest = await ShiftSwap.findByPk(id);
    if (!swapRequest) {
      return redirectWithFlash(req, res, '/manager/swap-requests', {
        error: 'Swap request not found'
      });
    }

    if (swapRequest.status !== 'PENDING') {
      return redirectWithFlash(req, res, '/manager/swap-requests', {
        error: 'Only pending swap requests can be approved.'
      });
    }

    if (swapRequest.targetUserId && swapRequest.targetAccepted !== true) {
      return redirectWithFlash(req, res, '/manager/swap-requests', {
        error: 'Wait for the target staff member to accept before approving this swap.'
      });
    }

    // Update the swap request
    await swapRequest.update({
      status: 'APPROVED',
      approvedBy: managerId,
      approvedAt: new Date(),
      managerComment: comment || null
    });

    // If swapping with another user, update the assignments
    if (swapRequest.targetUserId) {
      const targetAssignment = await ShiftAssignment.findOne({
        where: { shiftId: swapRequest.targetShiftId, userId: swapRequest.targetUserId }
      });
      const requesterAssignment = await ShiftAssignment.findOne({
        where: { shiftId: swapRequest.targetShiftId, userId: swapRequest.requesterId }
      });

      if (targetAssignment && requesterAssignment) {
        // Swap user IDs
        await targetAssignment.update({ userId: swapRequest.requesterId });
        await requesterAssignment.update({ userId: swapRequest.targetUserId });
      }
    }

    redirectWithFlash(req, res, '/manager/swap-requests', {
      success: 'Swap request approved!'
    });
  } catch (error) {
    console.error('Error approving swap request:', error);
    redirectWithFlash(req, res, '/manager/swap-requests', {
      error: 'Error approving swap request'
    });
  }
});

// POST /manager/swap-requests/:id/reject - Reject swap request
router.post('/swap-requests/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const managerId = req.session.user.id;
    const comment = toTrimmedString(req.body.comment, { maxLength: 1000, allowEmpty: true });

    const swapRequest = await ShiftSwap.findByPk(id);
    if (!swapRequest) {
      return redirectWithFlash(req, res, '/manager/swap-requests', {
        error: 'Swap request not found'
      });
    }

    if (swapRequest.status !== 'PENDING') {
      return redirectWithFlash(req, res, '/manager/swap-requests', {
        error: 'Only pending swap requests can be rejected.'
      });
    }

    await swapRequest.update({
      status: 'REJECTED',
      approvedBy: managerId,
      approvedAt: new Date(),
      managerComment: comment || null
    });

    redirectWithFlash(req, res, '/manager/swap-requests', {
      success: 'Swap request rejected'
    });
  } catch (error) {
    console.error('Error rejecting swap request:', error);
    redirectWithFlash(req, res, '/manager/swap-requests', {
      error: 'Error rejecting swap request'
    });
  }
});

// GET /manager/leave-requests - View all leave requests
router.get('/leave-requests', async (req, res) => {
  try {
    const { status } = req.query;
    let whereClause = {};
    if (status) whereClause.status = status;

    const leaveRequests = await LeaveRequest.findAll({
      where: whereClause,
      include: [
        { model: User, as: 'user' },
        { model: User, as: 'approver' }
      ],
      order: [['createdAt', 'DESC']]
    });

    renderWithFlash(req, res, 'manager/leave-requests', {
      title: 'Leave Requests',
      activePage: 'leave-requests',
      leaveRequests,
      filters: { status }
    });
  } catch (error) {
    console.error('Error loading leave requests:', error);
    renderWithFlash(req, res, 'manager/leave-requests', {
      title: 'Leave Requests',
      activePage: 'leave-requests',
      leaveRequests: [],
      filters: {}
    });
  }
});

// POST /manager/leave-requests/:id/approve - Approve leave request
router.post('/leave-requests/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const managerId = req.session.user.id;
    const comment = toTrimmedString(req.body.comment, { maxLength: 1000, allowEmpty: true });

    const leaveRequest = await LeaveRequest.findByPk(id);
    if (!leaveRequest) {
      return redirectWithFlash(req, res, '/manager/leave-requests', {
        error: 'Leave request not found'
      });
    }

    if (leaveRequest.status !== 'PENDING') {
      return redirectWithFlash(req, res, '/manager/leave-requests', {
        error: 'Only pending leave requests can be approved.'
      });
    }

    await leaveRequest.update({
      status: 'APPROVED',
      approvedBy: managerId,
      approvedAt: new Date(),
      managerComment: comment || null
    });

    redirectWithFlash(req, res, '/manager/leave-requests', {
      success: 'Leave request approved!'
    });
  } catch (error) {
    console.error('Error approving leave request:', error);
    redirectWithFlash(req, res, '/manager/leave-requests', {
      error: 'Error approving leave request'
    });
  }
});

// POST /manager/leave-requests/:id/reject - Reject leave request
router.post('/leave-requests/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const managerId = req.session.user.id;
    const comment = toTrimmedString(req.body.comment, { maxLength: 1000, allowEmpty: true });

    const leaveRequest = await LeaveRequest.findByPk(id);
    if (!leaveRequest) {
      return redirectWithFlash(req, res, '/manager/leave-requests', {
        error: 'Leave request not found'
      });
    }

    if (leaveRequest.status !== 'PENDING') {
      return redirectWithFlash(req, res, '/manager/leave-requests', {
        error: 'Only pending leave requests can be rejected.'
      });
    }

    await leaveRequest.update({
      status: 'REJECTED',
      approvedBy: managerId,
      approvedAt: new Date(),
      managerComment: comment || null
    });

    redirectWithFlash(req, res, '/manager/leave-requests', {
      success: 'Leave request rejected'
    });
  } catch (error) {
    console.error('Error rejecting leave request:', error);
    redirectWithFlash(req, res, '/manager/leave-requests', {
      error: 'Error rejecting leave request'
    });
  }
});

module.exports = router;
