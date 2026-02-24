const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ChecklistCompletion = sequelize.define('ChecklistCompletion', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  status: {
    type: DataTypes.ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'PARTIAL'),
    defaultValue: 'PENDING'
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  completedAt: {
    type: DataTypes.DATE,
    allowNull: true
  },
  checklistItemId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'checklist_items',
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
  date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'checklist_completions',
  timestamps: true,
  indexes: [
    {
      unique: true,
      fields: ['checklistItemId', 'userId', 'date']
    }
  ]
});

module.exports = ChecklistCompletion;
