const { Op } = require('sequelize');
const {
  app,
  sequelize,
  User,
  InventoryItem,
  InventoryLog,
  login,
  loginManager,
  loginStaff,
  getCsrfToken
} = require('../jest-setup');
const request = require('supertest');

const TEST_PREFIX = 'TEST_SCN8_';
const TEST_ITEM_NAME = `${TEST_PREFIX}Test Item`;
const TEST_ITEM_CATEGORY = 'Test Category';

describe('Scenario 8: Inventory Management', () => {
  beforeAll(async () => {
    await sequelize.sync({ alter: true });
  });

  afterEach(async () => {
    // Clean up test inventory items by name prefix
    const testItems = await InventoryItem.findAll({
      where: { name: { [Op.like]: `${TEST_PREFIX}%` } },
      attributes: ['id']
    });
    const itemIds = testItems.map(i => i.id);

    if (itemIds.length > 0) {
      await InventoryLog.destroy({ where: { inventoryItemId: { [Op.in]: itemIds } } });
    }

    await InventoryItem.destroy({
      where: { name: { [Op.like]: `${TEST_PREFIX}%` } }
    });
  });

  afterAll(async () => {
    await sequelize.close();
  });

  describe('Manager creates inventory item', () => {
    test('Manager creates valid item returns 302 and item exists in DB', async () => {
      const agent = request.agent(app);
      await loginManager(agent);

      const csrfToken = await getCsrfToken(agent, '/manager/inventory/new');
      const response = await agent
        .post('/manager/inventory')
        .type('form')
        .send({
          _csrf: csrfToken,
          name: TEST_ITEM_NAME,
          category: TEST_ITEM_CATEGORY,
          quantityOnHand: 100,
          unit: 'units',
          reorderLevel: 20
        });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/manager/inventory');

      const item = await InventoryItem.findOne({
        where: { name: TEST_ITEM_NAME }
      });
      expect(item).not.toBeNull();
      expect(item.quantityOnHand).toBe(100);
      expect(item.reorderLevel).toBe(20);
    });

    test('Manager creates item with missing fields returns 302 and redirects to form', async () => {
      const agent = request.agent(app);
      await loginManager(agent);

      const csrfToken = await getCsrfToken(agent, '/manager/inventory/new');
      const response = await agent
        .post('/manager/inventory')
        .type('form')
        .send({
          _csrf: csrfToken,
          name: '', // Missing
          category: TEST_ITEM_CATEGORY,
          quantityOnHand: 100
        });

      expect(response.status).toBe(302);
      // Should redirect back to new form
    });

    test('Manager creates item with negative quantity returns 302', async () => {
      const agent = request.agent(app);
      await loginManager(agent);

      const csrfToken = await getCsrfToken(agent, '/manager/inventory/new');
      const response = await agent
        .post('/manager/inventory')
        .type('form')
        .send({
          _csrf: csrfToken,
          name: TEST_ITEM_NAME,
          category: TEST_ITEM_CATEGORY,
          quantityOnHand: -10,
          unit: 'units',
          reorderLevel: 20
        });

      expect(response.status).toBe(302);
    });
  });

  describe('Manager updates inventory item', () => {
    let item;

    beforeEach(async () => {
      item = await InventoryItem.create({
        name: TEST_ITEM_NAME,
        category: TEST_ITEM_CATEGORY,
        quantityOnHand: 50,
        unit: 'units',
        reorderLevel: 10
      });
    });

    test('Manager updates item with valid data returns 302 and persists changes', async () => {
      const agent = request.agent(app);
      await loginManager(agent);

      const csrfToken = await getCsrfToken(agent, `/manager/inventory/${item.id}/edit`);
      const response = await agent
        .post(`/manager/inventory/${item.id}?_method=PUT`)
        .type('form')
        .send({
          _csrf: csrfToken,
          name: `${TEST_ITEM_NAME} Updated`,
          category: 'Updated Category',
          quantityOnHand: 75,
          unit: 'boxes',
          reorderLevel: 15
        });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/manager/inventory');

      await item.reload();
      expect(item.name).toBe(`${TEST_ITEM_NAME} Updated`);
      expect(item.category).toBe('Updated Category');
      expect(item.quantityOnHand).toBe(75);
      expect(item.unit).toBe('boxes');
    });

    test('Manager updates item with missing name returns 302', async () => {
      const agent = request.agent(app);
      await loginManager(agent);

      const csrfToken = await getCsrfToken(agent, `/manager/inventory/${item.id}/edit`);
      const response = await agent
        .post(`/manager/inventory/${item.id}?_method=PUT`)
        .type('form')
        .send({
          _csrf: csrfToken,
          _method: 'PUT',
          name: '',
          category: TEST_ITEM_CATEGORY,
          quantityOnHand: 50,
          unit: 'units',
          reorderLevel: 10
        });

      expect(response.status).toBe(302);
    });
  });

  describe('Manager adjusts inventory quantity', () => {
    let item, manager;

    beforeEach(async () => {
      manager = await User.findOne({ where: { email: 'manager@flowsync.com' } });
      item = await InventoryItem.create({
        name: TEST_ITEM_NAME,
        category: TEST_ITEM_CATEGORY,
        quantityOnHand: 50,
        unit: 'units',
        reorderLevel: 10
      });
    });

    test('Manager adjusts quantity positively returns 302 and updates quantity + creates log', async () => {
      const agent = request.agent(app);
      await loginManager(agent);

      const csrfToken = await getCsrfToken(agent, `/manager/inventory/${item.id}/edit`);
      const response = await agent
        .post(`/manager/inventory/${item.id}/adjust`)
        .type('form')
        .send({
          _csrf: csrfToken,
          changeAmount: 25,
          reason: 'Restock delivery'
        });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe(`/manager/inventory/${item.id}/edit`);

      await item.reload();
      expect(item.quantityOnHand).toBe(75);

      const log = await InventoryLog.findOne({
        where: { inventoryItemId: item.id, changeAmount: 25 }
      });
      expect(log).not.toBeNull();
      expect(log.reason).toBe('Restock delivery');
      expect(log.updatedBy).toBe(manager.id);
    });

    test('Manager adjusts quantity negatively returns 302 and updates quantity + creates log', async () => {
      const agent = request.agent(app);
      await loginManager(agent);

      const csrfToken = await getCsrfToken(agent, `/manager/inventory/${item.id}/edit`);
      const response = await agent
        .post(`/manager/inventory/${item.id}/adjust`)
        .type('form')
        .send({
          _csrf: csrfToken,
          changeAmount: -20,
          reason: 'Sold to customer'
        });

      expect(response.status).toBe(302);

      await item.reload();
      expect(item.quantityOnHand).toBe(30);

      const log = await InventoryLog.findOne({
        where: { inventoryItemId: item.id, changeAmount: -20 }
      });
      expect(log).not.toBeNull();
    });

    test('Manager adjusts below zero returns 302 and quantity unchanged', async () => {
      const agent = request.agent(app);
      await loginManager(agent);

      const csrfToken = await getCsrfToken(agent, `/manager/inventory/${item.id}/edit`);
      const response = await agent
        .post(`/manager/inventory/${item.id}/adjust`)
        .type('form')
        .send({
          _csrf: csrfToken,
          changeAmount: -100, // More than on hand
          reason: 'Spoilage'
        });

      expect(response.status).toBe(302);
      // Should redirect back with error

      await item.reload();
      expect(item.quantityOnHand).toBe(50); // Unchanged
    });

    test('Manager adjusts with non-integer amount returns 302', async () => {
      const agent = request.agent(app);
      await loginManager(agent);

      const csrfToken = await getCsrfToken(agent, `/manager/inventory/${item.id}/edit`);
      const response = await agent
        .post(`/manager/inventory/${item.id}/adjust`)
        .type('form')
        .send({
          _csrf: csrfToken,
          changeAmount: 'abc',
          reason: 'Test'
        });

      expect(response.status).toBe(302);
    });
  });

  describe('Manager deletes inventory item', () => {
    test('Manager deletes item returns 302 and item NOT in DB', async () => {
      const item = await InventoryItem.create({
        name: TEST_ITEM_NAME,
        category: TEST_ITEM_CATEGORY,
        quantityOnHand: 50,
        unit: 'units',
        reorderLevel: 10
      });

      const agent = request.agent(app);
      await loginManager(agent);

      const csrfToken = await getCsrfToken(agent, '/manager/inventory');
      const response = await agent
        .delete(`/manager/inventory/${item.id}`)
        .type('form')
        .send({ _csrf: csrfToken });

      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/manager/inventory');

      const deleted = await InventoryItem.findOne({ where: { id: item.id } });
      expect(deleted).toBeNull();
    });
  });

  describe('Staff inventory access', () => {
    test('Staff GET /staff/inventory returns 200 and shows read-only view', async () => {
      // Create some inventory items
      await InventoryItem.create({
        name: `${TEST_PREFIX}Item 1`,
        category: 'Cat1',
        quantityOnHand: 10,
        unit: 'units',
        reorderLevel: 5
      });
      await InventoryItem.create({
        name: `${TEST_PREFIX}Item 2`,
        category: 'Cat2',
        quantityOnHand: 20,
        unit: 'boxes',
        reorderLevel: 10
      });

      const agent = request.agent(app);
      await loginStaff(agent);

      const response = await agent.get('/staff/inventory');
      expect(response.status).toBe(200);
    });

    test('Staff GET /manager/inventory returns 302 or 403 and redirects to /staff/dashboard', async () => {
      const agent = request.agent(app);
      await loginStaff(agent);

      const response = await agent.get('/manager/inventory');
      expect([302, 403]).toContain(response.status);
      if (response.status === 302) {
        expect(response.headers.location).toBe('/staff/dashboard');
      }
    });

    test('Staff GET /manager/inventory/new returns 302 or 403', async () => {
      const agent = request.agent(app);
      await loginStaff(agent);

      const response = await agent.get('/manager/inventory/new');
      expect([302, 403]).toContain(response.status);
    });

    test('Staff cannot POST to /manager/inventory/*', async () => {
      const agent = request.agent(app);
      await loginStaff(agent);

      const csrfToken = await getCsrfToken(agent, '/staff/dashboard');
      const response = await agent
        .post('/manager/inventory')
        .type('form')
        .send({
          _csrf: csrfToken,
          name: 'Hacker Item',
          category: 'Hacked',
          quantityOnHand: 999
        });

      expect([302, 403]).toContain(response.status);
    });

    test('Staff cannot adjust inventory via /manager/inventory/:id/adjust', async () => {
      const item = await InventoryItem.create({
        name: TEST_ITEM_NAME,
        category: TEST_ITEM_CATEGORY,
        quantityOnHand: 50,
        unit: 'units',
        reorderLevel: 10
      });

      const agent = request.agent(app);
      await loginStaff(agent);

      const csrfToken = await getCsrfToken(agent, '/staff/dashboard');
      const response = await agent
        .post(`/manager/inventory/${item.id}/adjust`)
        .type('form')
        .send({
          _csrf: csrfToken,
          changeAmount: 100,
          reason: 'Unauthorized'
        });

      expect([302, 403]).toContain(response.status);

      await item.reload();
      expect(item.quantityOnHand).toBe(50); // Unchanged
    });

    test('Staff cannot delete inventory', async () => {
      const item = await InventoryItem.create({
        name: TEST_ITEM_NAME,
        category: TEST_ITEM_CATEGORY,
        quantityOnHand: 50,
        unit: 'units',
        reorderLevel: 10
      });

      const agent = request.agent(app);
      await loginStaff(agent);

      const csrfToken = await getCsrfToken(agent, '/staff/dashboard');
      const response = await agent
        .delete(`/manager/inventory/${item.id}`)
        .type('form')
        .send({ _csrf: csrfToken });

      expect([302, 403]).toContain(response.status);

      const stillExists = await InventoryItem.findOne({ where: { id: item.id } });
      expect(stillExists).not.toBeNull();
    });
  });
});
