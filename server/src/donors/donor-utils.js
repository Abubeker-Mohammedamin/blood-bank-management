import { randomUUID } from 'node:crypto';

const donorStatuses = ['registered', 'active', 'deferred', 'inactive'];
const registrationFields = new Set(['displayName', 'email', 'phoneE164', 'dateOfBirth']);
const profileFields = new Set(['displayName', 'email', 'phoneE164', 'dateOfBirth']);
const screeningFields = new Set([
  'donorStatus',
  'eligibilityReviewedAt',
  'consentGivenAt',
  'consentVersion',
]);

class DonorValidationError extends Error {}

function createDonorNumber() {
  return `DON-${randomUUID().replaceAll('-', '').toUpperCase()}`;
}

function isValidEmail(email) {
  return typeof email === 'string'
    && email.trim().length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function parseDateOnly(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new DonorValidationError(`${fieldName} must be a date in YYYY-MM-DD format.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new DonorValidationError(`${fieldName} must be a valid calendar date.`);
  }
  return date;
}

function parseDateTime(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new DonorValidationError(`${fieldName} must be a valid date and time.`);
  }
  return new Date(value);
}

function validatePhone(value) {
  if (value === undefined || value === null || value === '') return null;
  if (
    typeof value !== 'string'
    || !/^\+[1-9]\d{6,14}$/.test(value.trim())
  ) {
    throw new DonorValidationError('phoneE164 must use international E.164 format, for example +15551234567.');
  }
  return value.trim();
}

function rejectUnknownFields(body, allowedFields, label) {
  const unknownFields = Object.keys(body).filter((field) => !allowedFields.has(field));
  if (unknownFields.length) {
    throw new DonorValidationError(`${label} contains unsupported field(s): ${unknownFields.join(', ')}.`);
  }
}

function validateRegistration(body) {
  rejectUnknownFields(body, registrationFields, 'Registration');
  if (typeof body.displayName !== 'string' || !body.displayName.trim() || body.displayName.trim().length > 120) {
    throw new DonorValidationError('displayName is required and must be 1 to 120 characters.');
  }
  if (!isValidEmail(body.email)) {
    throw new DonorValidationError('email must be a valid email address of up to 254 characters.');
  }

  return {
    displayName: body.displayName.trim(),
    email: body.email.trim().toLowerCase(),
    phoneE164: validatePhone(body.phoneE164),
    dateOfBirth: parseDateOnly(body.dateOfBirth, 'dateOfBirth'),
  };
}

function validateProfileUpdate(body, canUpdateScreening, { allowEmpty = false } = {}) {
  const allowedFields = canUpdateScreening
    ? new Set([...profileFields, ...screeningFields])
    : profileFields;
  rejectUnknownFields(body, allowedFields, 'Profile');
  const data = {};

  if (Object.hasOwn(body, 'displayName')) {
    if (typeof body.displayName !== 'string' || !body.displayName.trim() || body.displayName.trim().length > 120) {
      throw new DonorValidationError('displayName must be 1 to 120 characters.');
    }
    data.displayName = body.displayName.trim();
  }
  if (Object.hasOwn(body, 'email')) {
    if (!isValidEmail(body.email)) throw new DonorValidationError('email must be a valid email address.');
    data.email = body.email.trim().toLowerCase();
  }
  if (Object.hasOwn(body, 'phoneE164')) data.phoneE164 = validatePhone(body.phoneE164);
  if (Object.hasOwn(body, 'dateOfBirth')) data.dateOfBirth = parseDateOnly(body.dateOfBirth, 'dateOfBirth');

  if (Object.hasOwn(body, 'donorStatus')) {
    if (!donorStatuses.includes(body.donorStatus)) {
      throw new DonorValidationError(`donorStatus must be one of: ${donorStatuses.join(', ')}.`);
    }
    data.donorStatus = body.donorStatus;
  }
  if (Object.hasOwn(body, 'eligibilityReviewedAt')) {
    data.eligibilityReviewedAt = parseDateTime(body.eligibilityReviewedAt, 'eligibilityReviewedAt');
  }
  if (Object.hasOwn(body, 'consentGivenAt')) {
    data.consentGivenAt = parseDateTime(body.consentGivenAt, 'consentGivenAt');
  }
  if (Object.hasOwn(body, 'consentVersion')) {
    if (
      body.consentVersion !== null
      && (typeof body.consentVersion !== 'string' || body.consentVersion.trim().length > 40)
    ) {
      throw new DonorValidationError('consentVersion must be 40 characters or fewer.');
    }
    data.consentVersion = body.consentVersion?.trim() || null;
  }

  if (!Object.keys(data).length && !allowEmpty) {
    throw new DonorValidationError('Provide at least one profile field to update.');
  }
  return data;
}

function publicDonor(donor, { includeRestricted = false } = {}) {
  const result = {
    id: donor.id,
    donorNumber: donor.donorNumber,
    dateOfBirth: donor.dateOfBirth,
    createdAt: donor.createdAt,
    updatedAt: donor.updatedAt,
    user: donor.user,
    donationCount: donor._count?.donations,
    latestDonation: donor.donations?.[0] || null,
  };

  if (includeRestricted) {
    result.donorStatus = donor.donorStatus;
    result.eligibilityReviewedAt = donor.eligibilityReviewedAt;
    result.consentGivenAt = donor.consentGivenAt;
    result.consentVersion = donor.consentVersion;
  }
  return result;
}

export {
  createDonorNumber,
  DonorValidationError,
  donorStatuses,
  isValidEmail,
  parseDateOnly,
  publicDonor,
  validateProfileUpdate,
  validateRegistration,
};
