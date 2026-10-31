const SPREADSHEET_ID = '1SPlpMZ2aOMgUK0meFZJ_Ps2P_HOWVSHWf-u1NVE5akg';
const STUDENT_SHEETS = [
  { sheetName: 'Preanuban', room: 'เตรียมอนุบาล 1/1', folderId: '1cQ3evCbe9xPAkHJqV2RWgZW84Yb2A3YA' },
  { sheetName: 'Preanuban2', room: 'เตรียมอนุบาล 1/2', folderId: '1qF4v_os-Bo5f3Woyw39A84LvKkAzBBNh' },
  { sheetName: 'Anuban', room: 'อนุบาล 1', folderId: '16WLektPLyR8u5PWN-kVG2lv-gnExNqKZ' }
];

const TEACHER_FOLDER_ID = '1XfGA8eyY7o5w3fgvU17JcLxr2qkl2_SC';
const PARENT_ACCOUNT_SHEET = 'ParentAccounts';
const TEACHER_ACCOUNT_SHEET = 'TeacherAccounts';
const GROWTH_SHEET = 'GrowthRecords';
const APPOINTMENT_SHEET = 'Appointments';

/**
 * API สำหรับหน้า Kindery
 * - ค่าเริ่มต้นส่งเฉพาะรายชื่อเด็ก/ครูและรูป
 * - parentLogin ตรวจ KID+เลขประจำตัวเด็ก + รหัสผ่านส่วนตัว
 *   แล้วคืนข้อมูลเฉพาะเด็กที่ผูกกับบัญชีนั้น
 * - parentData ใช้ session token ชั่วคราวเพื่ออ่านข้อมูลล่าสุด
 * - teacherLogin ตรวจ TEA+รหัสครู + รหัสผ่านประจำตัวครู
 */
function doGet(event) {
  const params = (event && event.parameter) || {};
  const callback = sanitizeCallback_(params.callback);
  try {
    const payload = routeApiAction_(params);
    return params.callback ? jsonp_(callback, payload) : jsonResponse_(payload);
  } catch (error) {
    const payload = { ok: false, error: String(error.message || error) };
    return params.callback ? jsonp_(callback, payload) : jsonResponse_(payload);
  }
}

/**
 * รับข้อมูลน้ำหนัก/ส่วนสูงและนัดหมายจากหน้าครู
 * หน้าเว็บส่งแบบ POST ผ่าน iframe เพื่อรองรับการเปิด index.html จากเครื่อง
 */
function doPost(event) {
  const params = (event && event.parameter) || {};
  const requestId = String(params.requestId || '').replace(/[^0-9A-Za-z_-]/g, '').slice(0, 100);
  try {
    return postMessageResponse_(requestId, routeApiAction_(params));
  } catch (error) {
    return postMessageResponse_(requestId, { ok: false, error: String(error.message || error) });
  }
}

function routeApiAction_(params) {
  const action = String(params.action || '');
  if (action === 'parentLogin') return parentLogin_(params.userId, params.password);
  if (action === 'parentData') return parentData_(params.token);
  if (action === 'teacherLogin') return teacherLogin_(params.userId, params.password);
  if (action === 'teacherData') return teacherData_(params.token);
  if (action === 'logout') return logout_(params.token, params.role);
  if (['saveGrowth', 'saveAppointment', 'saveAppointments', 'updateAppointmentStatus'].indexOf(action) === -1) {
    if (!action) return { ok: true, service: 'Kindery API', version: 'production-v1' };
    throw new Error('คำสั่งไม่ถูกต้อง');
  }
  const teacherSession = readTeacherSession_(params.teacherToken);
  if (!teacherSession) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง');
  if (action === 'saveGrowth') return saveGrowth_(params, teacherSession);
  if (action === 'updateAppointmentStatus') return updateAppointmentStatus_(params, teacherSession);
  return saveAppointments_(params, teacherSession);
}

function publicDirectory_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('kindery-directory-v3');
  if (cached) return JSON.parse(cached);

  const students = readAllStudents_().map(function (student) {
    return {
      studentId: student.studentId,
      name: student.name,
      fullName: student.fullName,
      room: student.room,
      photoUrl: student.photoUrl
    };
  });

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const teacherSheet = spreadsheet.getSheetByName('Teacher');
  const teacherPhotos = getPhotos_(TEACHER_FOLDER_ID);
  const teachers = [];

  if (teacherSheet && teacherSheet.getLastRow() >= 5) {
    const rows = teacherSheet.getRange(5, 2, teacherSheet.getLastRow() - 4, 4).getDisplayValues();
    rows.forEach(function (row) {
      const fullName = String(row[0] || '').trim();
      if (!fullName) return;
      const photoId = findPhotoId_(teacherPhotos, fullName);
      teachers.push({
        fullName: fullName,
        name: String(row[1] || '').trim(),
        role: String(row[2] || '').trim(),
        room: String(row[3] || '').replace(/^ชั้น/, '').trim(),
        photoUrl: photoId ? thumbnailUrl_(photoId) : ''
      });
    });
  }

  const payload = {
    ok: true,
    spreadsheetId: SPREADSHEET_ID,
    students: students,
    teachers: teachers,
    updatedAt: new Date().toISOString()
  };
  cache.put('kindery-directory-v3', JSON.stringify(payload), 300);
  return payload;
}

function parentLogin_(userId, password) {
  const normalizedUserId = normalizeParentUserId_(userId);
  const normalizedPassword = String(password || '').trim();

  if (!/^KID\d+$/.test(normalizedUserId) || normalizedPassword.length < 6 || normalizedPassword.length > 64) {
    return { ok: false, error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่านส่วนตัวให้ถูกต้อง' };
  }

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(PARENT_ACCOUNT_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return { ok: false, error: 'ยังไม่ได้ตั้งค่าบัญชีผู้ปกครอง' };

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getDisplayValues();
  const passwordHash = hashCredential_(normalizedPassword);
  const account = rows.find(function (row) {
    return normalizeParentUserId_(row[0]) === normalizedUserId &&
      secureCompare_(String(row[1] || '').trim(), passwordHash) &&
      String(row[5] || '').toUpperCase() !== 'FALSE';
  });

  if (!account) return { ok: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };

  const studentIds = String(account[3] || '').split(',').map(function (id) {
    return String(id || '').trim();
  }).filter(Boolean);

  const token = Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put(
    'parent-session-' + token,
    JSON.stringify({ userId: normalizedUserId, guardianName: account[2], studentIds: studentIds }),
    3600
  );

  const payload = buildParentPayload_(studentIds);
  payload.token = token;
  payload.guardianName = String(account[2] || '').trim();
  return payload;
}

function parentData_(token) {
  const cleanToken = String(token || '').replace(/[^0-9a-f]/gi, '');
  if (!cleanToken) return { ok: false, code: 'SESSION_EXPIRED', error: 'กรุณาเข้าสู่ระบบอีกครั้ง' };

  const cached = CacheService.getScriptCache().get('parent-session-' + cleanToken);
  if (!cached) return { ok: false, code: 'SESSION_EXPIRED', error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง' };

  const session = JSON.parse(cached);
  CacheService.getScriptCache().put('parent-session-' + cleanToken, cached, 3600);
  const payload = buildParentPayload_(session.studentIds || []);
  payload.token = cleanToken;
  payload.guardianName = session.guardianName || '';
  return payload;
}

function teacherLogin_(userId, password) {
  const normalizedUserId = normalizeTeacherUserId_(userId);
  const normalizedPassword = String(password || '').trim();

  if (!/^TEA\d{3}$/.test(normalizedUserId) || normalizedPassword.length < 6 || normalizedPassword.length > 64) {
    return { ok: false, error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่านส่วนตัวให้ถูกต้อง' };
  }

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(TEACHER_ACCOUNT_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return { ok: false, error: 'ยังไม่ได้ตั้งค่าบัญชีครู' };

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 8).getDisplayValues();
  const passwordHash = hashCredential_(normalizedPassword);
  const account = rows.find(function (row) {
    return normalizeTeacherUserId_(row[0]) === normalizedUserId &&
      secureCompare_(String(row[1] || '').trim(), passwordHash) &&
      String(row[6] || '').toUpperCase() !== 'FALSE';
  });

  if (!account) return { ok: false, error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };

  const teacher = {
    fullName: String(account[2] || '').trim(),
    name: String(account[3] || '').trim(),
    role: String(account[4] || '').trim(),
    room: String(account[5] || '').trim()
  };
  const token = Utilities.getUuid().replace(/-/g, '');
  CacheService.getScriptCache().put(
    'teacher-session-' + token,
    JSON.stringify(teacher),
    3600
  );

  return { ok: true, token: token, teacher: teacher, updatedAt: new Date().toISOString() };
}

function readTeacherSession_(token) {
  const cleanToken = String(token || '').replace(/[^0-9a-f]/gi, '');
  if (!cleanToken) return null;
  const cached = CacheService.getScriptCache().get('teacher-session-' + cleanToken);
  if (!cached) return null;
  CacheService.getScriptCache().put('teacher-session-' + cleanToken, cached, 3600);
  return JSON.parse(cached);
}

function teacherData_(token) {
  const teacher = readTeacherSession_(token);
  if (!teacher) return { ok: false, code: 'SESSION_EXPIRED', error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง' };
  const students = readAllStudents_();
  const studentIds = students.map(function (student) { return student.studentId; });
  return {
    ok: true,
    students: students,
    teachers: readAllTeachers_(),
    growthRecords: readGrowthRecords_(studentIds),
    appointments: readAppointments_(studentIds),
    updatedAt: new Date().toISOString()
  };
}

function logout_(token, role) {
  const cleanToken = String(token || '').replace(/[^0-9a-f]/gi, '');
  if (cleanToken) CacheService.getScriptCache().remove((String(role) === 'parent' ? 'parent-session-' : 'teacher-session-') + cleanToken);
  return { ok: true };
}

function buildParentPayload_(studentIds) {
  const allowed = {};
  studentIds.forEach(function (id) { allowed[String(id)] = true; });
  const students = readAllStudents_().filter(function (student) {
    return allowed[student.studentId];
  });

  return {
    ok: true,
    students: students,
    growthRecords: readGrowthRecords_(studentIds),
    appointments: readAppointments_(studentIds),
    updatedAt: new Date().toISOString()
  };
}

function saveGrowth_(params, teacherSession) {
  const studentId = String(params.studentId || '').trim();
  const measuredDate = String(params.measuredDate || '').trim();
  const weight = Number(params.weight);
  const height = Number(params.height);
  const note = String(params.note || '').trim().slice(0, 500);

  if (!studentId || !/^\d{4}-\d{2}-\d{2}$/.test(measuredDate)) throw new Error('ข้อมูลเด็กหรือวันที่ไม่ถูกต้อง');
  if (!isFinite(weight) || weight < 1 || weight > 60) throw new Error('น้ำหนักไม่ถูกต้อง');
  if (!isFinite(height) || height < 30 || height > 150) throw new Error('ส่วนสูงไม่ถูกต้อง');

  const student = readAllStudents_().find(function (item) {
    return item.studentId === studentId;
  });
  if (!student) throw new Error('ไม่พบข้อมูลเด็ก');

  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName(GROWTH_SHEET);
  if (!sheet) throw new Error('ไม่พบแท็บ ' + GROWTH_SHEET);

  const record = {
    recordId: Utilities.getUuid(),
    studentId: student.studentId,
    childName: student.fullName,
    room: student.room,
    measuredDate: measuredDate,
    weight: weight.toFixed(1),
    height: height.toFixed(1),
    note: note,
    updatedBy: teacherSession && teacherSession.name ? teacherSession.name : 'teacher',
    createdAt: new Date().toISOString()
  };

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet.appendRow([
      record.recordId,
      record.studentId,
      record.childName,
      record.room,
      record.measuredDate,
      Number(record.weight),
      Number(record.height),
      record.note,
      record.updatedBy,
      record.createdAt
    ]);
  } finally {
    lock.releaseLock();
  }

  return { ok: true, record: record };
}

function saveAppointments_(params, teacherSession) {
  const rawStudentIds = String(params.studentIds || params.studentId || '').split(',');
  const studentIds = rawStudentIds.map(function (id) { return String(id || '').trim(); }).filter(function (id, index, all) {
    return id && all.indexOf(id) === index;
  });
  const appointmentType = String(params.appointmentType || '').trim();
  const appointmentDate = String(params.appointmentDate || '').trim();
  const appointmentTime = String(params.appointmentTime || '').trim();
  const location = String(params.location || '').trim().slice(0, 180);
  const note = String(params.note || '').trim().slice(0, 500);
  const reminderDays = Math.max(0, Math.min(90, Number(params.reminderDays || 7)));
  const allowedTypes = ['นัดแพทย์', 'วัดน้ำหนัก–ส่วนสูง', 'รับวัคซีน', 'อื่นๆ'];
  if (!studentIds.length || studentIds.length > 100 || allowedTypes.indexOf(appointmentType) === -1 || !/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate)) {
    throw new Error('ข้อมูลนัดหมายไม่ครบหรือวันที่ไม่ถูกต้อง');
  }
  if (appointmentTime && !/^\d{2}:\d{2}$/.test(appointmentTime)) throw new Error('เวลานัดหมายไม่ถูกต้อง');
  const studentMap = {};
  readAllStudents_().forEach(function (student) { studentMap[student.studentId] = student; });
  const selectedStudents = studentIds.map(function (studentId) { return studentMap[studentId]; });
  if (selectedStudents.some(function (student) { return !student; })) throw new Error('ไม่พบข้อมูลเด็กบางรายการ');
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(APPOINTMENT_SHEET);
  if (!sheet) throw new Error('ไม่พบแท็บ ' + APPOINTMENT_SHEET);
  const createdAt = new Date().toISOString();
  const updatedBy = teacherSession.name || teacherSession.fullName || 'คุณครู';
  const records = selectedStudents.map(function (student) {
    return {
      appointmentId: Utilities.getUuid(), studentId: student.studentId, childName: student.fullName,
      room: student.room, appointmentType: appointmentType, appointmentDate: appointmentDate,
      appointmentTime: appointmentTime, location: location, note: note, status: 'รอนัด',
      reminderDays: reminderDays, updatedBy: updatedBy, createdAt: createdAt, completedAt: ''
    };
  });
  const rows = records.map(function (record) {
    return [record.appointmentId, record.studentId, record.childName, record.room, record.appointmentType,
      record.appointmentDate, record.appointmentTime, record.location, record.note, record.status,
      record.reminderDays, record.updatedBy, record.createdAt, record.completedAt];
  });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 14).setValues(rows);
  } finally {
    lock.releaseLock();
  }
  return { ok: true, appointments: records };
}

function updateAppointmentStatus_(params, teacherSession) {
  const appointmentId = String(params.appointmentId || '').trim();
  const status = String(params.status || '').trim();
  if (!appointmentId || ['รอนัด', 'เสร็จสิ้น'].indexOf(status) === -1) throw new Error('ข้อมูลสถานะไม่ถูกต้อง');
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(APPOINTMENT_SHEET);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('ไม่พบนัดหมาย');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues();
    const index = ids.findIndex(function (row) { return String(row[0] || '').trim() === appointmentId; });
    if (index === -1) throw new Error('ไม่พบนัดหมาย');
    const rowNumber = index + 2;
    const values = sheet.getRange(rowNumber, 10, 1, 5).getValues()[0];
    values[0] = status;
    values[2] = teacherSession.name || teacherSession.fullName || 'คุณครู';
    values[4] = status === 'เสร็จสิ้น' ? new Date().toISOString() : '';
    sheet.getRange(rowNumber, 10, 1, 5).setValues([values]);
    return { ok: true, appointmentId: appointmentId, status: status, completedAt: values[4] };
  } finally {
    lock.releaseLock();
  }
}

function readAllStudents_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const students = [];

  STUDENT_SHEETS.forEach(function (source) {
    const sheet = spreadsheet.getSheetByName(source.sheetName);
    if (!sheet) throw new Error('ไม่พบแท็บ ' + source.sheetName);
    const lastRow = sheet.getLastRow();
    if (lastRow < 5) return;

    const photos = getPhotos_(source.folderId);
    const rows = sheet.getRange(5, 2, lastRow - 4, 15).getDisplayValues();
    rows.forEach(function (row) {
      const fullName = String(row[1] || '').trim();
      const name = String(row[2] || '').trim();
      if (!name || !fullName) return;
      const photoId = findPhotoId_(photos, fullName);
      students.push({
        studentId: String(row[0] || '').trim(),
        fullName: fullName,
        name: name,
        room: source.room,
        birthDate: String(row[3] || '').trim(),
        guardianName: String(row[5] || '').trim(),
        guardianRelation: String(row[6] || '').trim(),
        houseNumber: String(row[7] || '').trim(),
        village: String(row[8] || '').trim(),
        road: String(row[9] || '').trim(),
        subdistrict: String(row[10] || '').trim(),
        district: String(row[11] || '').trim(),
        province: String(row[12] || '').trim(),
        postalCode: String(row[13] || '').trim(),
        phone: String(row[14] || '').trim(),
        photoUrl: photoId ? thumbnailUrl_(photoId) : ''
      });
    });
  });

  return students;
}

function readAllTeachers_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheetByName('Teacher');
  if (!sheet || sheet.getLastRow() < 5) return [];
  const photos = getPhotos_(TEACHER_FOLDER_ID);
  return sheet.getRange(5, 2, sheet.getLastRow() - 4, 4).getDisplayValues().map(function (row) {
    const fullName = String(row[0] || '').trim();
    if (!fullName) return null;
    const photoId = findPhotoId_(photos, fullName);
    return {
      fullName: fullName,
      name: String(row[1] || '').trim(),
      role: String(row[2] || '').trim(),
      room: String(row[3] || '').replace(/^ชั้น/, '').trim(),
      photoUrl: photoId ? thumbnailUrl_(photoId) : ''
    };
  }).filter(Boolean);
}

function readGrowthRecords_(studentIds) {
  const allowed = {};
  studentIds.forEach(function (id) { allowed[String(id)] = true; });
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(GROWTH_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).getDisplayValues();
  return rows.filter(function (row) {
    return allowed[String(row[1] || '').trim()];
  }).map(function (row) {
    return {
      recordId: String(row[0] || '').trim(),
      studentId: String(row[1] || '').trim(),
      childName: String(row[2] || '').trim(),
      room: String(row[3] || '').trim(),
      measuredDate: String(row[4] || '').trim(),
      weight: String(row[5] || '').trim(),
      height: String(row[6] || '').trim(),
      note: String(row[7] || '').trim(),
      updatedBy: String(row[8] || '').trim(),
      createdAt: String(row[9] || '').trim()
    };
  }).sort(function (a, b) {
    return String(b.createdAt || b.measuredDate).localeCompare(String(a.createdAt || a.measuredDate));
  });
}

function readAppointments_(studentIds) {
  const allowed = {};
  studentIds.forEach(function (id) { allowed[String(id)] = true; });
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(APPOINTMENT_SHEET);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 14).getDisplayValues();
  return rows.filter(function (row) {
    return allowed[String(row[1] || '').trim()];
  }).map(function (row) {
    return {
      appointmentId: String(row[0] || '').trim(), studentId: String(row[1] || '').trim(),
      childName: String(row[2] || '').trim(), room: String(row[3] || '').trim(),
      appointmentType: String(row[4] || '').trim(), appointmentDate: String(row[5] || '').trim(),
      appointmentTime: String(row[6] || '').trim(), location: String(row[7] || '').trim(),
      note: String(row[8] || '').trim(), status: String(row[9] || 'รอนัด').trim(),
      reminderDays: Number(row[10] || 7), updatedBy: String(row[11] || '').trim(),
      createdAt: String(row[12] || '').trim(), completedAt: String(row[13] || '').trim()
    };
  }).sort(function (a, b) {
    return String(a.appointmentDate || '').localeCompare(String(b.appointmentDate || ''));
  });
}

function getPhotos_(folderId) {
  const files = DriveApp.getFolderById(folderId).getFiles();
  const photos = [];
  while (files.hasNext()) {
    const file = files.next();
    if (String(file.getMimeType()).indexOf('image/') === 0) {
      photos.push({ id: file.getId(), title: normalizeName_(file.getName()) });
    }
  }
  return photos;
}

function findPhotoId_(photos, fullName) {
  const target = normalizeName_(fullName);
  if (!target) return '';
  const match = photos.find(function (photo) { return photo.title.indexOf(target) !== -1; });
  return match ? match.id : '';
}

function normalizeName_(value) {
  return String(value || '')
    .replace(/\.(jpg|jpeg|png|webp)$/i, '')
    .replace(/^\d+\./, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function normalizeParentUserId_(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

function normalizeTeacherUserId_(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

function hashCredential_(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ''),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (value) {
    const byte = value < 0 ? value + 256 : value;
    return ('0' + byte.toString(16)).slice(-2);
  }).join('');
}

function secureCompare_(left, right) {
  left = String(left || '');
  right = String(right || '');
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function loginAttemptKey_(role, userId) {
  return 'login-fail-' + role + '-' + hashCredential_(userId).slice(0, 24);
}

function isLoginBlocked_(role, userId) {
  return Number(CacheService.getScriptCache().get(loginAttemptKey_(role, userId)) || 0) >= 5;
}

function recordLoginFailure_(role, userId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    const cache = CacheService.getScriptCache();
    const key = loginAttemptKey_(role, userId);
    cache.put(key, String(Number(cache.get(key) || 0) + 1), 900);
  } finally {
    lock.releaseLock();
  }
}

function clearLoginFailures_(role, userId) {
  CacheService.getScriptCache().remove(loginAttemptKey_(role, userId));
}

function thumbnailUrl_(fileId) {
  return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w400';
}

function sanitizeCallback_(value) {
  const callback = String(value || 'kinderySheetCallback');
  return /^[A-Za-z_$][0-9A-Za-z_$\.]*$/.test(callback)
    ? callback
    : 'kinderySheetCallback';
}

function jsonp_(callback, payload) {
  return ContentService
    .createTextOutput(callback + '(' + JSON.stringify(payload) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function postMessageResponse_(requestId, payload) {
  const message = JSON.stringify({
    kinderyApi: true,
    requestId: String(requestId || ''),
    payload: payload
  }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return HtmlService
    .createHtmlOutput('<!doctype html><meta charset="utf-8"><script>window.parent.postMessage(' + message + ',"*");<\/script>')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * ผู้ดูแลกรอกรหัสผ่านใหม่ชั่วคราวในคอลัมน์ NewPassword แล้วเรียกฟังก์ชันนี้
 * ระบบจะเก็บเฉพาะค่า SHA-256 และล้างรหัสผ่านตัวจริงออกทันที
 */
function applyPendingPasswordChanges() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const configs = [
    { sheetName: PARENT_ACCOUNT_SHEET, temporaryPasswordColumn: 8 },
    { sheetName: TEACHER_ACCOUNT_SHEET, temporaryPasswordColumn: 9 }
  ];
  let changed = 0;
  configs.forEach(function (config) {
    const sheet = spreadsheet.getSheetByName(config.sheetName);
    if (!sheet) throw new Error('ไม่พบแท็บ ' + config.sheetName);
    sheet.getRange(1, config.temporaryPasswordColumn).setValue('NewPassword');
    if (sheet.getLastRow() < 2) return;
    const count = sheet.getLastRow() - 1;
    const pending = sheet.getRange(2, config.temporaryPasswordColumn, count, 1).getDisplayValues();
    const hashes = sheet.getRange(2, 2, count, 1).getValues();
    pending.forEach(function (row, index) {
      const password = String(row[0] || '').trim();
      if (!password) return;
      if (password.length < 6 || password.length > 64) throw new Error(config.sheetName + ' แถว ' + (index + 2) + ': รหัสผ่านต้องมี 6–64 ตัวอักษร');
      hashes[index][0] = hashCredential_(password);
      changed += 1;
    });
    sheet.getRange(2, 2, count, 1).setValues(hashes);
    sheet.getRange(2, config.temporaryPasswordColumn, count, 1).clearContent();
  });
  return 'อัปเดตรหัสผ่าน ' + changed + ' บัญชี';
}

/** เรียกครั้งแรกหลังวางโค้ด เพื่อขอสิทธิ์และเตรียมคอลัมน์เปลี่ยนรหัสผ่าน */
function prepareProduction() {
  authorizeServices();
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const parentSheet = spreadsheet.getSheetByName(PARENT_ACCOUNT_SHEET);
  const teacherSheet = spreadsheet.getSheetByName(TEACHER_ACCOUNT_SHEET);
  if (!parentSheet || !teacherSheet) throw new Error('ต้องมีแท็บ ParentAccounts และ TeacherAccounts ก่อน');
  parentSheet.getRange('H1').setValue('NewPassword');
  teacherSheet.getRange('I1').setValue('NewPassword');
  CacheService.getScriptCache().remove('kindery-directory-v3');
  return 'พร้อมใช้งานจริง';
}

/** เรียกใช้ครั้งแรกจากหน้า Editor เพื่ออนุญาตสิทธิ์ Google Sheets และ Drive */
function authorizeServices() {
  SpreadsheetApp.openById(SPREADSHEET_ID).getName();
  STUDENT_SHEETS.forEach(function (source) {
    DriveApp.getFolderById(source.folderId).getName();
  });
  DriveApp.getFolderById(TEACHER_FOLDER_ID).getName();
}

