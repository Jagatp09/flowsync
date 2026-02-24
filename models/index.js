const sequelize = require('../config/database');
const User = require('./User');
const Checklist = require('./Checklist');
const ChecklistItem = require('./ChecklistItem');
const ChecklistCompletion = require('./ChecklistCompletion');
const ShiftReport = require('./ShiftReport');
const StaffAttendance = require('./StaffAttendance');
const Shift = require('./Shift');
const ShiftSummary = require('./ShiftSummary');
const InventoryItem = require('./InventoryItem');
const InventoryLog = require('./InventoryLog');
const ShiftAssignment = require('./ShiftAssignment');
const ShiftNote = require('./ShiftNote');
const ActivityLog = require('./ActivityLog');
const TaskAssignment = require('./TaskAssignment');

// User - Checklist associations (through completions)
User.hasMany(ChecklistCompletion, { foreignKey: 'userId' });
ChecklistCompletion.belongsTo(User, { foreignKey: 'userId' });

// User - ShiftReport associations
User.hasMany(ShiftReport, { foreignKey: 'userId' });
ShiftReport.belongsTo(User, { foreignKey: 'userId' });

// User - StaffAttendance associations
User.hasMany(StaffAttendance, { foreignKey: 'userId' });
StaffAttendance.belongsTo(User, { foreignKey: 'userId' });

// User - Shift associations (created by)
User.hasMany(Shift, { foreignKey: 'createdBy', as: 'createdShifts' });
Shift.belongsTo(User, { foreignKey: 'createdBy', as: 'createdByUser' });

// User - Shift associations (manager)
User.hasMany(Shift, { foreignKey: 'managerId', as: 'managedShifts' });
Shift.belongsTo(User, { foreignKey: 'managerId', as: 'manager' });

// Shift - ShiftSummary associations
Shift.hasOne(ShiftSummary, { foreignKey: 'shiftId' });
ShiftSummary.belongsTo(Shift, { foreignKey: 'shiftId' });

// Shift - ShiftAssignment associations
Shift.hasMany(ShiftAssignment, { foreignKey: 'shiftId', as: 'assignments' });
ShiftAssignment.belongsTo(Shift, { foreignKey: 'shiftId' });

// User - ShiftAssignment associations
User.hasMany(ShiftAssignment, { foreignKey: 'userId', as: 'shiftAssignments' });
ShiftAssignment.belongsTo(User, { foreignKey: 'userId', as: 'User' });

// Shift - ShiftNote associations
Shift.hasMany(ShiftNote, { foreignKey: 'shiftId', as: 'shiftNotes' });
ShiftNote.belongsTo(Shift, { foreignKey: 'shiftId' });

// User - ShiftNote associations
User.hasMany(ShiftNote, { foreignKey: 'createdBy', as: 'author' });
ShiftNote.belongsTo(User, { foreignKey: 'createdBy', as: 'author' });

// ActivityLog associations
User.hasMany(ActivityLog, { foreignKey: 'userId' });
ActivityLog.belongsTo(User, { foreignKey: 'userId' });

// Checklist - ChecklistItem associations
Checklist.hasMany(ChecklistItem, { foreignKey: 'checklistId', as: 'items' });
ChecklistItem.belongsTo(Checklist, { foreignKey: 'checklistId' });

// ChecklistItem - ChecklistCompletion associations
ChecklistItem.hasMany(ChecklistCompletion, { foreignKey: 'checklistItemId', as: 'completions' });
ChecklistCompletion.belongsTo(ChecklistItem, { foreignKey: 'checklistItemId' });

// Inventory associations
InventoryItem.hasMany(InventoryLog, { foreignKey: 'inventoryItemId' });
InventoryLog.belongsTo(InventoryItem, { foreignKey: 'inventoryItemId' });

User.hasMany(InventoryLog, { foreignKey: 'updatedBy' });
InventoryLog.belongsTo(User, { foreignKey: 'updatedBy' });

// TaskAssignment associations
Shift.hasMany(TaskAssignment, { foreignKey: 'shiftId', as: 'tasks' });
TaskAssignment.belongsTo(Shift, { foreignKey: 'shiftId' });

User.hasMany(TaskAssignment, { foreignKey: 'assignedTo', as: 'assignedTasks' });
TaskAssignment.belongsTo(User, { foreignKey: 'assignedTo', as: 'assignee' });

ChecklistItem.hasMany(TaskAssignment, { foreignKey: 'checklistItemId' });
TaskAssignment.belongsTo(ChecklistItem, { foreignKey: 'checklistItemId' });

module.exports = {
  sequelize,
  User,
  Checklist,
  ChecklistItem,
  ChecklistCompletion,
  ShiftReport,
  StaffAttendance,
  Shift,
  ShiftSummary,
  InventoryItem,
  InventoryLog,
  ShiftAssignment,
  ShiftNote,
  ActivityLog,
  TaskAssignment
};
