'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ShiftReport = sequelize.define('ShiftReport', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  shiftType: {
    type: DataTypes.ENUM('MORNING', 'MIDDAY', 'EVENING'),
    allowNull: false
  },
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  summary: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  issues: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  completedTasks: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  totalTasks: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  submittedAt: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'ShiftReports',
  timestamps: false
});

module.exports = ShiftReport;
