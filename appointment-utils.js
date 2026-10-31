(function () {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  function normalizeYear(year) {
    let value = Number(year);
    if (value < 100) value += 2500;
    if (value > 2400) value -= 543;
    return value;
  }

  function validDate(year, month, day) {
    const date = new Date(year, month, day);
    return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day ? date : null;
  }

  function parseDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    const text = String(value || '').trim();
    if (!text) return null;
    let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (match) return validDate(normalizeYear(match[1]), Number(match[2]) - 1, Number(match[3]));
    match = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (match) return validDate(normalizeYear(match[3]), Number(match[2]) - 1, Number(match[1]));
    match = text.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{2,4})$/);
    if (match && Object.prototype.hasOwnProperty.call(MONTHS, match[2].toLowerCase())) {
      return validDate(normalizeYear(match[3]), MONTHS[match[2].toLowerCase()], Number(match[1]));
    }
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }

  function startOfDay(value) {
    const date = value instanceof Date ? value : parseDate(value);
    return date ? new Date(date.getFullYear(), date.getMonth(), date.getDate()) : null;
  }

  function dayDiff(target, today) {
    const a = startOfDay(target), b = startOfDay(today || new Date());
    return a && b ? Math.round((a.getTime() - b.getTime()) / DAY_MS) : null;
  }

  function appointmentStatus(appointment, today) {
    const rawStatus = String((appointment && appointment.status) || 'รอนัด');
    if (rawStatus === 'เสร็จสิ้น') return 'done';
    if (rawStatus === 'ยกเลิก') return 'cancelled';
    const days = dayDiff(appointment && appointment.appointmentDate, today || new Date());
    if (days === null) return 'unknown';
    if (days < 0) return 'overdue';
    if (days === 0) return 'today';
    if (days <= Number(appointment.reminderDays || 7)) return 'dueSoon';
    return 'upcoming';
  }

  function formatDate(value) {
    const date = startOfDay(value);
    return date ? date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' }) : 'ไม่ระบุวันที่';
  }

  window.KINDERY_APPOINTMENTS = { parseDate, dayDiff, appointmentStatus, formatDate };
})();
