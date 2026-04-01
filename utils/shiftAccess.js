const { Checklist, ChecklistCompletion, ChecklistItem, Shift, ShiftAssignment } = require('../models');

const CHECKLIST_SHIFT_TO_SHIFT = {
  MORNING: 'OPENING',
  MIDDAY: 'MID_SHIFT',
  EVENING: 'CLOSING'
};

const SHIFT_TO_CHECKLIST_SHIFT = {
  OPENING: 'MORNING',
  MID_SHIFT: 'MIDDAY',
  CLOSING: 'EVENING'
};

async function getAssignedChecklistShiftTypes(userId, date) {
  const assignments = await ShiftAssignment.findAll({
    where: { userId },
    include: [{
      model: Shift,
      as: 'Shift',
      required: true,
      where: { shiftDate: date },
      attributes: ['shiftType']
    }]
  });

  return [...new Set(
    assignments
      .map((assignment) => SHIFT_TO_CHECKLIST_SHIFT[assignment.Shift?.shiftType])
      .filter(Boolean)
  )];
}

async function canAccessChecklistShift(userId, checklistShiftType, date) {
  const assignedChecklistShiftTypes = await getAssignedChecklistShiftTypes(userId, date);
  return assignedChecklistShiftTypes.includes(checklistShiftType);
}

async function getChecklistProgressForUser(userId, date) {
  const assignedChecklistShiftTypes = await getAssignedChecklistShiftTypes(userId, date);

  const checklists = assignedChecklistShiftTypes.length === 0
    ? []
    : await Checklist.findAll({
      where: { isActive: true, shiftType: assignedChecklistShiftTypes },
      include: [{
        model: ChecklistItem,
        as: 'items',
        order: [['sortOrder', 'ASC']]
      }],
      order: [['shiftType', 'ASC']]
    });

  const completions = await ChecklistCompletion.findAll({
    where: {
      userId,
      date
    }
  });

  const completionMap = {};
  completions.forEach((completion) => {
    completionMap[completion.checklistItemId] = completion;
  });

  const checklistData = checklists.map((checklist) => ({
    id: checklist.id,
    title: checklist.title,
    shiftType: checklist.shiftType,
    items: checklist.items.map((item) => ({
      id: item.id,
      text: item.text,
      category: item.category,
      completion: completionMap[item.id] || null
    }))
  }));

  let totalTasks = 0;
  let completedTasks = 0;
  let inProgressTasks = 0;

  checklistData.forEach((checklist) => {
    checklist.items.forEach((item) => {
      totalTasks += 1;

      if (item.completion?.status === 'COMPLETED') {
        completedTasks += 1;
      } else if (item.completion?.status === 'IN_PROGRESS') {
        inProgressTasks += 1;
      }
    });
  });

  return {
    assignedChecklistShiftTypes,
    checklistData,
    completionMap,
    completions,
    stats: {
      total: totalTasks,
      completed: completedTasks,
      remaining: totalTasks - completedTasks - inProgressTasks,
      inProgress: inProgressTasks,
      percentage: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
    }
  };
}

module.exports = {
  canAccessChecklistShift,
  CHECKLIST_SHIFT_TO_SHIFT,
  getAssignedChecklistShiftTypes,
  getChecklistProgressForUser,
  SHIFT_TO_CHECKLIST_SHIFT
};
