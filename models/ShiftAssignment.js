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
  }
}, {
  tableName: 'shift_assignments',
  timestamps: true
});

module.exports = ShiftAssignment;
