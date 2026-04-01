const express = require('express');
const router = express.Router();
const { Checklist, ChecklistItem, ChecklistCompletion, ShiftReport } = require('../models');
const { requireAuth, requireStaff } = require('../utils/middleware');
const { normalizeEnum, toTrimmedString } = require('../utils/validation');
const {
  canAccessChecklistShift,
  getChecklistProgressForUser,
  CHECKLIST_SHIFT_TO_SHIFT
} = require('../utils/shiftAccess');

const CHECKLIST_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'PARTIAL'];

// GET /checklists/daily - Staff daily checklist page
router.get('/daily', requireAuth, requireStaff, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const today = new Date().toISOString().split('T')[0];
    const { checklistData, stats } = await getChecklistProgressForUser(userId, today);

    const success = req.session.success || null;
    const error = req.session.error || null;

    res.render('staff/checklist', {
      title: 'My Tasks',
      activePage: 'tasks',
      checklists: checklistData,
      stats,
      success,
      error
    });

    if (req.session.success) delete req.session.success;
    if (req.session.error) delete req.session.error;
  } catch (error) {
    console.error('Error loading daily checklist:', error);
    req.session.error = 'Error loading checklist';
    res.redirect('/staff/dashboard');
  }
});

// POST /checklists/items/:itemId/complete - Mark task as complete
router.post('/items/:itemId/complete', requireAuth, requireStaff, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const itemId = req.params.itemId;
    const notes = toTrimmedString(req.body.notes, { maxLength: 1000, allowEmpty: true });
    const status = normalizeEnum(req.body.status || 'COMPLETED', CHECKLIST_STATUSES);
    const today = new Date().toISOString().split('T')[0];
    const checklistItem = await ChecklistItem.findByPk(itemId, {
      include: [{ model: Checklist, attributes: ['shiftType'] }]
    });

    if (!checklistItem || !status) {
      req.session.error = 'Invalid checklist update.';
      return res.redirect('/checklists/daily');
    }

    const isAuthorized = await canAccessChecklistShift(userId, checklistItem.Checklist.shiftType, today);
    if (!isAuthorized) {
      req.session.error = 'You are not assigned to complete tasks for this shift.';
      return res.redirect('/checklists/daily');
    }

    let completion = await ChecklistCompletion.findOne({
      where: {
        checklistItemId: itemId,
        userId: userId,
        date: today
      }
    });

    if (completion) {
      completion.status = status;
      completion.notes = notes || null;
      if (status === 'COMPLETED') {
        completion.completedAt = new Date();
      } else {
        completion.completedAt = null;
      }
      await completion.save();
    } else {
      completion = await ChecklistCompletion.create({
        checklistItemId: itemId,
        userId: userId,
        date: today,
        status,
        notes: notes || null,
        completedAt: status === 'COMPLETED' ? new Date() : null
      });
    }

    // Log activity
    if (status === 'COMPLETED') {
      const { logActivity, ACTIONS } = require('../utils/activityLogger');
      await logActivity(userId, ACTIONS.CHECKLIST_ITEM_COMPLETED, 'checklist_item', itemId, { itemText: checklistItem ? checklistItem.text : 'Unknown' });
    }

    res.redirect('/checklists/daily');
  } catch (error) {
    console.error('Error completing task:', error);
    req.session.error = 'Error completing task';
    res.redirect('/checklists/daily');
  }
});

// POST /checklists/items/:itemId/undo - Undo task completion
router.post('/items/:itemId/undo', requireAuth, requireStaff, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const itemId = req.params.itemId;
    const today = new Date().toISOString().split('T')[0];
    const checklistItem = await ChecklistItem.findByPk(itemId, {
      include: [{ model: Checklist, attributes: ['shiftType'] }]
    });

    if (!checklistItem) {
      req.session.error = 'Checklist item not found.';
      return res.redirect('/checklists/daily');
    }

    const isAuthorized = await canAccessChecklistShift(userId, checklistItem.Checklist.shiftType, today);
    if (!isAuthorized) {
      req.session.error = 'You are not assigned to modify tasks for this shift.';
      return res.redirect('/checklists/daily');
    }

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
    req.session.error = 'Error undoing task';
    res.redirect('/checklists/daily');
  }
});

// GET /api/checklists/stats - Get stats for dashboard (JSON)
router.get('/api/stats', requireAuth, requireStaff, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const today = new Date().toISOString().split('T')[0];
    const { stats } = await getChecklistProgressForUser(userId, today);
    res.json(stats);
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Error getting stats' });
  }
});

// POST /checklists/shift/:shiftType/items - Add custom task
router.post('/shift/:shiftType/items', requireAuth, requireStaff, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const shiftType = normalizeEnum(req.params.shiftType, Object.keys(CHECKLIST_SHIFT_TO_SHIFT));
    const text = toTrimmedString(req.body.text, { maxLength: 255 });
    const category = toTrimmedString(req.body.category, { maxLength: 80, allowEmpty: true });
    const today = new Date().toISOString().split('T')[0];

    if (!shiftType || !text) {
      req.session.error = 'Task text is required';
      return res.redirect('/checklists/daily');
    }

    const isAuthorized = await canAccessChecklistShift(userId, shiftType, today);
    if (!isAuthorized) {
      req.session.error = 'You are not assigned to add tasks for this shift.';
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
      text,
      category: category || 'Custom',
      sortOrder: sortOrder,
      isCustom: true // Mark as custom task
    });

    // Create initial completion record
    await ChecklistCompletion.create({
      checklistItemId: newItem.id,
      userId: userId,
      date: today,
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
router.post('/shift/:shiftType/submit', requireAuth, requireStaff, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const shiftType = normalizeEnum(req.params.shiftType, Object.keys(CHECKLIST_SHIFT_TO_SHIFT));
    const summary = toTrimmedString(req.body.summary, { maxLength: 2000, allowEmpty: true });
    const issues = toTrimmedString(req.body.issues, { maxLength: 2000, allowEmpty: true });
    const today = new Date().toISOString().split('T')[0];

    if (!shiftType) {
      req.session.error = 'Invalid shift type.';
      return res.redirect('/checklists/daily');
    }

    const isAuthorized = await canAccessChecklistShift(userId, shiftType, today);
    if (!isAuthorized) {
      req.session.error = 'You are not assigned to submit a report for this shift.';
      return res.redirect('/checklists/daily');
    }

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
