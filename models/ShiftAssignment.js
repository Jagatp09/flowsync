const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ShiftAssignment = sequelize.define('ShiftAssignment', {
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
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  roleLabel: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: 'Staff'
  },
  assignedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  scheduledStart: {
    type: DataTypes.TIME,
    allowNull: true
  },
  duration: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Duration in hours',
    validate: {
      min: 1,
      max: 12
    }
  },
  actualStart: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Actual clock-in time'
  },
  actualEnd: {
    type: DataTypes.DATE,
    allowNull: true,
    comment: 'Actual clock-out time'
  },
  actualDuration: {
    type: DataTypes.INTEGER,
    allowNull: true,
    comment: 'Actual duration in minutes'
  },
  status: {
    type: DataTypes.ENUM('PENDING', 'CLOCKED_IN', 'COMPLETED', 'NO_SHOW'),
    defaultValue: 'PENDING'
  }
}, {
  tableName: 'shift_assignments',
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ['shiftId', 'userId']
    },
    {
      fields: ['userId']
    },
    {
      fields: ['shiftId']
    }
  ]
});

module.exports = ShiftAssignment;
