const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Checklist = sequelize.define('Checklist', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  title: {
    type: DataTypes.STRING,
    allowNull: false
  },
  shiftType: {
    type: DataTypes.ENUM('MORNING', 'MIDDAY', 'EVENING'),
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  isActive: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'checklists',
  timestamps: true
});

module.exports = Checklist;
