const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Shift = sequelize.define('Shift', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  title: {
    type: DataTypes.STRING,
    allowNull: true
  },
  shiftType: {
    type: DataTypes.ENUM('OPENING', 'MID_SHIFT', 'CLOSING'),
    allowNull: false
  },
  shiftDate: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  scheduledStart: {
    type: DataTypes.TIME,
    allowNull: true
  },
  scheduledEnd: {
    type: DataTypes.TIME,
    allowNull: true
  },
  priority: {
    type: DataTypes.ENUM('LOW', 'MEDIUM', 'HIGH'),
    defaultValue: 'MEDIUM'
  },
  status: {
    type: DataTypes.ENUM('SCHEDULED', 'ACTIVE', 'CLOSED'),
    defaultValue: 'SCHEDULED'
  },
  startedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  endedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  managerId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  createdBy: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'shifts',
  timestamps: true,
  indexes: [
    {
      fields: ['shiftDate', 'status']
    },
    {
      fields: ['managerId', 'shiftDate']
    }
  ]
});

module.exports = Shift;
