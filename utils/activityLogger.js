const { ActivityLog } = require('../models');

// Activity action types
const ACTIONS = {
  // Checklist actions
  CHECKLIST_CREATED: 'checklist_created',
  CHECKLIST_UPDATED: 'checklist_updated',
  CHECKLIST_DELETED: 'checklist_deleted',
  CHECKLIST_ITEM_COMPLETED: 'checklist_item_completed',
  CHECKLIST_ITEM_UPDATED: 'checklist_item_updated',

  // Shift actions
  SHIFT_CREATED: 'shift_created',
  SHIFT_STARTED: 'shift_started',
  SHIFT_CLOSED: 'shift_closed',
  STAFF_ASSIGNED: 'staff_assigned',
  STAFF_UNASSIGNED: 'staff_unassigned',
  NOTE_ADDED: 'note_added',
  TASK_ASSIGNED: 'task_assigned',
  TASK_COMPLETED: 'task_completed',

  // Staff actions
  STAFF_ADDED: 'staff_added',
  STAFF_UPDATED: 'staff_updated',

  // Inventory actions
  INVENTORY_CREATED: 'inventory_created',
  INVENTORY_UPDATED: 'inventory_updated',
  INVENTORY_DELETED: 'inventory_deleted',
  INVENTORY_LOW_STOCK: 'inventory_low_stock',

  // Report actions
  REPORT_SUBMITTED: 'report_submitted'
};

// Log an activity
async function logActivity(userId, action, entityType = null, entityId = null, details = null) {
  try {
    await ActivityLog.create({
      userId,
      action,
      entityType,
      entityId,
      details
    });
  } catch (error) {
    console.error('Error logging activity:', error);
  }
}

// Get recent activities
async function getRecentActivities(limit = 50) {
  return await ActivityLog.findAll({
    include: [{ model: require('./models').User, as: 'User', attributes: ['fullName', 'email'] }],
    order: [['createdAt', 'DESC']],
    limit
  });
}

// Format activity for display
function formatActivity(activity) {
  const action = activity.action;
  const user = activity.User ? activity.User.fullName : 'System';
  const time = activity.createdAt;

  switch (action) {
    case ACTIONS.CHECKLIST_CREATED:
      return `${user} created a new checklist`;
    case ACTIONS.CHECKLIST_ITEM_COMPLETED:
      return `${user} completed a checklist item`;
    case ACTIONS.SHIFT_STARTED:
      return `${user} started a shift`;
    case ACTIONS.SHIFT_CLOSED:
      return `${user} closed a shift`;
    case ACTIONS.STAFF_ASSIGNED:
      return `${user} assigned staff to a shift`;
    case ACTIONS.STAFF_UNASSIGNED:
      return `${user} removed staff from a shift`;
    case ACTIONS.NOTE_ADDED:
      return `${user} added a shift note`;
    case ACTIONS.TASK_ASSIGNED:
      return `${user} assigned a task`;
    case ACTIONS.TASK_COMPLETED:
      return `${user} completed a task`;
    case ACTIONS.REPORT_SUBMITTED:
      return `${user} submitted a shift report`;
    case ACTIONS.INVENTORY_LOW_STOCK:
      return `Low stock alert for inventory item`;
    default:
      return `${user} performed action: ${action}`;
  }
}

module.exports = {
  ACTIONS,
  logActivity,
  getRecentActivities,
  formatActivity
};
