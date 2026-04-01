const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const TIME_REGEX = /^\d{2}:\d{2}(?::\d{2})?$/;

function toTrimmedString(value, { maxLength = 255, allowEmpty = false } = {}) {
  if (typeof value !== 'string') {
    return allowEmpty ? '' : null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return allowEmpty ? '' : null;
  }

  return trimmed.slice(0, maxLength);
}

function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return EMAIL_REGEX.test(email) ? email : null;
}

function isValidDate(value) {
  if (!DATE_REGEX.test(value || '')) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime());
}

function normalizeDate(value) {
  return isValidDate(value) ? value : null;
}

function normalizeTime(value) {
  if (!value) {
    return null;
  }

  if (!TIME_REGEX.test(value)) {
    return null;
  }

  return value.slice(0, 5);
}

function normalizeInteger(value, { min = null, max = null, allowNull = false } = {}) {
  if (value === undefined || value === null || value === '') {
    return allowNull ? null : NaN;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return NaN;
  }

  if (min !== null && parsed < min) {
    return NaN;
  }

  if (max !== null && parsed > max) {
    return NaN;
  }

  return parsed;
}

function normalizeEnum(value, allowedValues) {
  return allowedValues.includes(value) ? value : null;
}

function normalizeBoolean(value) {
  return value === true || value === 'true' || value === 'on';
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null || value === '') {
    return [];
  }

  return [value];
}

function timeToMinutes(value) {
  if (!TIME_REGEX.test(value || '')) {
    return null;
  }

  const [hours, minutes] = value.split(':').slice(0, 2).map((part) => Number.parseInt(part, 10));
  return (hours * 60) + minutes;
}

module.exports = {
  normalizeBoolean,
  normalizeDate,
  normalizeEmail,
  normalizeEnum,
  normalizeInteger,
  normalizeTime,
  timeToMinutes,
  toArray,
  toTrimmedString
};
