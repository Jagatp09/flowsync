const express = require('express');
const router = express.Router();
const { Checklist, ChecklistItem, ChecklistCompletion, User, StaffAttendance, InventoryItem, Shift, ShiftAssignment, ShiftNote, TaskAssignment } = require('../models');

// Middleware to check authentication
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
};

// Middleware to check staff role (allows both STAFF and MANAGER)
const requireStaff = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
};

// Apply middleware to all staff routes
router.use(requireAuth, requireStaff);

// GET /staff/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const today = new Date().toISOString().split('T')[0];

    // Get all checklists with items
    const checklists = await Checklist.findAll({
      where: { isActive: true },
      include: [{
        model: ChecklistItem,
        as: 'items'
      }],
      order: [['shiftType', 'ASC']]
    });

    // Get user's completions for today
    const completions = await ChecklistCompletion.findAll({
      where: { userId: userId, date: today }
    });

    const completionMap = {};
    completions.forEach(c => {
      completionMap[c.checklistItemId] = c;
    });

    let totalTasks = 0;
    let completedTasks = 0;
    let inProgressTasks = 0;

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

    checklists.forEach(cl => {
      cl.items.forEach(item => {
        totalTasks++;
        const completion = completionMap[item.id];
        if (completion) {
          if (completion.status === 'COMPLETED') completedTasks++;
          else if (completion.status === 'IN_PROGRESS') inProgressTasks++;
        }
      });
    });

    const stats = {
      total: totalTasks,
      completed: completedTasks,
      remaining: totalTasks - completedTasks - inProgressTasks,
      inProgress: inProgressTasks,
      percentage: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
    };

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
        nextShiftDate: getNextShiftDate()
      });
    }

    // Calculate next shift date (demo: tomorrow)
    const nextShiftDate = attendance.nextShiftDate || getNextShiftDate();

    // Get today's assigned shift
    const todayShift = await Shift.findOne({
      where: { shiftDate: today, status: { [require('sequelize').Op.or]: ['SCHEDULED', 'ACTIVE'] } },
      include: [{
        model: ShiftAssignment,
        as: 'assignments',
        where: { userId: userId },
        required: false
      }]
    });

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

    res.render('staff/dashboard', {
      title: 'Dashboard',
      activePage: 'dashboard',
      stats: stats,
      recentTasks: recentTasks,
      attendance: attendance,
      nextShiftDate: nextShiftDate,
      myShift: todayShift ? todayShift.toJSON() : null,
      shiftNotes: shiftNotes.map(n => n.toJSON()),
      myTasks: myTasks.map(t => t.toJSON())
    });
  } catch (error) {
    console.error('Error loading staff dashboard:', error);
    res.render('staff/dashboard', {
      title: 'Dashboard',
      activePage: 'dashboard',
      stats: { total: 0, completed: 0, remaining: 0, inProgress: 0, percentage: 0 },
      recentTasks: [],
      myTasks: [],
      attendance: { status: 'NOT_STARTED' },
      nextShiftDate: getNextShiftDate(),
      myShift: null,
      shiftNotes: []
    });
  }
});

// Helper function to get next shift date (demo: tomorrow)
function getNextShiftDate() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

// POST /staff/clock-out
router.post('/clock-out', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const today = new Date().toISOString().split('T')[0];

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
        nextShiftDate: getNextShiftDate()
      });
    } else {
      // Update existing record
      await attendance.update({
        clockOutTime: new Date(),
        status: 'CLOCKED_OUT',
        nextShiftDate: getNextShiftDate()
      });
    }

    req.session.success = 'Successfully clocked out! Have a great day.';
    res.redirect('/staff/dashboard');
  } catch (error) {
    console.error('Error clocking out:', error);
    req.session.error = 'Error clocking out. Please try again.';
    res.redirect('/staff/dashboard');
  }
});

// POST /staff/clock-in
router.post('/clock-in', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const today = new Date().toISOString().split('T')[0];

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
        nextShiftDate: getNextShiftDate()
      });
    } else {
      // Update existing record
      await attendance.update({
        clockInTime: new Date(),
        status: 'CLOCKED_IN'
      });
    }

    req.session.success = 'Welcome back! You are now clocked in.';
    res.redirect('/staff/dashboard');
  } catch (error) {
    console.error('Error clocking in:', error);
    req.session.error = 'Error clocking in. Please try again.';
    res.redirect('/staff/dashboard');
  }
});

// GET /staff/tasks - redirect to daily checklist
router.get('/tasks', (req, res) => {
  res.redirect('/checklists/daily');
});

// GET /staff/activity - placeholder
router.get('/activity', async (req, res) => {
  try {
    const userId = req.session.user.id;
    const today = new Date().toISOString().split('T')[0];

    // Get recent completions for this user
    const completions = await ChecklistCompletion.findAll({
      where: { userId: userId },
      include: [{ model: ChecklistItem, as: 'ChecklistItem', attributes: ['text'] }],
      order: [['completedAt', 'DESC']],
      limit: 20
    });

    res.render('staff/activity', {
      title: 'Activity',
      activePage: 'activity',
      activities: completions
    });
  } catch (error) {
    console.error('Error loading activity:', error);
    res.render('staff/activity', {
      title: 'Activity',
      activePage: 'activity',
      activities: []
    });
  }
});

// GET /staff/settings - placeholder
router.get('/settings', (req, res) => {
  res.render('staff/settings', {
    title: 'Settings',
    activePage: 'settings'
  });
});

// GET /staff/profile - Staff profile page
router.get('/profile', (req, res) => {
  res.render('staff/profile', {
    title: 'Profile',
    activePage: 'profile'
  });
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
    const { status } = req.body;
    const userId = req.session.user.id;

    const task = await TaskAssignment.findByPk(id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Verify the task is assigned to this user
    if (task.assignedTo !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    await task.update({ status: status || task.status });

    // Log activity
    if (status === 'DONE') {
      const { logActivity, ACTIONS } = require('../utils/activityLogger');
      await logActivity(userId, ACTIONS.TASK_COMPLETED, 'task', id);
    }

    res.json({ success: true, task });
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Error updating task' });
  }
});

module.exports = router;
