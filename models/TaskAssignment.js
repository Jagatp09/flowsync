const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const TaskAssignment = sequelize.define('TaskAssignment', {
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
  checklistItemId: {
    type: DataTypes.INTEGER,
    allowNull: true,
    references: {
      model: 'checklist_items',
      key: 'id'
    }
  },
  customTaskText: {
    type: DataTypes.STRING,
    allowNull: true
  },
  assignedTo: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'users',
      key: 'id'
    }
  },
  priority: {
    type: DataTypes.ENUM('LOW', 'MEDIUM', 'HIGH'),
    defaultValue: 'MEDIUM'
  },
  status: {
    type: DataTypes.ENUM('OPEN', 'DONE'),
    defaultValue: 'OPEN'
  },
  notes: {
    type: DataTypes.TEXT,
    allowNull: true
  }
}, {
  tableName: 'task_assignments',
  timestamps: true
});

module.exports = TaskAssignment;
