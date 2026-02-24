const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ShiftSummary = sequelize.define('ShiftSummary', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  shiftId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'shifts',
      key: 'id'
    }
  },
  totalTasks: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  completedTasks: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  pendingTasks: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  completionPercent: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  issuesCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  staffCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  summaryNotes: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'shift_summaries',
  timestamps: true
});

module.exports = ShiftSummary;
