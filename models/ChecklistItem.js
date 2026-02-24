const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ChecklistItem = sequelize.define('ChecklistItem', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  text: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  sortOrder: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  category: {
    type: DataTypes.STRING,
    allowNull: true
  },
  isCustom: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  checklistId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    references: {
      model: 'checklists',
      key: 'id'
    }
  }
}, {
  tableName: 'checklist_items',
  timestamps: true
});

module.exports = ChecklistItem;
