const express = require('express');
const router = express.Router();
const { ChecklistItem, ChecklistCompletion, User, StaffAttendance, InventoryItem, Shift, ShiftAssignment, ShiftNote, TaskAssignment, ShiftSwap, LeaveRequest } = require('../models');
const { Op } = require('sequelize');
const { requireAuth, requireStaff } = require('../utils/middleware');
const { getChecklistProgressForUser, getAssignedChecklistShiftTypes } = require('../utils/shiftAccess');
const { redirectWithFlash, renderWithFlash } = require('../utils/flash');
const { normalizeDate, normalizeEnum, normalizeInteger, toTrimmedString } = require('../utils/validation');

// Apply middleware to all staff routes
router.use(requireAuth, requireStaff);

const LEAVE_TYPES = ['ANNUAL', 'SICK', 'PERSONAL', 'EMERGENCY', 'OTHER'];
const TASK_STATUSES = ['OPEN', 'DONE'];

function getToday() {
  return new Date().toISOString().split('T')[0];
}

function formatShiftWindow(shift) {
  if (!shift) {
    return 'No shift assigned';
  }

  if (shift.scheduledStart && shift.scheduledEnd) {
    return `${shift.scheduledStart} - ${shift.scheduledEnd}`;
  }

  if (shift.scheduledStart) {
    return `${shift.scheduledStart} start`;
  }

  return 'Time to be confirmed';
}

// GET /staff/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const today = getToday();
    const { stats, completions } = await getChecklistProgressForUser(userId, today);

    // Get recent completed tasks
    const recentCompleted = completions
      .filter(c => c.status === 'COMPLETED' && c.completedAt)
      .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))
      .slice(0, 5);

    // Get task details for recent completions
    const recentTasks = await Promise.all(recentCompleted.map(async (c) => {
      const item = await ChecklistItem.findByPk(c.checklistItemId);
      return {
        ...c.toJSON(),
        itemText: item ? item.text : 'Unknown task'
      };
    }));

    // Get today's attendance record
    let attendance = await StaffAttendance.findOne({
      where: { userId: userId, date: today }
    });

    // If no attendance record exists, create one with NOT_STARTED status
    if (!attendance) {
      attendance = await StaffAttendance.create({
        userId: userId,
        date: today,
        status: 'NOT_STARTED',
        nextShiftDate: null
      });
    }

    const todayAssignment = await ShiftAssignment.findOne({
      where: { userId },
      include: [{
        model: Shift,
        as: 'Shift',
        required: true,
        where: {
          shiftDate: today,
          status: { [Op.in]: ['SCHEDULED', 'ACTIVE'] }
        }
      }],
      order: [[{ model: Shift, as: 'Shift' }, 'scheduledStart', 'ASC']]
    });
    const todayShift = todayAssignment?.Shift || null;

    const nextAssignment = await ShiftAssignment.findOne({
      where: { userId },
      include: [{
        model: Shift,
        as: 'Shift',
        required: true,
        where: {
          shiftDate: { [Op.gte]: today },
          status: { [Op.in]: ['SCHEDULED', 'ACTIVE'] }
        }
      }],
      order: [
        [{ model: Shift, as: 'Shift' }, 'shiftDate', 'ASC'],
        [{ model: Shift, as: 'Shift' }, 'scheduledStart', 'ASC']
      ]
    });
    const nextShift = nextAssignment?.Shift || null;
    const nextShiftDate = nextShift?.shiftDate || attendance.nextShiftDate || null;

    if (attendance.nextShiftDate !== nextShiftDate) {
      await attendance.update({ nextShiftDate });
    }

    // Get previous shift notes if any
    let shiftNotes = [];
    if (todayShift) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      const prevShift = await Shift.findOne({
        where: { shiftDate: yesterdayStr, status: 'CLOSED' }
      });
      if (prevShift) {
        shiftNotes = await ShiftNote.findAll({
          where: { shiftId: prevShift.id },
          include: [{ model: User, as: 'author', attributes: ['fullName'] }],
          order: [['createdAt', 'DESC']],
          limit: 5
        });
      }
    }

    // Get tasks assigned to this user
    const myTasks = await TaskAssignment.findAll({
      where: { assignedTo: userId },
      include: [
        { model: Shift, attributes: ['id', 'shiftType', 'shiftDate'] },
        { model: ChecklistItem, attributes: ['text'] }
      ],
      order: [['priority', 'DESC'], ['createdAt', 'DESC']]
    });

    renderWithFlash(req, res, 'staff/dashboard', {
      title: 'Dashboard',
      activePage: 'dashboard',
      stats,
      recentTasks: recentTasks,
      attendance: attendance.toJSON ? attendance.toJSON() : attendance,
      nextShiftDate,
      myShift: todayShift ? todayShift.toJSON() : null,
      nextShift: nextShift ? nextShift.toJSON() : null,
      shiftWindow: formatShiftWindow(todayShift),
      shiftNotes: shiftNotes.map(n => n.toJSON()),
      myTasks: myTasks.map(t => t.toJSON()),
      assignedShiftTypes: await getAssignedChecklistShiftTypes(userId, today)
    });
  } catch (error) {
    console.error('Error loading staff dashboard:', error);
    renderWithFlash(req, res, 'staff/dashboard', {
      title: 'Dashboard',
      activePage: 'dashboard',
      stats: { total: 0, completed: 0, remaining: 0, inProgress: 0, percentage: 0 },
      recentTasks: [],
      myTasks: [],
      attendance: { status: 'NOT_STARTED' },
      nextShiftDate: null,
      myShift: null,
      nextShift: null,
      shiftWindow: 'No shift assigned',
      shiftNotes: [],
      assignedShiftTypes: []
    });
  }
});

// POST /staff/clock-out
router.post('/clock-out', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const today = getToday();
    const nextAssignment = await ShiftAssignment.findOne({
      where: { userId },
      include: [{
        model: Shift,
        as: 'Shift',
        required: true,
        where: {
          shiftDate: { [Op.gt]: today },
          status: { [Op.in]: ['SCHEDULED', 'ACTIVE'] }
        }
      }],
      order: [
        [{ model: Shift, as: 'Shift' }, 'shiftDate', 'ASC'],
        [{ model: Shift, as: 'Shift' }, 'scheduledStart', 'ASC']
      ]
    });
    const nextShiftDate = nextAssignment?.Shift?.shiftDate || null;

    // Find or create today's attendance record
    let attendance = await StaffAttendance.findOne({
      where: { userId: userId, date: today }
    });

    if (!attendance) {
      attendance = await StaffAttendance.create({
        userId: userId,
        date: today,
        clockInTime: new Date(),
        status: 'CLOCKED_OUT',
        clockOutTime: new Date(),
        nextShiftDate
      });
    } else {
      // Update existing record
      await attendance.update({
        clockOutTime: new Date(),
        status: 'CLOCKED_OUT',
        nextShiftDate
      });
    }

    redirectWithFlash(req, res, '/staff/dashboard', {
      success: 'Successfully clocked out! Have a great day.'
    });
  } catch (error) {
    console.error('Error clocking out:', error);
    redirectWithFlash(req, res, '/staff/dashboard', {
      error: 'Error clocking out. Please try again.'
    });
  }
});

// POST /staff/clock-in
router.post('/clock-in', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const today = getToday();

    // Find or create today's attendance record
    let attendance = await StaffAttendance.findOne({
      where: { userId: userId, date: today }
    });

    if (!attendance) {
      attendance = await StaffAttendance.create({
        userId: userId,
        date: today,
        clockInTime: new Date(),
        status: 'CLOCKED_IN',
        nextShiftDate: null
      });
    } else {
      // Update existing record
      await attendance.update({
        clockInTime: new Date(),
        status: 'CLOCKED_IN'
      });
    }

    redirectWithFlash(req, res, '/staff/dashboard', {
      success: 'Welcome back! You are now clocked in.'
    });
  } catch (error) {
    console.error('Error clocking in:', error);
    redirectWithFlash(req, res, '/staff/dashboard', {
      error: 'Error clocking in. Please try again.'
    });
  }
});

// GET /staff/tasks - redirect to daily checklist
router.get('/tasks', (req, res) => {
  res.redirect('/checklists/daily');
});

// GET /staff/activity
router.get('/activity', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const today = getToday();
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    const [completions, recentTasks, attendanceLogs, leaveRequests, swapRequests, openTasks] = await Promise.all([
      ChecklistCompletion.findAll({
        where: { userId },
        include: [{ model: ChecklistItem, as: 'ChecklistItem', attributes: ['text'] }],
        order: [['completedAt', 'DESC'], ['createdAt', 'DESC']],
        limit: 15
      }),
      TaskAssignment.findAll({
        where: { assignedTo: userId },
        include: [{ model: Shift, attributes: ['shiftDate', 'shiftType'] }],
        order: [['updatedAt', 'DESC']],
        limit: 10
      }),
      StaffAttendance.findAll({
        where: { userId },
        order: [['date', 'DESC']],
        limit: 7
      }),
      LeaveRequest.findAll({
        where: { userId },
        order: [['createdAt', 'DESC']],
        limit: 5
      }),
      ShiftSwap.findAll({
        where: {
          [Op.or]: [
            { requesterId: userId },
            { targetUserId: userId }
          ]
        },
        include: [{ model: Shift, as: 'targetShift' }],
        order: [['createdAt', 'DESC']],
        limit: 5
      }),
      TaskAssignment.count({
        where: { assignedTo: userId, status: 'OPEN' }
      })
    ]);

    const activityFeed = [
      ...completions.map((activity) => ({
        id: `completion-${activity.id}`,
        type: 'checklist',
        status: activity.status,
        title: activity.ChecklistItem ? activity.ChecklistItem.text : 'Checklist task',
        meta: activity.completedAt ? `Completed on ${new Date(activity.completedAt).toLocaleString()}` : activity.status,
        createdAt: activity.completedAt || activity.createdAt
      })),
      ...recentTasks.map((task) => ({
        id: `task-${task.id}`,
        type: 'task',
        status: task.status,
        title: task.customTaskText || 'Assigned task',
        meta: task.Shift ? `${task.Shift.shiftType} shift on ${new Date(task.Shift.shiftDate).toLocaleDateString()}` : 'Task assignment updated',
        createdAt: task.updatedAt || task.createdAt
      })),
      ...attendanceLogs.map((attendance) => ({
        id: `attendance-${attendance.id}-${attendance.date}`,
        type: 'attendance',
        status: attendance.status,
        title: `Attendance ${attendance.status.toLowerCase().replace('_', ' ')}`,
        meta: new Date(attendance.date).toLocaleDateString(),
        createdAt: attendance.clockOutTime || attendance.clockInTime || new Date(`${attendance.date}T00:00:00`)
      })),
      ...leaveRequests.map((request) => ({
        id: `leave-${request.id}`,
        type: 'leave',
        status: request.status,
        title: `${request.leaveType} leave request`,
        meta: `${new Date(request.startDate).toLocaleDateString()} to ${new Date(request.endDate).toLocaleDateString()}`,
        createdAt: request.createdAt
      })),
      ...swapRequests.map((request) => ({
        id: `swap-${request.id}`,
        type: 'swap',
        status: request.status,
        title: request.targetShift ? `Swap request for ${request.targetShift.title || request.targetShift.shiftType}` : 'Swap request',
        meta: request.targetAccepted === false ? 'Target staff rejected' : request.targetAccepted === true ? 'Target staff accepted' : 'Awaiting response',
        createdAt: request.createdAt
      }))
    ].sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt)).slice(0, 20);

    const completedThisWeek = completions.filter((activity) => {
      const completedAt = activity.completedAt || activity.createdAt;
      return completedAt && new Date(completedAt) >= weekStart && activity.status === 'COMPLETED';
    }).length;

    renderWithFlash(req, res, 'staff/activity', {
      title: 'Activity',
      activePage: 'activity',
      activities: activityFeed,
      stats: {
        completedThisWeek,
        openTasks,
        pendingRequests: leaveRequests.filter((request) => request.status === 'PENDING').length
          + swapRequests.filter((request) => request.status === 'PENDING').length,
        today
      }
    });
  } catch (error) {
    console.error('Error loading activity:', error);
    renderWithFlash(req, res, 'staff/activity', {
      title: 'Activity',
      activePage: 'activity',
      activities: [],
      stats: {
        completedThisWeek: 0,
        openTasks: 0,
        pendingRequests: 0,
        today: getToday()
      }
    });
  }
});

// GET /staff/settings
router.get('/settings', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const today = getToday();

    const [user, assignedShiftTypes, nextAssignment, managerContact] = await Promise.all([
      User.findByPk(userId),
      getAssignedChecklistShiftTypes(userId, today),
      ShiftAssignment.findOne({
        where: { userId },
        include: [{
          model: Shift,
          as: 'Shift',
          required: true,
          where: {
            shiftDate: { [Op.gte]: today },
            status: { [Op.in]: ['SCHEDULED', 'ACTIVE'] }
          }
        }],
        order: [
          [{ model: Shift, as: 'Shift' }, 'shiftDate', 'ASC'],
          [{ model: Shift, as: 'Shift' }, 'scheduledStart', 'ASC']
        ]
      }),
      User.findOne({
        where: { role: 'MANAGER', isActive: true },
        attributes: ['fullName', 'email']
      })
    ]);

    renderWithFlash(req, res, 'staff/settings', {
      title: 'Settings',
      activePage: 'settings',
      user: user ? user.toJSON() : req.session.user,
      assignedShiftTypes,
      nextShift: nextAssignment?.Shift ? nextAssignment.Shift.toJSON() : null,
      managerContact: managerContact ? managerContact.toJSON() : null
    });
  } catch (error) {
    console.error('Error loading settings:', error);
    renderWithFlash(req, res, 'staff/settings', {
      title: 'Settings',
      activePage: 'settings',
      user: req.session.user,
      assignedShiftTypes: [],
      nextShift: null,
      managerContact: null
    });
  }
});

// GET /staff/profile - Staff profile page
router.get('/profile', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const today = getToday();
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    const [user, upcomingAssignments, attendanceLogs, recentLeaveRequests, completedThisWeek, openTasks] = await Promise.all([
      User.findByPk(userId),
      ShiftAssignment.findAll({
        where: { userId },
        include: [{
          model: Shift,
          as: 'Shift',
          required: true,
          where: {
            shiftDate: { [Op.gte]: today },
            status: { [Op.in]: ['SCHEDULED', 'ACTIVE'] }
          }
        }],
        order: [
          [{ model: Shift, as: 'Shift' }, 'shiftDate', 'ASC'],
          [{ model: Shift, as: 'Shift' }, 'scheduledStart', 'ASC']
        ],
        limit: 3
      }),
      StaffAttendance.findAll({
        where: { userId },
        order: [['date', 'DESC']],
        limit: 5
      }),
      LeaveRequest.findAll({
        where: { userId },
        order: [['createdAt', 'DESC']],
        limit: 3
      }),
      ChecklistCompletion.count({
        where: {
          userId,
          status: 'COMPLETED',
          completedAt: { [Op.gte]: weekStart }
        }
      }),
      TaskAssignment.count({
        where: { assignedTo: userId, status: 'OPEN' }
      })
    ]);

    renderWithFlash(req, res, 'staff/profile', {
      title: 'Profile',
      activePage: 'profile',
      user: user ? user.toJSON() : req.session.user,
      stats: {
        completedThisWeek,
        openTasks,
        upcomingShifts: upcomingAssignments.length
      },
      upcomingAssignments: upcomingAssignments.map((assignment) => assignment.toJSON()),
      attendanceLogs: attendanceLogs.map((attendance) => attendance.toJSON()),
      recentLeaveRequests: recentLeaveRequests.map((request) => request.toJSON())
    });
  } catch (error) {
    console.error('Error loading profile:', error);
    renderWithFlash(req, res, 'staff/profile', {
      title: 'Profile',
      activePage: 'profile',
      user: req.session.user,
      stats: {
        completedThisWeek: 0,
        openTasks: 0,
        upcomingShifts: 0
      },
      upcomingAssignments: [],
      attendanceLogs: [],
      recentLeaveRequests: []
    });
  }
});

// GET /staff/inventory - Staff inventory list (read-only)
router.get('/inventory', async (req, res) => {
  try {
    const items = await InventoryItem.findAll({
      order: [['name', 'ASC']]
    });

    res.render('staff/inventory', {
      title: 'Inventory',
      activePage: 'inventory',
      items: items.map(i => i.toJSON())
    });
  } catch (error) {
    console.error('Error loading inventory:', error);
    res.render('staff/inventory', {
      title: 'Inventory',
      activePage: 'inventory',
      items: []
    });
  }
});

// PUT /staff/tasks/:id - Update task status (mark complete)
router.put('/tasks/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const status = normalizeEnum(req.body.status, TASK_STATUSES);
    const userId = req.session.user.id;

    const task = await TaskAssignment.findByPk(id);
    if (!task) {
      if (req.accepts('html')) {
        return redirectWithFlash(req, res, '/staff/dashboard', { error: 'Task not found.' });
      }

      return res.status(404).json({ error: 'Task not found' });
    }

    // Verify the task is assigned to this user
    if (task.assignedTo !== userId) {
      if (req.accepts('html')) {
        return redirectWithFlash(req, res, '/staff/dashboard', { error: 'Not authorized to update that task.' });
      }

      return res.status(403).json({ error: 'Not authorized' });
    }

    if (!status) {
      if (req.accepts('html')) {
        return redirectWithFlash(req, res, '/staff/dashboard', { error: 'Invalid task status.' });
      }

      return res.status(422).json({ error: 'Invalid task status' });
    }

    await task.update({ status });

    // Log activity
    if (status === 'DONE') {
      const { logActivity, ACTIONS } = require('../utils/activityLogger');
      await logActivity(userId, ACTIONS.TASK_COMPLETED, 'task', id);
    }

    if (req.accepts('html')) {
      return redirectWithFlash(req, res, req.get('referer') || '/staff/dashboard', {
        success: status === 'DONE' ? 'Task marked complete.' : 'Task updated.'
      });
    }

    res.json({ success: true, task });
  } catch (error) {
    console.error('Error updating task:', error);
    if (req.accepts('html')) {
      return redirectWithFlash(req, res, '/staff/dashboard', {
        error: 'Error updating task.'
      });
    }

    res.status(500).json({ error: 'Error updating task' });
  }
});

// GET /staff/swap-requests - View swap requests
router.get('/swap-requests', async (req, res) => {
  let myShifts = [];
  let allShifts = [];
  let swapRequests = [];
  let staffMembers = [];

  try {
    if (!req.session || !req.session.user || !req.session.user.id) {
      return res.redirect('/login');
    }
    const userId = req.session.user.id;

    // Get shifts assigned to the user
    myShifts = await ShiftAssignment.findAll({
      where: { userId: userId },
      include: [{ model: Shift, as: 'Shift' }],
      order: [['createdAt', 'DESC']]
    });

    // Also get all available shifts
    allShifts = await Shift.findAll({
      order: [['shiftDate', 'ASC'], ['scheduledStart', 'ASC']],
      limit: 50
    });

    // Get all staff members (excluding current user)
    staffMembers = await User.findAll({
      where: { id: { [require('sequelize').Op.ne]: userId } },
      attributes: ['id', 'fullName', 'email'],
      order: [['fullName', 'ASC']]
    });

    // Get user's pending swap requests
    swapRequests = await ShiftSwap.findAll({
      where: { requesterId: userId },
      include: [
        { model: Shift, as: 'targetShift' },
        { model: Shift, as: 'desiredShift' },
        { model: User, as: 'targetUser', attributes: ['id', 'fullName'] }
      ],
      order: [['createdAt', 'DESC']]
    });

    renderWithFlash(req, res, 'staff/swap-requests', {
      title: 'Shift Swap Requests',
      activePage: 'swap-requests',
      swapRequests: swapRequests,
      myShifts: myShifts,
      allShifts: allShifts,
      staffMembers: staffMembers
    });
  } catch (error) {
    console.error('Error loading swap requests:', error);
    renderWithFlash(req, res, 'staff/swap-requests', {
      title: 'Shift Swap Requests',
      activePage: 'swap-requests',
      swapRequests: [],
      myShifts: [],
      allShifts: [],
      staffMembers: []
    });
  }
});

// POST /staff/swap-requests - Create swap request
router.post('/swap-requests', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const targetShiftId = normalizeInteger(req.body.targetShiftId, { min: 1 });
    const desiredShiftId = normalizeInteger(req.body.desiredShiftId, { min: 1, allowNull: true });
    const targetUserId = normalizeInteger(req.body.targetUserId, { min: 1 });
    const reason = toTrimmedString(req.body.reason, { maxLength: 1000, allowEmpty: true });

    if (Number.isNaN(targetShiftId) || Number.isNaN(targetUserId)) {
      return redirectWithFlash(req, res, '/staff/swap-requests', {
        error: 'Select a valid shift and staff member.'
      });
    }

    if (targetUserId === userId) {
      return redirectWithFlash(req, res, '/staff/swap-requests', {
        error: 'You cannot request a swap with yourself.'
      });
    }

    const [requesterAssignment, targetUser, existingPendingRequest] = await Promise.all([
      ShiftAssignment.findOne({
        where: { userId, shiftId: targetShiftId }
      }),
      User.findOne({
        where: { id: targetUserId, role: 'STAFF', isActive: true }
      }),
      ShiftSwap.findOne({
        where: {
          requesterId: userId,
          targetShiftId,
          targetUserId,
          status: 'PENDING'
        }
      })
    ]);

    if (!requesterAssignment) {
      return redirectWithFlash(req, res, '/staff/swap-requests', {
        error: 'You can only request swaps for shifts assigned to you.'
      });
    }

    if (!targetUser) {
      return redirectWithFlash(req, res, '/staff/swap-requests', {
        error: 'Selected staff member is not available for swaps.'
      });
    }

    if (existingPendingRequest) {
      return redirectWithFlash(req, res, '/staff/swap-requests', {
        error: 'A pending request for that shift and staff member already exists.'
      });
    }

    await ShiftSwap.create({
      requesterId: userId,
      targetShiftId,
      desiredShiftId: Number.isNaN(desiredShiftId) ? null : desiredShiftId,
      targetUserId,
      reason: reason || null,
      status: 'PENDING'
    });

    redirectWithFlash(req, res, '/staff/swap-requests', {
      success: 'Swap request submitted!'
    });
  } catch (error) {
    console.error('Error creating swap request:', error);
    redirectWithFlash(req, res, '/staff/swap-requests', {
      error: 'Error creating swap request'
    });
  }
});

// GET /staff/incoming-swap-requests - View incoming swap requests (where user is target)
router.get('/incoming-swap-requests', async (req, res) => {
  try {
    const userId = req.session.user.id;

    // Get swap requests where current user is the target
    const incomingRequests = await ShiftSwap.findAll({
      where: { targetUserId: userId },
      include: [
        { model: User, as: 'requester', attributes: ['id', 'fullName', 'email'] },
        { model: Shift, as: 'targetShift' },
        { model: Shift, as: 'desiredShift' }
      ],
      order: [['createdAt', 'DESC']]
    });

    renderWithFlash(req, res, 'staff/incoming-swap-requests', {
      title: 'Incoming Swap Requests',
      activePage: 'incoming-swap-requests',
      incomingRequests: incomingRequests
    });
  } catch (error) {
    console.error('Error loading incoming swap requests:', error);
    renderWithFlash(req, res, 'staff/incoming-swap-requests', {
      title: 'Incoming Swap Requests',
      activePage: 'incoming-swap-requests',
      incomingRequests: []
    });
  }
});

// POST /staff/swap-requests/:id/accept - Accept swap request as target staff
router.post('/swap-requests/:id/accept', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { id } = req.params;

    const swapRequest = await ShiftSwap.findOne({
      where: { id: id, targetUserId: userId, status: 'PENDING' }
    });

    if (!swapRequest) {
      return redirectWithFlash(req, res, '/staff/incoming-swap-requests', {
        error: 'Swap request not found or already processed'
      });
    }

    // Update to mark as accepted by target
    swapRequest.targetAccepted = true;
    await swapRequest.save();

    redirectWithFlash(req, res, '/staff/incoming-swap-requests', {
      success: 'You have accepted the swap request!'
    });
  } catch (error) {
    console.error('Error accepting swap request:', error);
    redirectWithFlash(req, res, '/staff/incoming-swap-requests', {
      error: 'Error processing request'
    });
  }
});

// POST /staff/swap-requests/:id/reject - Reject swap request as target staff
router.post('/swap-requests/:id/reject', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { id } = req.params;
    const reason = toTrimmedString(req.body.reason, { maxLength: 1000, allowEmpty: true });

    const swapRequest = await ShiftSwap.findOne({
      where: { id: id, targetUserId: userId, status: 'PENDING' }
    });

    if (!swapRequest) {
      return redirectWithFlash(req, res, '/staff/incoming-swap-requests', {
        error: 'Swap request not found or already processed'
      });
    }

    // Update to mark as rejected by target
    swapRequest.targetAccepted = false;
    swapRequest.targetRejectionReason = reason || 'Rejected by staff';
    await swapRequest.save();

    redirectWithFlash(req, res, '/staff/incoming-swap-requests', {
      success: 'You have rejected the swap request'
    });
  } catch (error) {
    console.error('Error rejecting swap request:', error);
    redirectWithFlash(req, res, '/staff/incoming-swap-requests', {
      error: 'Error processing request'
    });
  }
});

// GET /staff/leave-requests - View leave requests
router.get('/leave-requests', async (req, res) => {
  try {
    const userId = req.session.user.id;

    const leaveRequests = await LeaveRequest.findAll({
      where: { userId: userId },
      include: [{ model: User, as: 'approver' }],
      order: [['createdAt', 'DESC']]
    });

    renderWithFlash(req, res, 'staff/leave-requests', {
      title: 'Leave Requests',
      activePage: 'leave-requests',
      leaveRequests
    });
  } catch (error) {
    console.error('Error loading leave requests:', error);
    renderWithFlash(req, res, 'staff/leave-requests', {
      title: 'Leave Requests',
      activePage: 'leave-requests',
      leaveRequests: []
    });
  }
});

// POST /staff/leave-requests - Create leave request
router.post('/leave-requests', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const leaveType = normalizeEnum(req.body.leaveType, LEAVE_TYPES);
    const startDate = normalizeDate(req.body.startDate);
    const endDate = normalizeDate(req.body.endDate);
    const reason = toTrimmedString(req.body.reason, { maxLength: 1000, allowEmpty: true });

    if (!leaveType || !startDate || !endDate) {
      return redirectWithFlash(req, res, '/staff/leave-requests', {
        error: 'Leave type, start date, and end date are required.'
      });
    }

    if (startDate > endDate) {
      return redirectWithFlash(req, res, '/staff/leave-requests', {
        error: 'Leave end date must be on or after the start date.'
      });
    }

    const existingOverlap = await LeaveRequest.findOne({
      where: {
        userId,
        status: { [Op.in]: ['PENDING', 'APPROVED'] },
        startDate: { [Op.lte]: endDate },
        endDate: { [Op.gte]: startDate }
      }
    });

    if (existingOverlap) {
      return redirectWithFlash(req, res, '/staff/leave-requests', {
        error: 'You already have a pending or approved leave request in that date range.'
      });
    }

    await LeaveRequest.create({
      userId,
      leaveType,
      startDate,
      endDate,
      reason: reason || null,
      status: 'PENDING'
    });

    redirectWithFlash(req, res, '/staff/leave-requests', {
      success: 'Leave request submitted!'
    });
  } catch (error) {
    console.error('Error creating leave request:', error);
    redirectWithFlash(req, res, '/staff/leave-requests', {
      error: 'Error creating leave request'
    });
  }
});

module.exports = router;
