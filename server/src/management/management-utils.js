import { isValidEmail } from '../donors/donor-utils.js';

const userStatuses = ['pending', 'active', 'disabled'];
const staffStatuses = ['active', 'inactive'];
class ManagementValidationError extends Error {}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parsePage(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return parsed >= 1 && parsed <= maximum ? parsed : null;
}

function rejectUnknownFields(body, allowedFields, label) {
  const unknownFields = Object.keys(body).filter((field) => !allowedFields.has(field));
  if (unknownFields.length) {
    throw new ManagementValidationError(`${label} contains unsupported field(s): ${unknownFields.join(', ')}.`);
  }
}

function requiredText(value, field, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) {
    throw new ManagementValidationError(`${field} is required and must be 1 to ${maximum} characters.`);
  }
  return value.trim();
}

function optionalText(value, field, maximum) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > maximum) {
    throw new ManagementValidationError(`${field} must be ${maximum} characters or fewer.`);
  }
  return value.trim() || null;
}

function normalizedCode(value, field, maximum) {
  return requiredText(value, field, maximum).toUpperCase();
}

function validatePhone(value) {
  const phone = optionalText(value, 'phoneE164', 16);
  if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) {
    throw new ManagementValidationError('phoneE164 must use international E.164 format.');
  }
  return phone;
}

function validateStaffCreate(body) {
  const allowedFields = new Set([
    'userId',
    'displayName',
    'email',
    'phoneE164',
    'hospitalId',
    'employeeNumber',
    'jobTitle',
    'staffStatus',
    'accountStatus',
  ]);
  rejectUnknownFields(body, allowedFields, 'Staff record');

  if (body.userId !== undefined && !isUuid(body.userId)) {
    throw new ManagementValidationError('userId must be a valid UUID.');
  }
  if (!isUuid(body.hospitalId)) {
    throw new ManagementValidationError('hospitalId must be a valid UUID.');
  }

  const staffStatus = body.staffStatus ?? 'active';
  const accountStatus = body.accountStatus ?? (body.userId === undefined ? 'pending' : undefined);
  if (!staffStatuses.includes(staffStatus)) {
    throw new ManagementValidationError(`staffStatus must be one of: ${staffStatuses.join(', ')}.`);
  }
  if (accountStatus !== undefined && !userStatuses.includes(accountStatus)) {
    throw new ManagementValidationError(`accountStatus must be one of: ${userStatuses.join(', ')}.`);
  }
  if (staffStatus === 'inactive' && accountStatus === 'active') {
    throw new ManagementValidationError('An inactive staff profile cannot have an active user account.');
  }

  const contact = {};
  if (body.userId === undefined) {
    contact.displayName = requiredText(body.displayName, 'displayName', 120);
    if (!isValidEmail(body.email)) {
      throw new ManagementValidationError('email must be a valid email address of up to 254 characters.');
    }
    contact.email = body.email.trim().toLowerCase();
    contact.phoneE164 = validatePhone(body.phoneE164) ?? null;
  } else if (['displayName', 'email', 'phoneE164'].some((field) => body[field] !== undefined)) {
    throw new ManagementValidationError('Contact details cannot be changed while linking an existing account.');
  }

  return {
    userId: body.userId,
    contact,
    hospitalId: body.hospitalId,
    employeeNumber: normalizedCode(body.employeeNumber, 'employeeNumber', 40),
    jobTitle: optionalText(body.jobTitle, 'jobTitle', 100) ?? null,
    staffStatus,
    accountStatus,
  };
}

function validateStaffUpdate(body) {
  const allowedFields = new Set([
    'displayName',
    'email',
    'phoneE164',
    'hospitalId',
    'employeeNumber',
    'jobTitle',
    'staffStatus',
    'accountStatus',
  ]);
  rejectUnknownFields(body, allowedFields, 'Staff update');
  if (!Object.keys(body).length) throw new ManagementValidationError('Provide at least one staff field to update.');

  const data = {};
  const user = {};
  if (body.displayName !== undefined) user.displayName = requiredText(body.displayName, 'displayName', 120);
  if (body.email !== undefined) {
    if (!isValidEmail(body.email)) throw new ManagementValidationError('email must be a valid email address.');
    user.email = body.email.trim().toLowerCase();
  }
  if (body.phoneE164 !== undefined) user.phoneE164 = validatePhone(body.phoneE164);
  if (body.hospitalId !== undefined) {
    if (!isUuid(body.hospitalId)) throw new ManagementValidationError('hospitalId must be a valid UUID.');
    data.hospitalId = body.hospitalId;
  }
  if (body.employeeNumber !== undefined) {
    data.employeeNumber = normalizedCode(body.employeeNumber, 'employeeNumber', 40);
  }
  if (body.jobTitle !== undefined) data.jobTitle = optionalText(body.jobTitle, 'jobTitle', 100);
  if (body.staffStatus !== undefined) {
    if (!staffStatuses.includes(body.staffStatus)) {
      throw new ManagementValidationError(`staffStatus must be one of: ${staffStatuses.join(', ')}.`);
    }
    data.staffStatus = body.staffStatus;
  }
  if (body.accountStatus !== undefined) {
    if (!userStatuses.includes(body.accountStatus)) {
      throw new ManagementValidationError(`accountStatus must be one of: ${userStatuses.join(', ')}.`);
    }
    data.accountStatus = body.accountStatus;
  }
  if (data.staffStatus === 'inactive' && data.accountStatus === 'active') {
    throw new ManagementValidationError('An inactive staff profile cannot have an active user account.');
  }
  return { data, user };
}

function validateHospital(body, { creating = false } = {}) {
  const fields = new Set([
    'name',
    'registrationNumber',
    'phone',
    'email',
    'addressLine1',
    'addressLine2',
    'city',
    'region',
    'postalCode',
    'countryCode',
    'isActive',
  ]);
  rejectUnknownFields(body, fields, 'Hospital record');
  if (creating && (typeof body.name !== 'string' || !body.name.trim())) {
    throw new ManagementValidationError('name is required.');
  }
  if (!Object.keys(body).length) throw new ManagementValidationError('Provide at least one hospital field to update.');

  const data = {};
  if (body.name !== undefined) data.name = requiredText(body.name, 'name', 160);
  if (body.registrationNumber !== undefined) {
    data.registrationNumber = body.registrationNumber === null || body.registrationNumber === ''
      ? null
      : normalizedCode(body.registrationNumber, 'registrationNumber', 80);
  }
  for (const [field, maximum] of [
    ['phone', 32],
    ['addressLine1', 160],
    ['addressLine2', 160],
    ['city', 100],
    ['region', 100],
    ['postalCode', 20],
  ]) {
    if (body[field] !== undefined) data[field] = optionalText(body[field], field, maximum);
  }
  if (body.email !== undefined) {
    if (body.email === null || body.email === '') data.email = null;
    else if (!isValidEmail(body.email)) throw new ManagementValidationError('email must be a valid email address.');
    else data.email = body.email.trim().toLowerCase();
  }
  if (body.countryCode !== undefined) {
    if (body.countryCode === null || body.countryCode === '') data.countryCode = null;
    else if (typeof body.countryCode !== 'string' || !/^[A-Za-z]{2}$/.test(body.countryCode.trim())) {
      throw new ManagementValidationError('countryCode must be a two-letter code.');
    } else data.countryCode = body.countryCode.trim().toUpperCase();
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') throw new ManagementValidationError('isActive must be true or false.');
    data.isActive = body.isActive;
  }
  return data;
}

const auditMetadataValues = {
  accessScope: new Set(['audit_log_collection', 'donor_profile', 'donation_history', 'laboratory_test']),
  changeCategory: new Set([
    'account',
    'permission',
    'donor_profile',
    'donor_screening_metadata',
    'laboratory_result',
    'inventory_status',
    'inventory_location',
    'allocation',
    'dispatch',
    'request_status',
  ]),
  fromStatus: /^[a-z_]{1,24}$/,
  toStatus: /^[a-z_]{1,24}$/,
  roleCode: new Set(['ADMIN', 'STAFF', 'DONOR', 'HOSPITAL']),
  source: new Set(['public_registration', 'staff_management', 'hospital_membership']),
};

function safeAuditMetadata(metadata = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(metadata)) {
    const rule = auditMetadataValues[key];
    if (
      rule
      && typeof value === 'string'
      && (rule instanceof Set ? rule.has(value) : rule.test(value))
    ) {
      safe[key] = value;
    }
  }
  return safe;
}

async function writeAudit(transaction, request, {
  action,
  entityType,
  entityId,
  changedFields = [],
  metadata = {},
}) {
  if (
    typeof action !== 'string'
    || action.length === 0
    || action.length > 40
    || typeof entityType !== 'string'
    || entityType.length === 0
    || entityType.length > 50
    || !Array.isArray(changedFields)
    || changedFields.some((field) => (
      typeof field !== 'string'
      || /password|token|secret|resultCode|resultBloodType/i.test(field)
    ))
  ) {
    throw new Error('Audit event action, entity type, or non-sensitive changed fields are invalid.');
  }
  await transaction.auditLog.create({
    data: {
      actorUserId: request.auth?.user?.id || null,
      action,
      entityType,
      entityId,
      changedFields,
      metadata: safeAuditMetadata(metadata),
    },
  });
}

async function writeAuditAccess(prisma, request, details) {
  return writeAudit(prisma, request, details);
}

function sendValidationError(response, error) {
  return response.status(400).json({
    error: { code: 'INVALID_MANAGEMENT_DATA', message: error.message },
  });
}

export {
  ManagementValidationError,
  isUuid,
  parsePage,
  safeAuditMetadata,
  sendValidationError,
  staffStatuses,
  userStatuses,
  validateHospital,
  validateStaffCreate,
  validateStaffUpdate,
  writeAudit,
  writeAuditAccess,
};
