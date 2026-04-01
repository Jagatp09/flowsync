const { Op, col } = require('sequelize');
const {
  Checklist,
  ChecklistCompletion,
  ChecklistItem,
  InventoryItem,
  LeaveRequest,
  Shift,
  ShiftAssignment,
  ShiftNote,
  ShiftSwap,
  StaffAttendance,
  User
} = require('../models');

function getDateRange(dateStr) {
  const baseDate = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  const startOfDay = new Date(baseDate);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(baseDate);
  endOfDay.setHours(23, 59, 59, 999);

  return {
    startOfDay,
    endOfDay,
    dateStr: startOfDay.toISOString().split('T')[0]
  };
}

async function buildManagerDashboardData(date) {
  const { startOfDay, endOfDay, dateStr } = getDateRange(date);

  const [checklists, completions, allStaff, activeStaff, recentCompletions, activeShift, recentClosedShift, lowStockItems, pendingLeaveCount, pendingSwapCount] = await Promise.all([
    Checklist.findAll({
      where: { isActive: true },
      include: [{ model: ChecklistItem, as: 'items' }],
      order: [['shiftType', 'ASC'], ['id', 'ASC']]
    }),
    ChecklistCompletion.findAll({
      where: { completedAt: { [Op.between]: [startOfDay, endOfDay] } },
      include: [
        { model: User, as: 'User', attributes: ['fullName'] },
        { model: ChecklistItem, as: 'ChecklistItem', attributes: ['text', 'checklistId'] }
      ]
    }),
    User.findAll({
      where: { role: 'STAFF', isActive: true },
      attributes: ['id', 'fullName']
    }),
    StaffAttendance.findAll({
      where: { date: dateStr, status: 'CLOCKED_IN' },
      include: [{ model: User, as: 'User', attributes: ['id', 'fullName'] }]
    }),
    ChecklistCompletion.findAll({
      where: {
        status: 'COMPLETED',
        completedAt: { [Op.between]: [startOfDay, endOfDay] }
      },
      include: [
        { model: User, as: 'User', attributes: ['fullName'] },
        { model: ChecklistItem, as: 'ChecklistItem', attributes: ['text'] }
      ],
      order: [['completedAt', 'DESC']],
      limit: 10
    }),
    Shift.findOne({
      where: { status: 'ACTIVE' },
      include: [
        { model: User, as: 'createdByUser', attributes: ['fullName'] },
        { model: ShiftAssignment, as: 'assignments', include: [{ model: User, as: 'User', attributes: ['fullName'] }] }
      ]
    }),
    Shift.findOne({
      where: { status: 'CLOSED' },
      order: [['endedAt', 'DESC']]
    }),
    InventoryItem.findAll({
      where: {
        [Op.or]: [
          { quantityOnHand: { [Op.lte]: col('reorderLevel') } },
          { quantityOnHand: { [Op.lt]: 10 } }
        ]
      },
      order: [['quantityOnHand', 'ASC']],
      limit: 10
    }),
    LeaveRequest.count({ where: { status: 'PENDING' } }),
    ShiftSwap.count({ where: { status: 'PENDING' } })
  ]);

  const itemCompletionMap = {};
  completions.forEach((completion) => {
    itemCompletionMap[completion.checklistItemId] = completion;
  });

  let totalTasks = 0;
  let completedTasks = 0;

  const checklistProgress = checklists.map((checklist) => {
    const items = checklist.items || [];
    const itemCount = items.length;
    totalTasks += itemCount;

    let completedCount = 0;
    items.forEach((item) => {
      if (itemCompletionMap[item.id]?.status === 'COMPLETED') {
        completedCount += 1;
      }
    });

    completedTasks += completedCount;

    const percent = itemCount > 0 ? Math.round((completedCount / itemCount) * 100) : 0;
    const status = percent === 100
      ? 'Completed'
      : percent >= 80
        ? 'On Track'
        : percent > 0
          ? 'In Progress'
          : 'Scheduled';

    return {
      id: checklist.id,
      title: checklist.title,
      shiftType: checklist.shiftType,
      totalItems: itemCount,
      completedItems: completedCount,
      percent,
      status
    };
  });

  const completionByUser = {};
  completions.forEach((completion) => {
    if (!completionByUser[completion.userId]) {
      completionByUser[completion.userId] = {};
    }

    completionByUser[completion.userId][completion.checklistItemId] = completion;
  });

  const staffMap = {};
  activeStaff.forEach((attendance) => {
    staffMap[attendance.userId] = attendance.User ? attendance.User.fullName : 'Unknown';
  });

  const missingTasks = [];
  checklists.forEach((checklist) => {
    checklist.items.forEach((item) => {
      const pendingStaff = Object.entries(staffMap)
        .filter(([userId]) => completionByUser[userId]?.[item.id]?.status !== 'COMPLETED')
        .map(([, name]) => name);

      if (pendingStaff.length > 0) {
        missingTasks.push({
          itemText: item.text,
          checklistTitle: checklist.title,
          shiftType: checklist.shiftType,
          pendingStaff
        });
      }
    });
  });

  const recentShiftNotes = recentClosedShift
    ? await ShiftNote.findAll({
      where: { shiftId: recentClosedShift.id },
      include: [{ model: User, as: 'author', attributes: ['fullName'] }],
      order: [['createdAt', 'DESC']],
      limit: 2
    })
    : [];

  return {
    selectedDate: dateStr,
    stats: {
      completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      pendingTasks: Math.max(totalTasks - completedTasks, 0),
      activeStaff: activeStaff.length,
      totalStaff: allStaff.length,
      totalTasks,
      completedTasks,
      pendingApprovals: pendingLeaveCount + pendingSwapCount
    },
    checklistProgress,
    recentCompletions,
    allStaff,
    missingTasks: missingTasks.slice(0, 10),
    lowStockItems: lowStockItems.map((item) => item.toJSON()),
    activeShift: activeShift ? activeShift.toJSON() : null,
    recentShiftNotes: recentShiftNotes.map((note) => note.toJSON())
  };
}

module.exports = {
  buildManagerDashboardData,
  getDateRange
};
