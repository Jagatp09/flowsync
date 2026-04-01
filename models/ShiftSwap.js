const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ShiftSwap = sequelize.define('ShiftSwap', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  requesterId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  targetShiftId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'shifts',
      key: 'id'
    }
  },
  targetUserId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    },
    comment: 'User to swap with (if specific person)'
  },
  desiredShiftId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'shifts',
      key: 'id'
    },
    comment: 'Desired shift to take in exchange'
  },
  reason: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  status: {
    type: DataTypes.ENUM('PENDING', 'APPROVED', 'REJECTED'),
    defaultValue: 'PENDING'
  },
  approvedBy: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  approvedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  managerComment: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  targetAccepted: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: null,
    comment: 'True if target staff accepts, false if rejects, null if pending'
  },
  targetRejectionReason: {
    type: DataTypes.TEXT,
    allowNull: true,
    comment: 'Reason if target staff rejects'
  }
}, {
  tableName: 'shift_swaps',
  timestamps: true
});

module.exports = ShiftSwap;
