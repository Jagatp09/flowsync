const express = require('express');
const router = express.Router();
const { Checklist, ChecklistItem, ChecklistCompletion, User, ShiftReport } = require('../models');

// Middleware to check authentication
const requireAuth = (req, res, next) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
};

// GET /checklists/daily - Staff daily checklist page
router.get('/daily', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const today = new Date().toISOString().split('T')[0];

    // Get all active checklists with their items
    const checklists = await Checklist.findAll({
      where: { isActive: true },
      include: [{
        model: ChecklistItem,
        as: 'items',
        order: [['sortOrder', 'ASC']]
      }],
      order: [['shiftType', 'ASC']]
    });

    // Get completions for today for this user
    const completions = await ChecklistCompletion.findAll({
      where: {
        userId: userId,
        date: today
      }
    });

    // Create a map of itemId -> completion
    const completionMap = {};
    completions.forEach(c => {
      completionMap[c.checklistItemId] = c;
    });

    // Transform data for view
    const checklistData = checklists.map(checklist => ({
      id: checklist.id,
      title: checklist.title,
      shiftType: checklist.shiftType,
      items: checklist.items.map(item => ({
        id: item.id,
        text: item.text,
        category: item.category,
        completion: completionMap[item.id] || null
      }))
    }));

    // Calculate stats
    let totalTasks = 0;
    let completedTasks = 0;
    checklistData.forEach(cl => {
      cl.items.forEach(item => {
        totalTasks++;
        if (item.completion && item.completion.status === 'COMPLETED') {
          completedTasks++;
        }
      });
    });

    const stats = {
      total: totalTasks,
      completed: completedTasks,
      remaining: totalTasks - completedTasks,
      percentage: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
    };

    res.render('staff/checklist', {
      title: 'My Tasks',
      activePage: 'tasks',
      checklists: checklistData,
      stats: stats
    });
  } catch (error) {
    console.error('Error loading daily checklist:', error);
    res.status(500).send('Error loading checklist');
  }
});

// POST /checklists/items/:itemId/complete - Mark task as complete
router.post('/items/:itemId/complete', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const itemId = req.params.itemId;
    const { notes, status } = req.body;
    const today = new Date().toISOString().split('T')[0];

    // Check if completion already exists
    let completion = await ChecklistCompletion.findOne({
      where: {
        checklistItemId: itemId,
        userId: userId,
        date: today
      }
    });

    if (completion) {
      // Update existing completion
      completion.status = status || 'COMPLETED';
      completion.notes = notes || null;
      if (status === 'COMPLETED') {
        completion.completedAt = new Date();
      }
      await completion.save();
    } else {
      // Create new completion
      completion = await ChecklistCompletion.create({
        checklistItemId: itemId,
        userId: userId,
        date: today,
        status: status || 'COMPLETED',
        notes: notes || null,
        completedAt: status === 'COMPLETED' ? new Date() : null
      });
    }

    // Log activity
    if (status === 'COMPLETED') {
      const { logActivity, ACTIONS } = require('../utils/activityLogger');
      const checklistItem = await ChecklistItem.findByPk(itemId);
      await logActivity(userId, ACTIONS.CHECKLIST_ITEM_COMPLETED, 'checklist_item', itemId, { itemText: checklistItem ? checklistItem.text : 'Unknown' });
    }

    // Redirect back to daily checklist
    res.redirect('/checklists/daily');
  } catch (error) {
    console.error('Error completing task:', error);
    res.status(500).send('Error completing task');
  }
});

// POST /checklists/items/:itemId/undo - Undo task completion
router.post('/items/:itemId/undo', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const itemId = req.params.itemId;
    const today = new Date().toISOString().split('T')[0];

    const completion = await ChecklistCompletion.findOne({
      where: {
        checklistItemId: itemId,
        userId: userId,
        date: today
      }
    });

    if (completion) {
      completion.status = 'PENDING';
      completion.completedAt = null;
      await completion.save();
    }

    res.redirect('/checklists/daily');
  } catch (error) {
    console.error('Error undoing task:', error);
    res.status(500).send('Error undoing task');
  }
});

// GET /api/checklists/stats - Get stats for dashboard (JSON)
router.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const today = new Date().toISOString().split('T')[0];

    // Get all checklists with items
    const checklists = await Checklist.findAll({
      where: { isActive: true },
      include: [{
        model: ChecklistItem,
        as: 'items'
      }]
    });

    // Get user's completions for today
    const completions = await ChecklistCompletion.findAll({
      where: {
        userId: userId,
        date: today
      }
    });

    const completionMap = {};
    completions.forEach(c => {
      completionMap[c.checklistItemId] = c;
    });

    let total = 0;
    let completed = 0;
    checklists.forEach(cl => {
      cl.items.forEach(item => {
        total++;
        if (completionMap[item.id] && completionMap[item.id].status === 'COMPLETED') {
          completed++;
        }
      });
    });

    res.json({
      total,
      completed,
      remaining: total - completed,
      percentage: total > 0 ? Math.round((completed / total) * 100) : 0
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Error getting stats' });
  }
});

// POST /checklists/shift/:shiftType/items - Add custom task
router.post('/shift/:shiftType/items', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { shiftType } = req.params;
    const { text, category } = req.body;

    if (!text || !text.trim()) {
      req.session.error = 'Task text is required';
      return res.redirect('/checklists/daily');
    }

    // Find the checklist for this shift type
    const checklist = await Checklist.findOne({
      where: {
        shiftType: shiftType,
        isActive: true
      }
    });

    if (!checklist) {
      req.session.error = 'Checklist not found for this shift';
      return res.redirect('/checklists/daily');
    }

    // Get max sort order for this checklist
    const maxItem = await ChecklistItem.findOne({
      where: { checklistId: checklist.id },
      order: [['sortOrder', 'DESC']]
    });
    const sortOrder = maxItem ? maxItem.sortOrder + 1 : 1;

    // Create new checklist item
    const newItem = await ChecklistItem.create({
      checklistId: checklist.id,
      text: text.trim(),
      category: category || 'Custom',
      sortOrder: sortOrder,
      isCustom: true // Mark as custom task
    });

    // Create initial completion record
    await ChecklistCompletion.create({
      checklistItemId: newItem.id,
      userId: userId,
      date: new Date().toISOString().split('T')[0],
      status: 'PENDING'
    });

    req.session.success = 'Custom task added successfully';
    res.redirect('/checklists/daily');
  } catch (error) {
    console.error('Error adding custom task:', error);
    req.session.error = 'Error adding custom task';
    res.redirect('/checklists/daily');
  }
});

// POST /checklists/shift/:shiftType/submit - Submit shift report
router.post('/shift/:shiftType/submit', requireAuth, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { shiftType } = req.params;
    const { summary, issues } = req.body;
    const today = new Date().toISOString().split('T')[0];

    // Check if shift already submitted
    const existingReport = await ShiftReport.findOne({
      where: {
        userId: userId,
        shiftType: shiftType,
        date: today
      }
    });

    if (existingReport) {
      // Update existing report
      existingReport.summary = summary || null;
      existingReport.issues = issues || null;
      await existingReport.save();
      req.session.success = 'Shift report updated successfully';
    } else {
      // Get completion stats for this shift
      const checklist = await Checklist.findOne({
        where: { shiftType: shiftType, isActive: true },
        include: [{ model: ChecklistItem, as: 'items' }]
      });

      let completedTasks = 0;
      let totalTasks = 0;

      if (checklist && checklist.items) {
        totalTasks = checklist.items.length;
        const completions = await ChecklistCompletion.findAll({
          where: {
            userId: userId,
            date: today,
            status: 'COMPLETED'
          }
        });
        const itemIds = checklist.items.map(i => i.id);
        completedTasks = completions.filter(c => itemIds.includes(c.checklistItemId)).length;
      }

      // Create new report
      await ShiftReport.create({
        userId: userId,
        shiftType: shiftType,
        date: today,
        summary: summary || null,
        issues: issues || null,
        completedTasks: completedTasks,
        totalTasks: totalTasks,
        submittedAt: new Date()
      });

      req.session.success = 'Shift report submitted successfully';
    }

    res.redirect('/checklists/daily');
  } catch (error) {
    console.error('Error submitting shift report:', error);
    req.session.error = 'Error submitting shift report';
    res.redirect('/checklists/daily');
  }
});

module.exports = router;
