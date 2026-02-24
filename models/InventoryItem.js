const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const InventoryItem = sequelize.define('InventoryItem', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  category: {
    type: DataTypes.STRING,
    allowNull: true
  },
  quantityOnHand: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  unit: {
    type: DataTypes.STRING,
    allowNull: true
  },
  reorderLevel: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  }
}, {
  tableName: 'inventory_items',
  timestamps: true
});

module.exports = InventoryItem;
