const express = require('express');
const router = express.Router();
const { Checklist, ChecklistItem, ChecklistCompletion, User, ShiftReport, Shift, ShiftSummary, InventoryItem, InventoryLog, ShiftAssignment, ShiftNote, TaskAssignment } = require('../models');
const { Op } = require('sequelize');

// Middleware to check authentication
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
};

// Middleware to check manager role
const requireManager = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'MANAGER') {
    return res.status(403).send('Access denied. Manager access required.');
  }
  next();
};

// Apply middleware to all manager routes
router.use(requireAuth, requireManager);

// Helper function to get date range for a specific date
function getDateRange(dateStr) {
  const date = dateStr ? new Date(dateStr) : new Date();
  const startOfDay = new Date(date.setHours(0, 0, 0, 0));
  const endOfDay = new Date(date.setHours(23, 59, 59, 999));
  return { startOfDay, endOfDay, dateStr: date.toISOString().split('T')[0] };
}

// GET /manager/dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const { date } = req.query;
    const { startOfDay, endOfDay, dateStr } = getDateRange(date);

    const checklists = await Checklist.findAll({
      where: { isActive: true },
      include: [{ model: ChecklistItem, as: 'items' }],
      order: [['shiftType', 'ASC'], ['id', 'ASC']]
    });

    const completions = await ChecklistCompletion.findAll({
      where: { completedAt: { [Op.between]: [startOfDay, endOfDay] } },
      include: [
        { model: User, as: 'User', attributes: ['fullName'] },
        { model: ChecklistItem, as: 'ChecklistItem', attributes: ['text', 'checklistId'] }
      ]
    });

    const itemCompletionMap = {};
    completions.forEach(c => { itemCompletionMap[c.checklistItemId] = c; });

    let totalTasks = 0, completedTasks = 0, totalTime = 0, timeCount = 0;

    const checklistProgress = checklists.map(cl => {
      const items = cl.items;
      const itemCount = items.length;
      totalTasks += itemCount;
      let completedCount = 0;
      items.forEach(item => {
        const completion = itemCompletionMap[item.id];
        if (completion && completion.status === 'COMPLETED') {
          completedCount++;
          if (completion.completedAt) { totalTime += Math.random() * 15 + 5; timeCount++; }
        }
      });
      completedTasks += completedCount;
      const percent = itemCount > 0 ? Math.round((completedCount / itemCount) * 100) : 0;
      let status = percent === 100 ? 'Completed' : percent >= 80 ? 'On Track' : percent > 0 ? 'In Progress' : 'Scheduled';
      return { id: cl.id, title: cl.title, shiftType: cl.shiftType, totalItems: itemCount, completedItems: completedCount, percent, status };
    });

    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    const pendingTasks = totalTasks - completedTasks;
    const avgTaskTime = timeCount > 0 ? Math.round(totalTime / timeCount) : 0;

    const today = new Date().toISOString().split('T')[0];
    const { StaffAttendance } = require('../models');
    const activeStaff = await StaffAttendance.findAll({
      where: { date: today, status: 'CLOCKED_IN' },
      include: [{ model: User, as: 'User', attributes: ['fullName'] }]
    });
    const activeStaffCount = activeStaff.length;

    const allStaff = await User.findAll({ where: { role: 'STAFF' }, attributes: ['id', 'fullName'] });
    const staffCount = allStaff.length;

    const recentCompletions = await ChecklistCompletion.findAll({
      where: { status: 'COMPLETED', completedAt: { [Op.ne]: null } },
      include: [
        { model: User, as: 'User', attributes: ['fullName'] },
        { model: ChecklistItem, as: 'ChecklistItem', attributes: ['text'] }
      ],
      order: [['completedAt', 'DESC']], limit: 10
    });

    // Get staff who are clocked in today with their pending tasks
    const clockedInStaff = await StaffAttendance.findAll({
      where: {
        date: today,
        status: 'CLOCKED_IN'
      },
      include: [{ model: User, as: 'User', attributes: ['id', 'fullName'] }]
    });

    // Get all completions for today (grouped by user)
    const todayCompletions = await ChecklistCompletion.findAll({
      where: { date: today }
    });

    const completionByUser = {};
    todayCompletions.forEach(c => {
      if (!completionByUser[c.userId]) {
        completionByUser[c.userId] = {};
      }
      completionByUser[c.userId][c.checklistItemId] = c;
    });

    // Build missing tasks with staff info
    const missingTasks = [];
    const staffMap = {};
    clockedInStaff.forEach(s => {
      staffMap[s.userId] = s.User ? s.User.fullName : 'Unknown';
    });

    checklists.forEach(cl => {
      cl.items.forEach(item => {
        // Check if any clocked-in staff has completed this task
        let completedBy = null;
        let completedStatus = 'PENDING';

        for (const userId of Object.keys(staffMap)) {
          const completion = completionByUser[userId]?.[item.id];
          if (completion && completion.status === 'COMPLETED') {
            completedBy = staffMap[userId];
            completedStatus = 'COMPLETED';
            break;
          }
        }

        if (completedStatus !== 'COMPLETED') {
          // Get which staff are clocked in but haven't completed this
          const pendingStaff = Object.entries(staffMap)
            .filter(([userId]) => !completionByUser[userId]?.[item.id] || completionByUser[userId][item.id].status !== 'COMPLETED')
            .map(([userId, name]) => name);

          missingTasks.push({
            itemText: item.text,
            checklistTitle: cl.title,
            shiftType: cl.shiftType,
            status: completedStatus,
            pendingStaff: pendingStaff.length > 0 ? pendingStaff : null
          });
        }
      });
    });

    // Get active shift
    const activeShift = await Shift.findOne({
      where: { status: 'ACTIVE' },
      include: [
        { model: User, as: 'createdByUser', attributes: ['fullName'] },
        { model: ShiftAssignment, as: 'assignments', include: [{ model: User, as: 'User', attributes: ['fullName'] }] }
      ]
    });

    // Get recent shift notes (from most recent closed shift)
    const recentClosedShift = await Shift.findOne({
      where: { status: 'CLOSED' },
      order: [['endedAt', 'DESC']]
    });

    let recentShiftNotes = [];
    if (recentClosedShift) {
      recentShiftNotes = await ShiftNote.findAll({
        where: { shiftId: recentClosedShift.id },
        include: [{ model: User, as: 'author', attributes: ['fullName'] }],
        order: [['createdAt', 'DESC']],
        limit: 2
      });
    }

    // Get low stock items (quantity <= reorder level)
    const { InventoryItem } = require('../models');
    const lowStockItems = await InventoryItem.findAll({
      where: {
        [Op.or]: [
          { quantityOnHand: { [Op.lte]: sequelize.col('reorderLevel') } },
          { quantityOnHand: { [Op.lt]: 10 } }
        ]
      },
      order: [['quantityOnHand', 'ASC']],
      limit: 10
    });

    res.render('manager/dashboard', {
      title: 'Dashboard', activePage: 'dashboard', selectedDate: dateStr,
      stats: { completionRate, pendingTasks, activeStaff: activeStaffCount, totalStaff: staffCount, totalTasks, completedTasks, avgTaskTime },
      checklistProgress, recentCompletions, allStaff, missingTasks: missingTasks.slice(0, 10), lowStockItems: lowStockItems.map(i => i.toJSON()),
      activeShift: activeShift ? activeShift.toJSON() : null,
      recentShiftNotes: recentShiftNotes.map(n => n.toJSON())
    });
  } catch (error) {
    console.error('Error loading manager dashboard:', error);
    res.render('manager/dashboard', {
      title: 'Dashboard', activePage: 'dashboard', selectedDate: new Date().toISOString().split('T')[0],
      stats: { completionRate: 0, pendingTasks: 0, activeStaff: 0, totalStaff: 0, totalTasks: 0, completedTasks: 0, avgTaskTime: 0 },
      checklistProgress: [], recentCompletions: [], allStaff: [], missingTasks: [], lowStockItems: [],
      activeShift: null, recentShiftNotes: []
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

router.get('/dash2', async (req, res) => {
  try {
    const { date } = req.query;
    const { startOfDay, endOfDay, dateStr } = getDateRange(date);

    const checklists = await Checklist.findAll({
      where: { isActive: true },
      include: [{ model: ChecklistItem, as: 'items' }],
      order: [['shiftType', 'ASC'], ['id', 'ASC']]
    });

    const completions = await ChecklistCompletion.findAll({
      where: { completedAt: { [Op.between]: [startOfDay, endOfDay] } },
      include: [
        { model: User, as: 'User', attributes: ['fullName'] },
        { model: ChecklistItem, as: 'ChecklistItem', attributes: ['text', 'checklistId'] }
      ]
    });

    const itemCompletionMap = {};
    completions.forEach(c => { itemCompletionMap[c.checklistItemId] = c; });

    let totalTasks = 0, completedTasks = 0, totalTime = 0, timeCount = 0;

    const checklistProgress = checklists.map(cl => {
      const items = cl.items;
      const itemCount = items.length;
      totalTasks += itemCount;
      let completedCount = 0;
      items.forEach(item => {
        const completion = itemCompletionMap[item.id];
        if (completion && completion.status === 'COMPLETED') {
          completedCount++;
          if (completion.completedAt) { totalTime += Math.random() * 15 + 5; timeCount++; }
        }
      });
      completedTasks += completedCount;
      const percent = itemCount > 0 ? Math.round((completedCount / itemCount) * 100) : 0;
      let status = percent === 100 ? 'Completed' : percent >= 80 ? 'On Track' : percent > 0 ? 'In Progress' : 'Scheduled';
      return { id: cl.id, title: cl.title, shiftType: cl.shiftType, totalItems: itemCount, completedItems: completedCount, percent, status };
    });

    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
    const pendingTasks = totalTasks - completedTasks;
    const avgTaskTime = timeCount > 0 ? Math.round(totalTime / timeCount) : 0;

    const today = new Date().toISOString().split('T')[0];
    const { StaffAttendance } = require('../models');
    const activeStaff = await StaffAttendance.findAll({
      where: { date: today, status: 'CLOCKED_IN' },
      include: [{ model: User, as: 'User', attributes: ['fullName'] }]
    });
    const activeStaffCount = activeStaff.length;

    const allStaff = await User.findAll({ where: { role: 'STAFF' }, attributes: ['id', 'fullName'] });
    const staffCount = allStaff.length;

    const recentCompletions = await ChecklistCompletion.findAll({
      where: { status: 'COMPLETED', completedAt: { [Op.ne]: null } },
      include: [
        { model: User, as: 'User', attributes: ['fullName'] },
        { model: ChecklistItem, as: 'ChecklistItem', attributes: ['text'] }
      ],
      order: [['completedAt', 'DESC']], limit: 10
    });

    // Get staff who are clocked in today with their pending tasks
    const clockedInStaff = await StaffAttendance.findAll({
      where: {
        date: today,
        status: 'CLOCKED_IN'
      },
      include: [{ model: User, as: 'User', attributes: ['id', 'fullName'] }]
    });

    // Get all completions for today (grouped by user)
    const todayCompletions = await ChecklistCompletion.findAll({
      where: { date: today }
    });

    const completionByUser = {};
    todayCompletions.forEach(c => {
      if (!completionByUser[c.userId]) {
        completionByUser[c.userId] = {};
      }
      completionByUser[c.userId][c.checklistItemId] = c;
    });

    // Build missing tasks with staff info
    const missingTasks = [];
    const staffMap = {};
    clockedInStaff.forEach(s => {
      staffMap[s.userId] = s.User ? s.User.fullName : 'Unknown';
    });

    checklists.forEach(cl => {
      cl.items.forEach(item => {
        // Check if any clocked-in staff has completed this task
        let completedBy = null;
        let completedStatus = 'PENDING';

        for (const userId of Object.keys(staffMap)) {
          const completion = completionByUser[userId]?.[item.id];
          if (completion && completion.status === 'COMPLETED') {
            completedBy = staffMap[userId];
            completedStatus = 'COMPLETED';
            break;
          }
        }

        if (completedStatus !== 'COMPLETED') {
          // Get which staff are clocked in but haven't completed this
          const pendingStaff = Object.entries(staffMap)
            .filter(([userId]) => !completionByUser[userId]?.[item.id] || completionByUser[userId][item.id].status !== 'COMPLETED')
            .map(([userId, name]) => name);

          missingTasks.push({
            itemText: item.text,
            checklistTitle: cl.title,
            shiftType: cl.shiftType,
            status: completedStatus,
            pendingStaff: pendingStaff.length > 0 ? pendingStaff : null
          });
        }
      });
    });

    res.render('manager/dashboard', {
      title: 'Dashboard', activePage: 'dashboard', selectedDate: dateStr,
      stats: { completionRate, pendingTasks, activeStaff: activeStaffCount, totalStaff: staffCount, totalTasks, completedTasks, avgTaskTime },
      checklistProgress, recentCompletions, allStaff, missingTasks: missingTasks.slice(0, 10), lowStockItems: []
    });
  } catch (error) {
    console.error('Error loading manager dashboard:', error);
    res.render('manager/dashboard', {
      title: 'Dashboard', activePage: 'dashboard', selectedDate: new Date().toISOString().split('T')[0],
      stats: { completionRate: 0, pendingTasks: 0, activeStaff: 0, totalStaff: 0, totalTasks: 0, completedTasks: 0, avgTaskTime: 0 },
      checklistProgress: [], recentCompletions: [], allStaff: [], missingTasks: [], lowStockItems: []
    });
  }
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
    const { title, shiftType, description } = req.body;
    await Checklist.create({ title, shiftType, description });
    req.session.success = 'Checklist created successfully!';
    res.redirect('/manager/checklists');
  } catch (error) {
    req.session.error = 'Error creating checklist.';
    res.redirect('/manager/checklists');
  }
});

// GET /manager/staff
router.get('/staff', async (req, res) => {
  try {
    console.log('GET /staff - Session success:', req.session.success);
    console.log('GET /staff - Session error:', req.session.error);

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
    console.log('Rendered with success:', successMsg, 'error:', errorMsg);
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
    const { fullName, email, role, password } = req.body;
    console.log('=== Adding staff ===');
    console.log('FullName:', fullName);
    console.log('Email:', email);

    // Validate required fields
    if (!fullName || !email || !password) {
      console.log('Validation failed: missing required fields');
      req.session.error = 'Please fill in all required fields';
      return req.session.save(() => res.redirect('/manager/staff'));
    }

    // Check if email already exists
    const existingUser = await User.findOne({ where: { email } });
    console.log('Existing user check:', existingUser ? existingUser.id : 'none');
    if (existingUser) {
      req.session.error = 'A user with this email already exists';
      return req.session.save(() => res.redirect('/manager/staff'));
    }

    // Validate password length
    if (password.length < 6) {
      console.log('Validation failed: password too short');
      req.session.error = 'Password must be at least 6 characters';
      return req.session.save(() => res.redirect('/manager/staff'));
    }

    // Create new staff member (password will be hashed by model's beforeCreate hook)
    console.log('Creating user with:', { fullName, email, role, passwordHash: '***' });
    const newUser = await User.create({
      fullName,
      email,
      passwordHash: password,
      role: role || 'STAFF',
      isActive: true
    });
    console.log('=== User created successfully:', newUser.id, '===');
    const successMessage = `${fullName} has been added as ${role || 'Staff'}!`;
    req.session.success = successMessage;
    console.log('Set session.success:', successMessage);
    // Save session before redirect to ensure it's persisted
    req.session.save((err) => {
      if (err) {
        console.error('Session save error:', err);
      }
      console.log('Session saved, redirecting...');
      res.redirect('/manager/staff');
    });
  } catch (error) {
    console.error('=== Error adding staff:', error);
    console.error('Stack:', error.stack);
    req.session.error = 'Error adding staff member: ' + error.message;
    req.session.save((err) => {
      if (err) console.error('Session save error:', err);
      res.redirect('/manager/staff');
    });
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
      staffMember: staffMember.toJSON()
    });
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
    const { fullName, email, role, password, isActive } = req.body;

    const staffMember = await User.findByPk(id);
    if (!staffMember) {
      req.session.error = 'Staff member not found';
      return req.session.save(() => res.redirect('/manager/staff'));
    }

    // Check if email is being changed and if it's already taken
    if (email !== staffMember.email) {
      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        req.session.error = 'A user with this email already exists';
        return req.session.save(() => res.redirect(`/manager/staff/${id}/edit`));
      }
    }

    // Update fields
    const updateData = {
      fullName: fullName || staffMember.fullName,
      email: email || staffMember.email,
      role: role || staffMember.role,
      isActive: isActive === 'on' || isActive === 'true'
    };

    // Only update password if provided
    if (password && password.length >= 6) {
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
      activeShift: activeShift ? activeShift.toJSON() : null
    });
  } catch (error) {
    console.error('Error loading shifts:', error);
    res.render('manager/shifts', {
      title: 'Shifts',
      activePage: 'shifts',
      shifts: [],
      filters: {},
      activeShift: null
    });
  }
});

// GET /manager/shifts/new
router.get('/shifts/new', (req, res) => {
  res.render('manager/shifts-new', {
    title: 'New Shift',
    activePage: 'shifts'
  });
});

// POST /manager/shifts
router.post('/shifts', async (req, res) => {
  try {
    const { shiftDate, shiftType, notes } = req.body;
    const userId = req.session.user.id;
    await Shift.create({
      shiftDate,
      shiftType,
      notes,
      status: 'SCHEDULED',
      createdBy: userId,
      managerId: userId
    });
    req.session.success = 'Shift created!';
    res.redirect('/manager/shifts');
  } catch (error) {
    req.session.error = 'Error creating shift.';
    res.redirect('/manager/shifts');
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
    res.redirect('/manager/shifts');
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
    res.redirect('/manager/shifts');
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
      tasks: tasks.map(t => t.toJSON())
    });
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
      lowStockCount
    });
  } catch (error) {
    res.render('manager/inventory', {
      title: 'Inventory',
      activePage: 'inventory',
      items: [],
      categories: [],
      filters: {},
      lowStockCount: 0
    });
  }
});

// GET /manager/inventory/new
router.get('/inventory/new', (req, res) => {
  res.render('manager/inventory-new', {
    title: 'New Inventory Item',
    activePage: 'inventory'
  });
});

// POST /manager/inventory
router.post('/inventory', async (req, res) => {
  try {
    const { name, category, quantityOnHand, unit, reorderLevel } = req.body;
    await InventoryItem.create({
      name,
      category: category || 'Other',
      quantityOnHand: parseInt(quantityOnHand) || 0,
      unit: unit || '',
      reorderLevel: parseInt(reorderLevel) || 0
    });
    req.session.success = 'Inventory item created!';
    res.redirect('/manager/inventory');
  } catch (error) {
    req.session.error = 'Error creating inventory item.';
    res.redirect('/manager/inventory');
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
      logs: logs.map(l => l.toJSON())
    });
  } catch (error) {
    res.redirect('/manager/inventory');
  }
});

// PUT /manager/inventory/:id
router.put('/inventory/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, quantityOnHand, unit, reorderLevel } = req.body;
    const item = await InventoryItem.findByPk(id);
    if (item) {
      await item.update({
        name,
        category: category || 'Other',
        quantityOnHand: parseInt(quantityOnHand) || 0,
        unit: unit || '',
        reorderLevel: parseInt(reorderLevel) || 0
      });
      req.session.success = 'Inventory item updated!';
    }
    res.redirect('/manager/inventory');
  } catch (error) {
    req.session.error = 'Error updating inventory item.';
    res.redirect('/manager/inventory');
  }
});

// POST /manager/inventory/:id/adjust
router.post('/inventory/:id/adjust', async (req, res) => {
  try {
    const { id } = req.params;
    const { changeAmount, reason } = req.body;
    const userId = req.session.user.id;

    const item = await InventoryItem.findByPk(id);
    if (item) {
      const newQuantity = item.quantityOnHand + parseInt(changeAmount);
      await InventoryLog.create({
        inventoryItemId: id,
        changeAmount: parseInt(changeAmount),
        reason,
        updatedBy: userId
      });
      await item.update({
        quantityOnHand: newQuantity >= 0 ? newQuantity : 0
      });

      // Log activity
      const { logActivity, ACTIONS } = require('../utils/activityLogger');
      await logActivity(userId, ACTIONS.INVENTORY_UPDATED, 'inventory', id, { itemName: item.name, changeAmount: parseInt(changeAmount), newQuantity: newQuantity >= 0 ? newQuantity : 0 });

      req.session.success = `Stock adjusted by ${changeAmount}!`;
    }
    res.redirect(`/manager/inventory/${id}/edit`);
  } catch (error) {
    req.session.error = 'Error adjusting stock.';
    res.redirect('/manager/inventory');
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
    const { userId, roleLabel } = req.body;
    const managerId = req.session.user.id;

    const assignment = await ShiftAssignment.create({
      shiftId: id,
      userId: parseInt(userId),
      roleLabel: roleLabel || 'Staff'
    });

    // Log activity
    const { logActivity, ACTIONS } = require('../utils/activityLogger');
    await logActivity(managerId, ACTIONS.STAFF_ASSIGNED, 'shift', id, { userId, roleLabel });

    req.session.success = 'Staff assigned to shift!';
    res.redirect(`/manager/shifts/${id}`);
  } catch (error) {
    console.error('Error assigning staff:', error);
    req.session.error = 'Error assigning staff.';
    res.redirect('/manager/shifts');
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
    const { noteText } = req.body;
    const userId = req.session.user.id;

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
    req.session.error = 'Error adding note.';
    res.redirect('/manager/shifts');
  }
});

// POST /manager/shifts/:id/tasks - Assign task to staff
router.post('/shifts/:id/tasks', async (req, res) => {
  try {
    const { id } = req.params;
    const { assignedTo, checklistItemId, customTaskText, priority, notes } = req.body;
    const userId = req.session.user.id;

    await TaskAssignment.create({
      shiftId: id,
      assignedTo: assignedTo,
      checklistItemId: checklistItemId || null,
      customTaskText: customTaskText || null,
      priority: priority || 'MEDIUM',
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
    req.session.error = 'Error assigning task.';
    res.redirect('/manager/shifts');
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

// DELETE /manager/assignments/:id - Remove staff from shift
router.delete('/assignments/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const assignment = await ShiftAssignment.findByPk(id);
    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    const shiftId = assignment.shiftId;
    await assignment.destroy();

    req.session.success = 'Staff removed from shift.';
    res.redirect(`/manager/shifts/${shiftId}`);
  } catch (error) {
    console.error('Error removing assignment:', error);
    req.session.error = 'Error removing assignment.';
    res.redirect('/manager/shifts');
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

module.exports = router;
