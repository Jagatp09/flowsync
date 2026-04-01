require('dotenv').config();

const {
  sequelize,
  ActivityLog,
  Checklist,
  ChecklistCompletion,
  ChecklistItem,
  InventoryItem,
  InventoryLog,
  LeaveRequest,
  Shift,
  ShiftAssignment,
  ShiftNote,
  ShiftReport,
  ShiftSummary,
  ShiftSwap,
  StaffAttendance,
  TaskAssignment,
  User
} = require('./models');

function formatDate(date) {
  return date.toISOString().split('T')[0];
}

function daysFromToday(offset) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return formatDate(date);
}

function atTime(dateStr, timeStr) {
  const normalized = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  return new Date(`${dateStr}T${normalized}`);
}

function withTimestamps(records, createdAt) {
  return records.map((record) => ({
    ...record,
    createdAt,
    updatedAt: createdAt
  }));
}

async function createChecklistWithItems({ title, shiftType, description, isActive = true, items }) {
  const checklist = await Checklist.create({
    title,
    shiftType,
    description,
    isActive
  });

  const checklistItems = await ChecklistItem.bulkCreate(
    items.map((item, index) => ({
      text: item.text,
      description: item.description || null,
      category: item.category || 'General',
      sortOrder: index + 1,
      isCustom: false,
      checklistId: checklist.id
    })),
    { returning: true }
  );

  return { checklist, items: checklistItems };
}

async function createShift(definition, managerId) {
  return Shift.create({
    title: definition.title,
    shiftType: definition.shiftType,
    shiftDate: definition.shiftDate,
    scheduledStart: definition.scheduledStart,
    scheduledEnd: definition.scheduledEnd,
    priority: definition.priority || 'MEDIUM',
    status: definition.status,
    startedAt: definition.startedAt || null,
    endedAt: definition.endedAt || null,
    notes: definition.notes || null,
    createdBy: managerId,
    managerId
  });
}

async function seed() {
  try {
    console.log('Connecting to database...');
    await sequelize.authenticate();
    console.log('Connected to database.');

    console.log('Resetting database...');
    await sequelize.sync({ force: true });
    console.log('Database synced.');

    const dates = {
      fourDaysAgo: daysFromToday(-4),
      twoDaysAgo: daysFromToday(-2),
      yesterday: daysFromToday(-1),
      today: daysFromToday(0),
      tomorrow: daysFromToday(1),
      twoDaysFromNow: daysFromToday(2),
      nextWeek: daysFromToday(7),
      nextWeekPlusOne: daysFromToday(8),
      nextWeekPlusTwo: daysFromToday(9),
      nextWeekPlusThree: daysFromToday(10)
    };

    console.log('Creating users...');
    const manager = await User.create({
      fullName: 'Alex Johnson',
      email: 'manager@flowsync.com',
      passwordHash: 'Password123',
      role: 'MANAGER',
      isActive: true
    });

    const jordan = await User.create({
      fullName: 'Jordan Smith',
      email: 'staff@flowsync.com',
      passwordHash: 'Password123',
      role: 'STAFF',
      isActive: true
    });

    const taylor = await User.create({
      fullName: 'Taylor Reed',
      email: 'taylor@flowsync.com',
      passwordHash: 'Password123',
      role: 'STAFF',
      isActive: true
    });

    const casey = await User.create({
      fullName: 'Casey Moon',
      email: 'casey@flowsync.com',
      passwordHash: 'Password123',
      role: 'STAFF',
      isActive: true
    });

    const morgan = await User.create({
      fullName: 'Morgan Lee',
      email: 'morgan@flowsync.com',
      passwordHash: 'Password123',
      role: 'STAFF',
      isActive: true
    });

    const riley = await User.create({
      fullName: 'Riley Chen',
      email: 'riley@flowsync.com',
      passwordHash: 'Password123',
      role: 'STAFF',
      isActive: true
    });

    const jamie = await User.create({
      fullName: 'Jamie Wilson',
      email: 'jamie@flowsync.com',
      passwordHash: 'Password123',
      role: 'STAFF',
      isActive: false
    });

    console.log('Users created.');

    console.log('Creating checklists and tasks...');
    const morningChecklistData = await createChecklistWithItems({
      title: 'Morning Opening Runbook',
      shiftType: 'MORNING',
      description: 'Opening procedures, merchandising checks, and register prep.',
      items: [
        { text: 'Disarm alarm and unlock front entrance', category: 'Security' },
        { text: 'Power on POS, printers, and handheld scanners', category: 'Operations' },
        { text: 'Count float and verify register totals', category: 'Operations' },
        { text: 'Review overnight notes and low-stock alerts', category: 'Management' },
        { text: 'Walk floor and recover high-traffic zones', category: 'Maintenance' },
        { text: 'Restock grab-and-go fixtures', category: 'Inventory' },
        { text: 'Confirm online pickup orders are staged', category: 'Operations' }
      ]
    });

    const middayChecklistData = await createChecklistWithItems({
      title: 'Midday Handover Checklist',
      shiftType: 'MIDDAY',
      description: 'Handover, replenishment, and operational quality checks.',
      items: [
        { text: 'Audit midday sales floor conditions', category: 'Operations' },
        { text: 'Receive and check supplier delivery', category: 'Inventory' },
        { text: 'Replenish promotional endcaps', category: 'Operations' },
        { text: 'Update backroom transfer sheet', category: 'Management' },
        { text: 'Sanitize checkout counters and touchpoints', category: 'Maintenance' },
        { text: 'Brief closing lead on customer issues', category: 'Management' }
      ]
    });

    const eveningChecklistData = await createChecklistWithItems({
      title: 'Evening Close Checklist',
      shiftType: 'EVENING',
      description: 'Closing procedures, cash handling, and security closeout.',
      items: [
        { text: 'Run closing cash count and variance review', category: 'Operations' },
        { text: 'Sweep low-stock sections for tomorrow reorder list', category: 'Inventory' },
        { text: 'Complete final floor recovery', category: 'Maintenance' },
        { text: 'Lock backroom and secure high-value items', category: 'Security' },
        { text: 'Submit end-of-day shift report', category: 'Management' },
        { text: 'Power down non-essential devices', category: 'Equipment' },
        { text: 'Confirm exits are secured and alarm is set', category: 'Security' }
      ]
    });

    await createChecklistWithItems({
      title: 'Seasonal Display Reset',
      shiftType: 'MIDDAY',
      description: 'Inactive checklist kept for archive/demo purposes.',
      isActive: false,
      items: [
        { text: 'Swap window signage to current promo', category: 'Operations' },
        { text: 'Update aisle fins and wayfinding', category: 'Operations' },
        { text: 'Photograph final display for manager review', category: 'Management' }
      ]
    });

    const morningItems = morningChecklistData.items;
    const middayItems = middayChecklistData.items;
    const eveningItems = eveningChecklistData.items;
    console.log('Checklists created.');

    console.log('Creating shifts...');
    const shiftDefinitions = {
      fourDaysOpening: {
        title: 'Grand Opening Prep',
        shiftType: 'OPENING',
        shiftDate: dates.fourDaysAgo,
        scheduledStart: '08:00',
        scheduledEnd: '16:00',
        status: 'CLOSED',
        startedAt: atTime(dates.fourDaysAgo, '08:02'),
        endedAt: atTime(dates.fourDaysAgo, '16:04'),
        notes: 'Strong day with smooth launch of the new display wall.'
      },
      fourDaysClosing: {
        title: 'Late Close Recovery',
        shiftType: 'CLOSING',
        shiftDate: dates.fourDaysAgo,
        scheduledStart: '15:00',
        scheduledEnd: '22:00',
        status: 'CLOSED',
        startedAt: atTime(dates.fourDaysAgo, '15:03'),
        endedAt: atTime(dates.fourDaysAgo, '22:08'),
        notes: 'Minor receipt printer delay resolved before close.'
      },
      twoDaysOpening: {
        title: 'Stock Intake Morning',
        shiftType: 'OPENING',
        shiftDate: dates.twoDaysAgo,
        scheduledStart: '08:00',
        scheduledEnd: '16:00',
        status: 'CLOSED',
        startedAt: atTime(dates.twoDaysAgo, '08:00'),
        endedAt: atTime(dates.twoDaysAgo, '16:01'),
        notes: 'Delivery arrived early and intake completed before noon.'
      },
      twoDaysMidday: {
        title: 'Vendor Support Block',
        shiftType: 'MID_SHIFT',
        shiftDate: dates.twoDaysAgo,
        scheduledStart: '12:00',
        scheduledEnd: '20:00',
        status: 'CLOSED',
        startedAt: atTime(dates.twoDaysAgo, '12:05'),
        endedAt: atTime(dates.twoDaysAgo, '20:02'),
        notes: 'Vendor walkthrough completed with pricing corrections.'
      },
      yesterdayOpening: {
        title: 'Morning Rush Coverage',
        shiftType: 'OPENING',
        shiftDate: dates.yesterday,
        scheduledStart: '08:00',
        scheduledEnd: '16:00',
        status: 'CLOSED',
        startedAt: atTime(dates.yesterday, '07:58'),
        endedAt: atTime(dates.yesterday, '16:00'),
        notes: 'Strong opening execution and fast queue handling.'
      },
      yesterdayMidday: {
        title: 'Midday Floor Reset',
        shiftType: 'MID_SHIFT',
        shiftDate: dates.yesterday,
        scheduledStart: '11:30',
        scheduledEnd: '19:30',
        status: 'CLOSED',
        startedAt: atTime(dates.yesterday, '11:34'),
        endedAt: atTime(dates.yesterday, '19:31'),
        notes: 'Endcaps refreshed and backroom organized.'
      },
      yesterdayClosing: {
        title: 'Closing Recovery',
        shiftType: 'CLOSING',
        shiftDate: dates.yesterday,
        scheduledStart: '15:30',
        scheduledEnd: '22:00',
        status: 'CLOSED',
        startedAt: atTime(dates.yesterday, '15:29'),
        endedAt: atTime(dates.yesterday, '22:05'),
        notes: 'Deep cleaning rolled into today opening follow-up.'
      },
      todayOpening: {
        title: 'Opening Floor Leadership',
        shiftType: 'OPENING',
        shiftDate: dates.today,
        scheduledStart: '08:00',
        scheduledEnd: '16:00',
        status: 'ACTIVE',
        startedAt: atTime(dates.today, '08:01'),
        notes: 'Morning pickup volume is above average today.'
      },
      todayMidday: {
        title: 'Midday Delivery Window',
        shiftType: 'MID_SHIFT',
        shiftDate: dates.today,
        scheduledStart: '12:00',
        scheduledEnd: '20:00',
        status: 'SCHEDULED',
        notes: 'Expect two carrier drop-offs and a merchandising visit.'
      },
      todayClosing: {
        title: 'Close and Audit',
        shiftType: 'CLOSING',
        shiftDate: dates.today,
        scheduledStart: '15:30',
        scheduledEnd: '22:00',
        status: 'SCHEDULED',
        notes: 'Cash office audit required before alarm set.'
      },
      tomorrowOpening: {
        title: 'Customer Event Opening',
        shiftType: 'OPENING',
        shiftDate: dates.tomorrow,
        scheduledStart: '08:00',
        scheduledEnd: '16:00',
        status: 'SCHEDULED',
        notes: 'Weekend promo event starts at 10am.'
      },
      tomorrowClosing: {
        title: 'Promo Close Coverage',
        shiftType: 'CLOSING',
        shiftDate: dates.tomorrow,
        scheduledStart: '15:30',
        scheduledEnd: '22:00',
        status: 'SCHEDULED',
        notes: 'Extra floor recovery expected after event traffic.'
      },
      twoDaysOpeningFuture: {
        title: 'Restock and Reset',
        shiftType: 'OPENING',
        shiftDate: dates.twoDaysFromNow,
        scheduledStart: '08:00',
        scheduledEnd: '16:00',
        status: 'SCHEDULED',
        notes: 'Full shelf reset planned before noon.'
      },
      twoDaysMiddayFuture: {
        title: 'Delivery Processing Block',
        shiftType: 'MID_SHIFT',
        shiftDate: dates.twoDaysFromNow,
        scheduledStart: '12:00',
        scheduledEnd: '20:00',
        status: 'SCHEDULED',
        notes: 'Carrier intake plus backroom relabeling.'
      },
      nextWeekClosing: {
        title: 'Weekly Audit Close',
        shiftType: 'CLOSING',
        shiftDate: dates.nextWeek,
        scheduledStart: '14:00',
        scheduledEnd: '22:00',
        status: 'SCHEDULED',
        notes: 'Weekly compliance audit due before end of shift.'
      }
    };

    const shifts = {};
    for (const [key, definition] of Object.entries(shiftDefinitions)) {
      shifts[key] = await createShift(definition, manager.id);
    }
    console.log('Shifts created.');

    console.log('Creating shift assignments...');
    await ShiftAssignment.bulkCreate([
      { shiftId: shifts.fourDaysOpening.id, userId: jordan.id, roleLabel: 'Lead', scheduledStart: '08:00', duration: 8, actualStart: atTime(dates.fourDaysAgo, '08:00'), actualEnd: atTime(dates.fourDaysAgo, '16:00'), actualDuration: 480, status: 'COMPLETED' },
      { shiftId: shifts.fourDaysOpening.id, userId: taylor.id, roleLabel: 'Support', scheduledStart: '08:00', duration: 8, actualStart: atTime(dates.fourDaysAgo, '08:03'), actualEnd: atTime(dates.fourDaysAgo, '15:58'), actualDuration: 475, status: 'COMPLETED' },
      { shiftId: shifts.fourDaysClosing.id, userId: casey.id, roleLabel: 'Lead', scheduledStart: '15:00', duration: 7, actualStart: atTime(dates.fourDaysAgo, '15:00'), actualEnd: atTime(dates.fourDaysAgo, '22:00'), actualDuration: 420, status: 'COMPLETED' },
      { shiftId: shifts.fourDaysClosing.id, userId: morgan.id, roleLabel: 'Recovery', scheduledStart: '15:00', duration: 7, actualStart: atTime(dates.fourDaysAgo, '15:02'), actualEnd: atTime(dates.fourDaysAgo, '22:06'), actualDuration: 424, status: 'COMPLETED' },
      { shiftId: shifts.twoDaysOpening.id, userId: jordan.id, roleLabel: 'Lead', scheduledStart: '08:00', duration: 8, actualStart: atTime(dates.twoDaysAgo, '08:00'), actualEnd: atTime(dates.twoDaysAgo, '15:59'), actualDuration: 479, status: 'COMPLETED' },
      { shiftId: shifts.twoDaysOpening.id, userId: riley.id, roleLabel: 'Stock', scheduledStart: '08:00', duration: 8, actualStart: atTime(dates.twoDaysAgo, '08:07'), actualEnd: atTime(dates.twoDaysAgo, '16:00'), actualDuration: 473, status: 'COMPLETED' },
      { shiftId: shifts.twoDaysMidday.id, userId: taylor.id, roleLabel: 'Lead', scheduledStart: '12:00', duration: 8, actualStart: atTime(dates.twoDaysAgo, '12:03'), actualEnd: atTime(dates.twoDaysAgo, '20:00'), actualDuration: 477, status: 'COMPLETED' },
      { shiftId: shifts.twoDaysMidday.id, userId: casey.id, roleLabel: 'Vendor Liaison', scheduledStart: '12:00', duration: 8, actualStart: atTime(dates.twoDaysAgo, '12:00'), actualEnd: atTime(dates.twoDaysAgo, '19:57'), actualDuration: 477, status: 'COMPLETED' },
      { shiftId: shifts.yesterdayOpening.id, userId: jordan.id, roleLabel: 'Lead', scheduledStart: '08:00', duration: 8, actualStart: atTime(dates.yesterday, '07:58'), actualEnd: atTime(dates.yesterday, '16:00'), actualDuration: 482, status: 'COMPLETED' },
      { shiftId: shifts.yesterdayOpening.id, userId: riley.id, roleLabel: 'Floor', scheduledStart: '08:00', duration: 8, actualStart: atTime(dates.yesterday, '08:01'), actualEnd: atTime(dates.yesterday, '15:59'), actualDuration: 478, status: 'COMPLETED' },
      { shiftId: shifts.yesterdayMidday.id, userId: taylor.id, roleLabel: 'Lead', scheduledStart: '11:30', duration: 8, actualStart: atTime(dates.yesterday, '11:34'), actualEnd: atTime(dates.yesterday, '19:30'), actualDuration: 476, status: 'COMPLETED' },
      { shiftId: shifts.yesterdayMidday.id, userId: casey.id, roleLabel: 'Ops', scheduledStart: '11:30', duration: 8, actualStart: atTime(dates.yesterday, '11:32'), actualEnd: atTime(dates.yesterday, '19:28'), actualDuration: 476, status: 'COMPLETED' },
      { shiftId: shifts.yesterdayClosing.id, userId: morgan.id, roleLabel: 'Lead', scheduledStart: '15:30', duration: 7, actualStart: atTime(dates.yesterday, '15:29'), actualEnd: atTime(dates.yesterday, '22:05'), actualDuration: 396, status: 'COMPLETED' },
      { shiftId: shifts.yesterdayClosing.id, userId: riley.id, roleLabel: 'Cash Office', scheduledStart: '15:30', duration: 7, actualStart: atTime(dates.yesterday, '15:33'), actualEnd: atTime(dates.yesterday, '22:00'), actualDuration: 387, status: 'COMPLETED' },
      { shiftId: shifts.todayOpening.id, userId: jordan.id, roleLabel: 'Lead', scheduledStart: '08:00', duration: 8, actualStart: atTime(dates.today, '08:01'), status: 'CLOCKED_IN' },
      { shiftId: shifts.todayOpening.id, userId: taylor.id, roleLabel: 'Cashwrap', scheduledStart: '08:00', duration: 8, actualStart: atTime(dates.today, '08:02'), status: 'CLOCKED_IN' },
      { shiftId: shifts.todayOpening.id, userId: morgan.id, roleLabel: 'Floor Recovery', scheduledStart: '08:00', duration: 8, actualStart: atTime(dates.today, '08:04'), status: 'CLOCKED_IN' },
      { shiftId: shifts.todayMidday.id, userId: casey.id, roleLabel: 'Lead', scheduledStart: '12:00', duration: 8, status: 'PENDING' },
      { shiftId: shifts.todayMidday.id, userId: riley.id, roleLabel: 'Receiving', scheduledStart: '12:00', duration: 8, status: 'PENDING' },
      { shiftId: shifts.todayClosing.id, userId: morgan.id, roleLabel: 'Lead', scheduledStart: '15:30', duration: 7, status: 'PENDING' },
      { shiftId: shifts.todayClosing.id, userId: taylor.id, roleLabel: 'Cash Office', scheduledStart: '15:30', duration: 7, status: 'PENDING' },
      { shiftId: shifts.tomorrowOpening.id, userId: casey.id, roleLabel: 'Lead', scheduledStart: '08:00', duration: 8, status: 'PENDING' },
      { shiftId: shifts.tomorrowOpening.id, userId: jordan.id, roleLabel: 'Sales Floor', scheduledStart: '08:00', duration: 8, status: 'PENDING' },
      { shiftId: shifts.tomorrowClosing.id, userId: jordan.id, roleLabel: 'Lead', scheduledStart: '15:30', duration: 7, status: 'PENDING' },
      { shiftId: shifts.tomorrowClosing.id, userId: riley.id, roleLabel: 'Recovery', scheduledStart: '15:30', duration: 7, status: 'PENDING' },
      { shiftId: shifts.twoDaysOpeningFuture.id, userId: morgan.id, roleLabel: 'Lead', scheduledStart: '08:00', duration: 8, status: 'PENDING' },
      { shiftId: shifts.twoDaysOpeningFuture.id, userId: taylor.id, roleLabel: 'Stock', scheduledStart: '08:00', duration: 8, status: 'PENDING' },
      { shiftId: shifts.twoDaysMiddayFuture.id, userId: riley.id, roleLabel: 'Lead', scheduledStart: '12:00', duration: 8, status: 'PENDING' },
      { shiftId: shifts.twoDaysMiddayFuture.id, userId: casey.id, roleLabel: 'Ops', scheduledStart: '12:00', duration: 8, status: 'PENDING' },
      { shiftId: shifts.nextWeekClosing.id, userId: jordan.id, roleLabel: 'Lead', scheduledStart: '14:00', duration: 8, status: 'PENDING' },
      { shiftId: shifts.nextWeekClosing.id, userId: morgan.id, roleLabel: 'Compliance', scheduledStart: '14:00', duration: 8, status: 'PENDING' }
    ]);
    console.log('Shift assignments created.');

    console.log('Creating shift notes and summaries...');
    await ShiftNote.bulkCreate([
      { shiftId: shifts.fourDaysClosing.id, noteText: 'Hand sanitizer sold down faster than expected after the event rush.', createdBy: casey.id },
      { shiftId: shifts.twoDaysMidday.id, noteText: 'Vendor corrected two shelf tags and approved the new placement.', createdBy: taylor.id },
      { shiftId: shifts.yesterdayOpening.id, noteText: 'Pickup staging area was full by 10am, but the queue stayed under five minutes.', createdBy: jordan.id },
      { shiftId: shifts.yesterdayClosing.id, noteText: 'One deep-clean task deferred to this morning due to a late customer pickup.', createdBy: morgan.id },
      { shiftId: shifts.todayOpening.id, noteText: 'Coffee station restocked, but hand sanitizer and dish soap are both low.', createdBy: jordan.id },
      { shiftId: shifts.todayOpening.id, noteText: 'Customer event signage is up and front display looks ready for midday traffic.', createdBy: taylor.id }
    ]);

    await ShiftSummary.bulkCreate([
      { shiftId: shifts.fourDaysOpening.id, totalTasks: 7, completedTasks: 7, pendingTasks: 0, completionPercent: 100, issuesCount: 0, staffCount: 2, summaryNotes: 'Opening was fully on time with zero carryover.' },
      { shiftId: shifts.fourDaysClosing.id, totalTasks: 7, completedTasks: 6, pendingTasks: 1, completionPercent: 86, issuesCount: 1, staffCount: 2, summaryNotes: 'Receipt printer issue documented and resolved before lockup.' },
      { shiftId: shifts.twoDaysOpening.id, totalTasks: 7, completedTasks: 7, pendingTasks: 0, completionPercent: 100, issuesCount: 0, staffCount: 2, summaryNotes: 'Large stock intake completed early with strong floor recovery.' },
      { shiftId: shifts.twoDaysMidday.id, totalTasks: 6, completedTasks: 5, pendingTasks: 1, completionPercent: 83, issuesCount: 1, staffCount: 2, summaryNotes: 'One merchandising update rolled forward to the next midday shift.' },
      { shiftId: shifts.yesterdayOpening.id, totalTasks: 7, completedTasks: 7, pendingTasks: 0, completionPercent: 100, issuesCount: 0, staffCount: 2, summaryNotes: 'Excellent queue control and clean handoff into midday.' },
      { shiftId: shifts.yesterdayMidday.id, totalTasks: 6, completedTasks: 5, pendingTasks: 1, completionPercent: 83, issuesCount: 1, staffCount: 2, summaryNotes: 'Backroom relabeling finished, but one aisle audit remained open.' },
      { shiftId: shifts.yesterdayClosing.id, totalTasks: 7, completedTasks: 6, pendingTasks: 1, completionPercent: 86, issuesCount: 1, staffCount: 2, summaryNotes: 'Closing cash count balanced. Deep clean deferred to next opening.' }
    ]);
    console.log('Shift notes and summaries created.');

    console.log('Creating task assignments...');
    const taskAssignments = await TaskAssignment.bulkCreate([
      { shiftId: shifts.todayOpening.id, assignedTo: jordan.id, checklistItemId: morningItems[0].id, priority: 'HIGH', status: 'DONE', notes: 'Completed before doors opened.' },
      { shiftId: shifts.todayOpening.id, assignedTo: taylor.id, checklistItemId: morningItems[2].id, priority: 'HIGH', status: 'DONE', notes: 'Register variance was zero.' },
      { shiftId: shifts.todayOpening.id, assignedTo: morgan.id, customTaskText: 'Refresh grab-and-go endcap', priority: 'MEDIUM', status: 'OPEN', notes: 'Finish before 11am traffic spike.' },
      { shiftId: shifts.todayMidday.id, assignedTo: casey.id, checklistItemId: middayItems[1].id, priority: 'HIGH', status: 'OPEN', notes: 'Carrier ETA updated to 12:40pm.' },
      { shiftId: shifts.todayMidday.id, assignedTo: riley.id, customTaskText: 'Cycle count cleaning aisle', priority: 'MEDIUM', status: 'OPEN', notes: 'Confirm hand sanitizer and dish soap counts.' },
      { shiftId: shifts.todayClosing.id, assignedTo: morgan.id, checklistItemId: eveningItems[0].id, priority: 'HIGH', status: 'OPEN', notes: 'Close with manager audit checklist.' },
      { shiftId: shifts.todayClosing.id, assignedTo: taylor.id, customTaskText: 'Prepare tomorrow promo recovery cart', priority: 'MEDIUM', status: 'OPEN', notes: 'Stage tape, tags, and pricing binder.' },
      { shiftId: shifts.tomorrowClosing.id, assignedTo: jordan.id, customTaskText: 'Lead weekend promo close', priority: 'HIGH', status: 'OPEN', notes: 'Expect additional markdown checks.' },
      { shiftId: shifts.twoDaysMiddayFuture.id, assignedTo: casey.id, customTaskText: 'Coach new delivery workflow', priority: 'LOW', status: 'OPEN', notes: 'Use updated intake sheet.' }
    ], { returning: true });
    console.log('Task assignments created.');

    console.log('Creating checklist completion history...');
    const completionRecords = [];

    function addCompletion(item, user, dateStr, timeStr, status = 'COMPLETED', notes = null) {
      completionRecords.push({
        checklistItemId: item.id,
        userId: user.id,
        date: dateStr,
        status,
        notes,
        completedAt: status === 'COMPLETED' ? atTime(dateStr, timeStr) : null,
        createdAt: atTime(dateStr, timeStr),
        updatedAt: atTime(dateStr, timeStr)
      });
    }

    morningItems.forEach((item, index) => addCompletion(item, index < 4 ? jordan : taylor, dates.fourDaysAgo, `08:${String(10 + index * 4).padStart(2, '0')}`));
    eveningItems.forEach((item, index) => addCompletion(item, index < 4 ? casey : morgan, dates.fourDaysAgo, `20:${String(5 + index * 3).padStart(2, '0')}`));
    morningItems.forEach((item, index) => addCompletion(item, index < 4 ? jordan : riley, dates.twoDaysAgo, `08:${String(12 + index * 3).padStart(2, '0')}`));
    middayItems.forEach((item, index) => addCompletion(item, index < 4 ? taylor : casey, dates.twoDaysAgo, `12:${String(8 + index * 5).padStart(2, '0')}`, index === 5 ? 'PARTIAL' : 'COMPLETED', index === 5 ? 'Vendor note carried to next shift.' : null));
    morningItems.forEach((item, index) => addCompletion(item, index < 5 ? jordan : riley, dates.yesterday, `08:${String(9 + index * 4).padStart(2, '0')}`));
    middayItems.forEach((item, index) => addCompletion(item, index < 4 ? taylor : casey, dates.yesterday, `12:${String(6 + index * 6).padStart(2, '0')}`, index === 4 ? 'IN_PROGRESS' : 'COMPLETED'));
    eveningItems.forEach((item, index) => addCompletion(item, index < 4 ? morgan : riley, dates.yesterday, `20:${String(4 + index * 4).padStart(2, '0')}`, index === 6 ? 'PENDING' : 'COMPLETED', index === 6 ? 'Deep clean moved to opening team.' : null));
    addCompletion(morningItems[0], jordan, dates.today, '08:09');
    addCompletion(morningItems[1], jordan, dates.today, '08:15');
    addCompletion(morningItems[2], taylor, dates.today, '08:18');
    addCompletion(morningItems[3], jordan, dates.today, '08:24');
    addCompletion(morningItems[4], morgan, dates.today, '08:28');
    addCompletion(morningItems[5], morgan, dates.today, '08:34');
    addCompletion(morningItems[6], jordan, dates.today, '08:42', 'IN_PROGRESS', 'Waiting on one delayed pickup tote.');
    addCompletion(middayItems[0], casey, dates.today, '12:10');
    addCompletion(middayItems[1], casey, dates.today, '12:18', 'IN_PROGRESS', 'Carrier has only delivered half the cartons.');
    addCompletion(middayItems[2], riley, dates.today, '12:25', 'PENDING');
    addCompletion(middayItems[3], casey, dates.today, '12:32', 'PENDING');
    addCompletion(middayItems[4], riley, dates.today, '12:38', 'PENDING');
    addCompletion(middayItems[5], casey, dates.today, '12:44', 'PENDING');
    addCompletion(eveningItems[0], morgan, dates.today, '16:05', 'PENDING');
    addCompletion(eveningItems[1], taylor, dates.today, '16:08', 'PENDING');
    addCompletion(eveningItems[2], morgan, dates.today, '16:12', 'PENDING');
    addCompletion(eveningItems[3], taylor, dates.today, '16:15', 'PENDING');

    await ChecklistCompletion.bulkCreate(completionRecords);
    console.log('Checklist completions created.');

    console.log('Creating attendance records...');
    await StaffAttendance.bulkCreate([
      { userId: jordan.id, date: dates.fourDaysAgo, clockInTime: atTime(dates.fourDaysAgo, '08:00'), clockOutTime: atTime(dates.fourDaysAgo, '16:00'), status: 'CLOCKED_OUT', nextShiftDate: dates.twoDaysAgo },
      { userId: taylor.id, date: dates.fourDaysAgo, clockInTime: atTime(dates.fourDaysAgo, '08:03'), clockOutTime: atTime(dates.fourDaysAgo, '15:58'), status: 'CLOCKED_OUT', nextShiftDate: dates.twoDaysAgo },
      { userId: casey.id, date: dates.fourDaysAgo, clockInTime: atTime(dates.fourDaysAgo, '15:00'), clockOutTime: atTime(dates.fourDaysAgo, '22:00'), status: 'CLOCKED_OUT', nextShiftDate: dates.twoDaysAgo },
      { userId: morgan.id, date: dates.fourDaysAgo, clockInTime: atTime(dates.fourDaysAgo, '15:02'), clockOutTime: atTime(dates.fourDaysAgo, '22:06'), status: 'CLOCKED_OUT', nextShiftDate: dates.yesterday },
      { userId: jordan.id, date: dates.twoDaysAgo, clockInTime: atTime(dates.twoDaysAgo, '08:00'), clockOutTime: atTime(dates.twoDaysAgo, '15:59'), status: 'CLOCKED_OUT', nextShiftDate: dates.yesterday },
      { userId: riley.id, date: dates.twoDaysAgo, clockInTime: atTime(dates.twoDaysAgo, '08:07'), clockOutTime: atTime(dates.twoDaysAgo, '16:00'), status: 'CLOCKED_OUT', nextShiftDate: dates.yesterday },
      { userId: taylor.id, date: dates.twoDaysAgo, clockInTime: atTime(dates.twoDaysAgo, '11:34'), clockOutTime: atTime(dates.twoDaysAgo, '19:30'), status: 'CLOCKED_OUT', nextShiftDate: dates.today },
      { userId: casey.id, date: dates.twoDaysAgo, clockInTime: atTime(dates.twoDaysAgo, '11:32'), clockOutTime: atTime(dates.twoDaysAgo, '19:28'), status: 'CLOCKED_OUT', nextShiftDate: dates.today },
      { userId: jordan.id, date: dates.yesterday, clockInTime: atTime(dates.yesterday, '07:58'), clockOutTime: atTime(dates.yesterday, '16:00'), status: 'CLOCKED_OUT', nextShiftDate: dates.today },
      { userId: riley.id, date: dates.yesterday, clockInTime: atTime(dates.yesterday, '08:01'), clockOutTime: atTime(dates.yesterday, '15:59'), status: 'CLOCKED_OUT', nextShiftDate: dates.today },
      { userId: taylor.id, date: dates.yesterday, clockInTime: atTime(dates.yesterday, '11:34'), clockOutTime: atTime(dates.yesterday, '19:30'), status: 'CLOCKED_OUT', nextShiftDate: dates.today },
      { userId: casey.id, date: dates.yesterday, clockInTime: atTime(dates.yesterday, '11:32'), clockOutTime: atTime(dates.yesterday, '19:28'), status: 'CLOCKED_OUT', nextShiftDate: dates.today },
      { userId: morgan.id, date: dates.yesterday, clockInTime: atTime(dates.yesterday, '15:29'), clockOutTime: atTime(dates.yesterday, '22:05'), status: 'CLOCKED_OUT', nextShiftDate: dates.today },
      { userId: jordan.id, date: dates.today, clockInTime: atTime(dates.today, '08:01'), status: 'CLOCKED_IN', nextShiftDate: dates.tomorrow },
      { userId: taylor.id, date: dates.today, clockInTime: atTime(dates.today, '08:02'), status: 'CLOCKED_IN', nextShiftDate: dates.twoDaysFromNow },
      { userId: morgan.id, date: dates.today, clockInTime: atTime(dates.today, '08:04'), status: 'CLOCKED_IN', nextShiftDate: dates.today },
      { userId: casey.id, date: dates.today, status: 'NOT_STARTED', nextShiftDate: dates.today },
      { userId: riley.id, date: dates.today, status: 'NOT_STARTED', nextShiftDate: dates.today }
    ]);
    console.log('Attendance created.');

    console.log('Creating inventory and stock movement...');
    const inventoryItems = await InventoryItem.bulkCreate([
      { name: 'Hand Sanitizer', category: 'Cleaning', quantityOnHand: 3, unit: 'bottles', reorderLevel: 10 },
      { name: 'Dish Soap', category: 'Cleaning', quantityOnHand: 2, unit: 'bottles', reorderLevel: 5 },
      { name: 'All-Purpose Cleaner', category: 'Cleaning', quantityOnHand: 14, unit: 'bottles', reorderLevel: 8 },
      { name: 'Paper Towels', category: 'Paper Goods', quantityOnHand: 18, unit: 'rolls', reorderLevel: 10 },
      { name: 'Napkins', category: 'Paper Goods', quantityOnHand: 420, unit: 'packs', reorderLevel: 120 },
      { name: 'Coffee Beans', category: 'Food', quantityOnHand: 24, unit: 'kg', reorderLevel: 10 },
      { name: 'Tea Bags', category: 'Food', quantityOnHand: 180, unit: 'boxes', reorderLevel: 60 },
      { name: 'Disposable Cups', category: 'Supplies', quantityOnHand: 65, unit: 'sleeves', reorderLevel: 80 },
      { name: 'Trash Bags', category: 'Supplies', quantityOnHand: 8, unit: 'rolls', reorderLevel: 10 },
      { name: 'Shelf Tags', category: 'Supplies', quantityOnHand: 140, unit: 'sheets', reorderLevel: 40 },
      { name: 'POS Paper Rolls', category: 'Equipment', quantityOnHand: 12, unit: 'rolls', reorderLevel: 15 },
      { name: 'Batteries AA', category: 'Equipment', quantityOnHand: 28, unit: 'packs', reorderLevel: 12 },
      { name: 'Printer Toner', category: 'Equipment', quantityOnHand: 4, unit: 'cartridges', reorderLevel: 6 },
      { name: 'Window Cleaner', category: 'Cleaning', quantityOnHand: 7, unit: 'bottles', reorderLevel: 5 },
      { name: 'Promo Sign Holders', category: 'Fixtures', quantityOnHand: 26, unit: 'units', reorderLevel: 10 }
    ], { returning: true });

    await InventoryLog.bulkCreate([
      ...withTimestamps([
        { inventoryItemId: inventoryItems[0].id, changeAmount: 24, reason: 'Weekly cleaning delivery', updatedBy: manager.id },
        { inventoryItemId: inventoryItems[5].id, changeAmount: 18, reason: 'Coffee restock from warehouse', updatedBy: jordan.id },
        { inventoryItemId: inventoryItems[10].id, changeAmount: 15, reason: 'POS consumables shipment', updatedBy: manager.id }
      ], atTime(dates.fourDaysAgo, '09:15')),
      ...withTimestamps([
        { inventoryItemId: inventoryItems[0].id, changeAmount: -8, reason: 'Daily sanitation usage', updatedBy: jordan.id },
        { inventoryItemId: inventoryItems[1].id, changeAmount: -4, reason: 'Cleaning station refill', updatedBy: riley.id },
        { inventoryItemId: inventoryItems[7].id, changeAmount: -20, reason: 'Promo weekend traffic usage', updatedBy: taylor.id }
      ], atTime(dates.twoDaysAgo, '13:10')),
      ...withTimestamps([
        { inventoryItemId: inventoryItems[8].id, changeAmount: -5, reason: 'Backroom cleanup use', updatedBy: morgan.id },
        { inventoryItemId: inventoryItems[12].id, changeAmount: -2, reason: 'Office printer replacement', updatedBy: manager.id },
        { inventoryItemId: inventoryItems[10].id, changeAmount: -3, reason: 'Register receipt usage', updatedBy: taylor.id }
      ], atTime(dates.yesterday, '18:45')),
      ...withTimestamps([
        { inventoryItemId: inventoryItems[0].id, changeAmount: -3, reason: 'High morning traffic usage', updatedBy: jordan.id },
        { inventoryItemId: inventoryItems[1].id, changeAmount: -1, reason: 'Break room sink refill', updatedBy: morgan.id },
        { inventoryItemId: inventoryItems[7].id, changeAmount: -10, reason: 'Morning beverage service', updatedBy: taylor.id },
        { inventoryItemId: inventoryItems[10].id, changeAmount: -1, reason: 'Receipt roll change at register 2', updatedBy: taylor.id }
      ], atTime(dates.today, '10:30'))
    ]);
    console.log('Inventory created.');

    console.log('Creating leave and swap requests...');
    await LeaveRequest.bulkCreate([
      {
        userId: jordan.id,
        leaveType: 'ANNUAL',
        startDate: dates.nextWeekPlusOne,
        endDate: dates.nextWeekPlusThree,
        reason: 'Family trip already approved with travel booked.',
        status: 'APPROVED',
        approvedBy: manager.id,
        approvedAt: atTime(dates.today, '09:20'),
        managerComment: 'Approved. Coverage moved to Morgan and Riley.'
      },
      {
        userId: jordan.id,
        leaveType: 'PERSONAL',
        startDate: dates.nextWeek,
        endDate: dates.nextWeek,
        reason: 'Doctor appointment in the afternoon.',
        status: 'PENDING'
      },
      {
        userId: taylor.id,
        leaveType: 'SICK',
        startDate: dates.tomorrow,
        endDate: dates.tomorrow,
        reason: 'Pending confirmation after clinic visit.',
        status: 'PENDING'
      },
      {
        userId: morgan.id,
        leaveType: 'PERSONAL',
        startDate: dates.twoDaysFromNow,
        endDate: dates.twoDaysFromNow,
        reason: 'Requested too late for audit week coverage.',
        status: 'REJECTED',
        approvedBy: manager.id,
        approvedAt: atTime(dates.today, '08:40'),
        managerComment: 'Rejected due to existing coverage gap on audit close.'
      }
    ]);

    await ShiftSwap.bulkCreate([
      {
        requesterId: jordan.id,
        targetShiftId: shifts.tomorrowClosing.id,
        targetUserId: riley.id,
        desiredShiftId: null,
        reason: 'Need coverage for a family dinner tomorrow evening.',
        status: 'PENDING',
        targetAccepted: null
      },
      {
        requesterId: casey.id,
        targetShiftId: shifts.tomorrowOpening.id,
        targetUserId: jordan.id,
        desiredShiftId: null,
        reason: 'Would like Jordan to cover the opening while I handle an appointment.',
        status: 'PENDING',
        targetAccepted: null
      },
      {
        requesterId: morgan.id,
        targetShiftId: shifts.twoDaysOpeningFuture.id,
        targetUserId: taylor.id,
        desiredShiftId: null,
        reason: 'Approved trade to balance weekend openings.',
        status: 'APPROVED',
        targetAccepted: true,
        approvedBy: manager.id,
        approvedAt: atTime(dates.today, '09:05'),
        managerComment: 'Approved after both staff confirmed availability.'
      },
      {
        requesterId: riley.id,
        targetShiftId: shifts.twoDaysMiddayFuture.id,
        targetUserId: morgan.id,
        desiredShiftId: null,
        reason: 'Requested due to a class conflict.',
        status: 'REJECTED',
        targetAccepted: false,
        targetRejectionReason: 'Already covering the next opening and cannot extend back-to-back.',
        approvedBy: manager.id,
        approvedAt: atTime(dates.today, '09:12'),
        managerComment: 'Rejected because coverage would create fatigue risk.'
      }
    ]);
    console.log('Leave and swap requests created.');

    console.log('Creating reports...');
    await ShiftReport.bulkCreate([
      {
        userId: jordan.id,
        shiftType: 'MORNING',
        date: dates.twoDaysAgo,
        summary: 'Delivery intake finished before 11am and opening tasks were completed on time.',
        issues: 'None.',
        completedTasks: 7,
        totalTasks: 7,
        submittedAt: atTime(dates.twoDaysAgo, '16:00')
      },
      {
        userId: taylor.id,
        shiftType: 'MIDDAY',
        date: dates.twoDaysAgo,
        summary: 'Vendor visit complete. Endcap moves approved and documented.',
        issues: 'One merchandising item rolled to tomorrow.',
        completedTasks: 5,
        totalTasks: 6,
        submittedAt: atTime(dates.twoDaysAgo, '19:35')
      },
      {
        userId: jordan.id,
        shiftType: 'MORNING',
        date: dates.yesterday,
        summary: 'Morning rush handled smoothly with no queue backup.',
        issues: 'None.',
        completedTasks: 7,
        totalTasks: 7,
        submittedAt: atTime(dates.yesterday, '15:58')
      },
      {
        userId: morgan.id,
        shiftType: 'EVENING',
        date: dates.yesterday,
        summary: 'Closing was stable and the register balanced.',
        issues: 'Deep-clean task deferred because of late customer pickup.',
        completedTasks: 6,
        totalTasks: 7,
        submittedAt: atTime(dates.yesterday, '22:02')
      },
      {
        userId: jordan.id,
        shiftType: 'MORNING',
        date: dates.today,
        summary: 'Front display is ready and all pickup orders are staged before the midday handoff.',
        issues: 'Hand sanitizer and dish soap both need reorder attention.',
        completedTasks: 6,
        totalTasks: 7,
        submittedAt: atTime(dates.today, '11:40')
      }
    ]);
    console.log('Shift reports created.');

    console.log('Creating activity feed...');
    await ActivityLog.bulkCreate([
      ...withTimestamps([
        { userId: jordan.id, action: 'shift_started', entityType: 'shift', entityId: shifts.fourDaysOpening.id, details: { shiftType: 'OPENING', shiftTitle: shifts.fourDaysOpening.title } },
        { userId: casey.id, action: 'shift_started', entityType: 'shift', entityId: shifts.fourDaysClosing.id, details: { shiftType: 'CLOSING', shiftTitle: shifts.fourDaysClosing.title } },
        { userId: manager.id, action: 'inventory_updated', entityType: 'inventory', entityId: inventoryItems[0].id, details: { itemName: 'Hand Sanitizer', reason: 'Weekly cleaning delivery' } }
      ], atTime(dates.fourDaysAgo, '09:00')),
      ...withTimestamps([
        { userId: taylor.id, action: 'task_completed', entityType: 'task', entityId: taskAssignments[1].id, details: { task: 'Count float and verify register totals' } },
        { userId: casey.id, action: 'checklist_item_completed', entityType: 'checklist_item', entityId: middayItems[0].id, details: { itemText: middayItems[0].text } },
        { userId: manager.id, action: 'report_submitted', entityType: 'shift_report', entityId: 2, details: { shiftType: 'MIDDAY' } }
      ], atTime(dates.twoDaysAgo, '15:20')),
      ...withTimestamps([
        { userId: jordan.id, action: 'note_added', entityType: 'shift', entityId: shifts.yesterdayOpening.id, details: { shiftType: 'OPENING', note: 'Pickup staging area was full by 10am.' } },
        { userId: morgan.id, action: 'shift_closed', entityType: 'shift', entityId: shifts.yesterdayClosing.id, details: { shiftType: 'CLOSING' } },
        { userId: manager.id, action: 'leave_request_reviewed', entityType: 'leave_request', entityId: 4, details: { outcome: 'REJECTED', staff: morgan.fullName } }
      ], atTime(dates.yesterday, '21:15')),
      ...withTimestamps([
        { userId: jordan.id, action: 'shift_started', entityType: 'shift', entityId: shifts.todayOpening.id, details: { shiftType: 'OPENING', shiftTitle: shifts.todayOpening.title } },
        { userId: taylor.id, action: 'checklist_item_completed', entityType: 'checklist_item', entityId: morningItems[2].id, details: { itemText: morningItems[2].text } },
        { userId: manager.id, action: 'swap_request_reviewed', entityType: 'shift_swap', entityId: 3, details: { outcome: 'APPROVED', requester: morgan.fullName } },
        { userId: manager.id, action: 'inventory_alert', entityType: 'inventory', entityId: inventoryItems[0].id, details: { itemName: 'Hand Sanitizer', status: 'LOW_STOCK' } },
        { userId: jordan.id, action: 'leave_request_submitted', entityType: 'leave_request', entityId: 2, details: { leaveType: 'PERSONAL' } },
        { userId: casey.id, action: 'swap_request_submitted', entityType: 'shift_swap', entityId: 2, details: { targetUser: jordan.fullName } }
      ], atTime(dates.today, '09:10'))
    ]);
    console.log('Activity created.');

    console.log('');
    console.log('========================================');
    console.log('Demo data created successfully.');
    console.log('========================================');
    console.log(`Users: ${await User.count()}`);
    console.log(`Checklists: ${await Checklist.count()}`);
    console.log(`Checklist Items: ${await ChecklistItem.count()}`);
    console.log(`Shifts: ${await Shift.count()}`);
    console.log(`Shift Assignments: ${await ShiftAssignment.count()}`);
    console.log(`Task Assignments: ${await TaskAssignment.count()}`);
    console.log(`Checklist Completions: ${await ChecklistCompletion.count()}`);
    console.log(`Shift Notes: ${await ShiftNote.count()}`);
    console.log(`Shift Summaries: ${await ShiftSummary.count()}`);
    console.log(`Shift Reports: ${await ShiftReport.count()}`);
    console.log(`Inventory Items: ${await InventoryItem.count()}`);
    console.log(`Inventory Logs: ${await InventoryLog.count()}`);
    console.log(`Swap Requests: ${await ShiftSwap.count()}`);
    console.log(`Leave Requests: ${await LeaveRequest.count()}`);
    console.log(`Activity Logs: ${await ActivityLog.count()}`);
    console.log('');
    console.log('Manager login: manager@flowsync.com / Password123');
    console.log('Primary staff login: staff@flowsync.com / Password123');
    console.log('Additional staff: taylor@flowsync.com, casey@flowsync.com, morgan@flowsync.com, riley@flowsync.com / Password123');
    console.log('Inactive account: jamie@flowsync.com / Password123');
    console.log('');

    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
}

seed();
