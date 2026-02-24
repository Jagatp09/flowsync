require('dotenv').config();
// Import all models first to ensure they're registered before sync
const { sequelize, User, Checklist, ChecklistItem, ChecklistCompletion, ShiftReport, InventoryItem, InventoryLog, Shift, ShiftAssignment, ShiftNote, ShiftSummary, TaskAssignment } = require('./models');

async function seed() {
  try {
    console.log('Connecting to database...');
    await sequelize.authenticate();
    console.log('Connected to database.');

    console.log('Syncing database...');
    await sequelize.sync({ force: true });
    console.log('Database synced.');

    // Create users
    console.log('Creating users...');

    const manager = await User.create({
      fullName: 'Alex Johnson',
      email: 'manager@flowsync.com',
      passwordHash: 'Password123',
      role: 'MANAGER'
    });

    const staff1 = await User.create({
      fullName: 'Jordan Smith',
      email: 'staff@flowsync.com',
      passwordHash: 'Password123',
      role: 'STAFF'
    });

    const staff2 = await User.create({
      fullName: 'Taylor Reed',
      email: 'taylor@flowsync.com',
      passwordHash: 'Password123',
      role: 'STAFF'
    });

    const staff3 = await User.create({
      fullName: 'Casey Moon',
      email: 'casey@flowsync.com',
      passwordHash: 'Password123',
      role: 'STAFF'
    });

    console.log('Users created.');

    // Create checklists
    console.log('Creating checklists...');

    const morningChecklist = await Checklist.create({
      title: 'Morning Prep',
      shiftType: 'MORNING',
      description: 'Opening procedures and morning prep tasks'
    });

    const middayChecklist = await Checklist.create({
      title: 'Midday Handover',
      shiftType: 'MIDDAY',
      description: 'Midday operations and handover tasks'
    });

    const eveningChecklist = await Checklist.create({
      title: 'Evening Closing',
      shiftType: 'EVENING',
      description: 'Closing procedures and end of day tasks'
    });

    console.log('Checklists created.');

    // Create checklist items
    console.log('Creating checklist items...');

    const morningItems = await ChecklistItem.bulkCreate([
      { text: 'Turn on all equipment', category: 'Equipment', sortOrder: 1, checklistId: morningChecklist.id },
      { text: 'Check inventory levels', category: 'Inventory', sortOrder: 2, checklistId: morningChecklist.id },
      { text: 'Review daily schedule', category: 'Management', sortOrder: 3, checklistId: morningChecklist.id },
      { text: 'Team briefing', category: 'Management', sortOrder: 4, checklistId: morningChecklist.id },
      { text: 'Open register', category: 'Operations', sortOrder: 5, checklistId: morningChecklist.id },
    ]);

    const middayItems = await ChecklistItem.bulkCreate([
      { text: 'Midday inventory check', category: 'Inventory', sortOrder: 1, checklistId: middayChecklist.id },
      { text: 'Restock supplies', category: 'Operations', sortOrder: 2, checklistId: middayChecklist.id },
      { text: 'Shift handover briefing', category: 'Management', sortOrder: 3, checklistId: middayChecklist.id },
    ]);

    const eveningItems = await ChecklistItem.bulkCreate([
      { text: 'Close register', category: 'Operations', sortOrder: 1, checklistId: eveningChecklist.id },
      { text: 'End of day inventory', category: 'Inventory', sortOrder: 2, checklistId: eveningChecklist.id },
      { text: 'Clean workspace', category: 'Maintenance', sortOrder: 3, checklistId: eveningChecklist.id },
      { text: 'Security check', category: 'Security', sortOrder: 4, checklistId: eveningChecklist.id },
      { text: 'Submit daily report', category: 'Management', sortOrder: 5, checklistId: eveningChecklist.id },
    ]);

    console.log('Checklist items created.');

    // Create some completions for demo
    console.log('Creating completions...');

    const today = new Date().toISOString().split('T')[0];

    await ChecklistCompletion.bulkCreate([
      // Morning items - mostly completed
      { checklistItemId: morningItems[0].id, userId: staff1.id, status: 'COMPLETED', completedAt: new Date(), date: today },
      { checklistItemId: morningItems[1].id, userId: staff1.id, status: 'COMPLETED', completedAt: new Date(), date: today },
      { checklistItemId: morningItems[2].id, userId: staff1.id, status: 'COMPLETED', completedAt: new Date(), date: today },
      { checklistItemId: morningItems[3].id, userId: staff1.id, status: 'COMPLETED', completedAt: new Date(), date: today },
      { checklistItemId: morningItems[4].id, userId: staff1.id, status: 'IN_PROGRESS', date: today },

      // Midday items - some completed
      { checklistItemId: middayItems[0].id, userId: staff2.id, status: 'COMPLETED', completedAt: new Date(), date: today },
      { checklistItemId: middayItems[1].id, userId: staff2.id, status: 'PENDING', date: today },
      { checklistItemId: middayItems[2].id, userId: staff2.id, status: 'PENDING', date: today },

      // Evening items - mostly pending
      { checklistItemId: eveningItems[0].id, userId: staff3.id, status: 'PENDING', date: today },
      { checklistItemId: eveningItems[1].id, userId: staff3.id, status: 'PENDING', date: today },
      { checklistItemId: eveningItems[2].id, userId: staff3.id, status: 'PENDING', date: today },
    ]);

    console.log('Completions created.');

    // Create inventory items
    console.log('Creating inventory items...');

    await InventoryItem.bulkCreate([
      // Normal stock items
      { name: 'Napkins', category: 'Paper Goods', quantityOnHand: 500, unit: 'pcs', reorderLevel: 100 },
      { name: 'Paper Towels', category: 'Paper Goods', quantityOnHand: 200, unit: 'rolls', reorderLevel: 50 },
      { name: 'All-Purpose Cleaner', category: 'Cleaning', quantityOnHand: 15, unit: 'bottles', reorderLevel: 10 },
      { name: 'Coffee Beans', category: 'Food', quantityOnHand: 25, unit: 'kg', reorderLevel: 10 },
      { name: 'Disposable Cups', category: 'Supplies', quantityOnHand: 300, unit: 'pcs', reorderLevel: 100 },
      // Low stock items (at or below reorder level)
      { name: 'Hand Sanitizer', category: 'Supplies', quantityOnHand: 3, unit: 'bottles', reorderLevel: 10 },
      { name: 'Trash Bags', category: 'Supplies', quantityOnHand: 20, unit: 'rolls', reorderLevel: 20 },
      { name: 'Dish Soap', category: 'Cleaning', quantityOnHand: 2, unit: 'bottles', reorderLevel: 5 },
    ]);

    console.log('Inventory items created.');

    // Create shifts for demo
    console.log('Creating shifts...');

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // today is already defined earlier in the seed file

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    // Yesterday's opening shift (closed)
    const yesterdayOpening = await Shift.create({
      shiftType: 'OPENING',
      shiftDate: yesterdayStr,
      status: 'CLOSED',
      startedAt: new Date(`${yesterdayStr}T08:00:00`),
      endedAt: new Date(`${yesterdayStr}T16:00:00`),
      createdBy: manager.id,
      managerId: manager.id,
      notes: 'Good morning shift, all systems running smoothly.'
    });

    // Yesterday's closing shift (closed)
    const yesterdayClosing = await Shift.create({
      shiftType: 'CLOSING',
      shiftDate: yesterdayStr,
      status: 'CLOSED',
      startedAt: new Date(`${yesterdayStr}T16:00:00`),
      endedAt: new Date(`${yesterdayStr}T22:00:00`),
      createdBy: manager.id,
      managerId: manager.id,
      notes: 'Closed successfully, low foot traffic in evening.'
    });

    // Today's opening shift (active)
    const todayOpening = await Shift.create({
      shiftType: 'OPENING',
      shiftDate: today,
      status: 'ACTIVE',
      startedAt: new Date(`${today}T08:00:00`),
      createdBy: manager.id,
      managerId: manager.id,
      notes: 'Opening rush expected at 9am.'
    });

    // Today's mid shift (scheduled)
    await Shift.create({
      shiftType: 'MID_SHIFT',
      shiftDate: today,
      status: 'SCHEDULED',
      createdBy: manager.id,
      managerId: manager.id,
      notes: 'Midday handover from opening team.'
    });

    // Today's closing shift (scheduled)
    await Shift.create({
      shiftType: 'CLOSING',
      shiftDate: today,
      status: 'SCHEDULED',
      createdBy: manager.id,
      managerId: manager.id,
      notes: 'Expected to close at 10pm.'
    });

    // Tomorrow's opening shift (scheduled)
    await Shift.create({
      shiftType: 'OPENING',
      shiftDate: tomorrowStr,
      status: 'SCHEDULED',
      createdBy: manager.id,
      managerId: manager.id,
    });

    // Create shift assignments
    console.log('Creating shift assignments...');

    await ShiftAssignment.bulkCreate([
      { shiftId: yesterdayOpening.id, userId: staff1.id, roleLabel: 'Lead' },
      { shiftId: yesterdayOpening.id, userId: staff2.id, roleLabel: 'Staff' },
      { shiftId: yesterdayClosing.id, userId: staff2.id, roleLabel: 'Lead' },
      { shiftId: yesterdayClosing.id, userId: staff3.id, roleLabel: 'Staff' },
      { shiftId: todayOpening.id, userId: staff1.id, roleLabel: 'Lead' },
      { shiftId: todayOpening.id, userId: staff2.id, roleLabel: 'Staff' },
    ]);

    // Create shift notes (handoff notes)
    console.log('Creating shift notes...');

    await ShiftNote.bulkCreate([
      {
        shiftId: yesterdayClosing.id,
        noteText: 'All closing tasks completed. Register balanced. Low inventory on hand sanitizer - recommend restocking tomorrow.',
        createdBy: staff2.id
      },
      {
        shiftId: todayOpening.id,
        noteText: 'Opening team ready. All equipment checked and operational.',
        createdBy: staff1.id
      },
    ]);

    // Create shift summary for yesterday's shifts
    console.log('Creating shift summaries...');

    await ShiftSummary.create({
      shiftId: yesterdayOpening.id,
      totalTasks: 5,
      completedTasks: 5,
      pendingTasks: 0,
      completionPercent: 100,
      issuesCount: 0,
      notes: 'Excellent shift, all tasks completed on time.'
    });

    await ShiftSummary.create({
      shiftId: yesterdayClosing.id,
      totalTasks: 5,
      completedTasks: 4,
      pendingTasks: 1,
      completionPercent: 80,
      issuesCount: 0,
      notes: 'One task pending - deep cleaning moved to next opening.'
    });

    // Create task assignments
    console.log('Creating task assignments...');

    await TaskAssignment.bulkCreate([
      {
        shiftId: todayOpening.id,
        assignedTo: staff1.id,
        customTaskText: 'Prepare opening supplies',
        priority: 'HIGH',
        status: 'DONE',
        notes: 'Ensure all supplies are ready before opening'
      },
      {
        shiftId: todayOpening.id,
        assignedTo: staff2.id,
        customTaskText: 'Review inventory levels',
        priority: 'MEDIUM',
        status: 'OPEN',
        notes: 'Check stock and report any low items'
      },
      {
        shiftId: todayOpening.id,
        assignedTo: staff3.id,
        customTaskText: 'Set up POS system',
        priority: 'HIGH',
        status: 'OPEN',
        notes: 'Ensure register is ready and test payments'
      }
    ]);

    console.log('Task assignments created.');

    console.log('Shifts created.');

    console.log('\n=== Seed Complete ===');
    console.log('\nDemo Credentials:');
    console.log('Manager: manager@flowsync.com / Password123');
    console.log('Staff: staff@flowsync.com / Password123');
    console.log('\nRun "npm start" to start the app.');

    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
}

seed();
