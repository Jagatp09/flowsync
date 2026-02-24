'use strict';
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const StaffAttendance = sequelize.define('StaffAttendance', {
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
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  clockInTime: {
    type: DataTypes.DATE,
    allowNull: true
  },
  clockOutTime: {
    type: DataTypes.DATE,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('CLOCKED_IN', 'CLOCKED_OUT', 'NOT_STARTED'),
    defaultValue: 'NOT_STARTED'
  },
  nextShiftDate: {
    type: DataTypes.DATEONLY,
    allowNull: true
  }
}, {
  tableName: 'StaffAttendances',
  timestamps: false,
  indexes: [
    {
      unique: true,
      fields: ['userId', 'date']
    }
  ]
});

module.exports = StaffAttendance;
