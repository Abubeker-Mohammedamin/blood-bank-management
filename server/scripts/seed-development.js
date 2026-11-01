import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const delegates = [
  'user',
  'role',
  'userRole',
  'hospitalUser',
  'hospital',
  'staff',
  'donor',
  'bloodType',
  'appointment',
  'donation',
  'laboratoryTest',
  'donationBloodType',
  'storageLocation',
  'bloodUnit',
  'bloodRequest',
  'allocation',
  'bloodUnitMovement',
  'notification',
  'auditLog',
];

const now = new Date();
const hoursAgo = (hours) => new Date(now.getTime() - hours * 60 * 60 * 1000);
const hoursFromNow = (hours) => new Date(now.getTime() + hours * 60 * 60 * 1000);

try {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed when NODE_ENV is production.');
  }

  const database = await prisma.$queryRaw`
    SELECT current_database() AS name, inet_server_addr()::text AS address, inet_server_port() AS port
  `;
  const serverAddress = database[0].address?.split('/')[0];
  if (
    database[0].name !== 'blood_bank'
    || !['127.0.0.1', '::1'].includes(serverAddress)
    || database[0].port !== 5432
  ) {
    throw new Error('Refusing to seed: expected local development database blood_bank on localhost:5432.');
  }

  await prisma.$transaction(async (transaction) => {
    const counts = await Promise.all(
      delegates.map((delegate) => transaction[delegate].count()),
    );
    const populatedTables = delegates.filter((_, index) => counts[index] > 0);

    if (populatedTables.length > 0) {
      throw new Error(
        `Refusing to seed a non-empty database. Existing records found in: ${populatedTables.join(', ')}. No records were changed.`,
      );
    }

    const donorUser = await transaction.user.create({
      data: {
        email: 'alex.donor@example.test',
        displayName: 'Alex Example',
        accountStatus: 'active',
      },
    });
    const staffUser = await transaction.user.create({
      data: {
        email: 'sam.staff@example.test',
        displayName: 'Sam Example',
        accountStatus: 'active',
      },
    });

    const donorRole = await transaction.role.create({
      data: { code: 'DONOR', name: 'Donor', description: 'Synthetic development role.' },
    });
    const staffRole = await transaction.role.create({
      data: { code: 'STAFF', name: 'Staff', description: 'Synthetic development role.' },
    });
    await transaction.role.create({
      data: {
        code: 'HOSPITAL',
        name: 'Hospital user',
        description: 'Synthetic development role; assign only through trusted provisioning.',
      },
    });

    const hospital = await transaction.hospital.create({
      data: {
        name: 'Example Community Hospital',
        registrationNumber: 'DEV-HOSPITAL-001',
        city: 'Example City',
        countryCode: 'US',
      },
    });

    const staff = await transaction.staff.create({
      data: {
        userId: staffUser.id,
        hospitalId: hospital.id,
        employeeNumber: 'DEV-EMP-001',
        jobTitle: 'Collection Coordinator',
      },
    });
    const donor = await transaction.donor.create({
      data: {
        userId: donorUser.id,
        donorNumber: 'DEV-DONOR-001',
        dateOfBirth: new Date('1990-01-15T00:00:00.000Z'),
        donorStatus: 'active',
        eligibilityReviewedAt: hoursAgo(48),
        consentGivenAt: hoursAgo(48),
        consentVersion: 'development-example-v1',
      },
    });

    await transaction.userRole.createMany({
      data: [
        { userId: donorUser.id, roleId: donorRole.id, assignedByUserId: staffUser.id },
        { userId: staffUser.id, roleId: staffRole.id, assignedByUserId: staffUser.id },
      ],
    });

    const bloodType = await transaction.bloodType.create({
      data: { code: 'A_POS', aboGroup: 'A', rhFactor: '+' },
    });
    const appointment = await transaction.appointment.create({
      data: {
        donorId: donor.id,
        hospitalId: hospital.id,
        createdByUserId: staffUser.id,
        scheduledStartAt: hoursAgo(36),
        scheduledEndAt: hoursAgo(35),
        appointmentStatus: 'completed',
      },
    });
    const donation = await transaction.donation.create({
      data: {
        donationNumber: 'DEV-DONATION-001',
        donorId: donor.id,
        hospitalId: hospital.id,
        collectedByStaffId: staff.id,
        appointmentId: appointment.id,
        donationStatus: 'released',
        collectionStartedAt: hoursAgo(36),
        collectedAt: hoursAgo(35),
        volumeMl: 450,
      },
    });
    const test = await transaction.laboratoryTest.create({
      data: {
        donationId: donation.id,
        testType: 'ABO_RH',
        attemptNo: 1,
        performedByStaffId: staff.id,
        testStatus: 'completed',
        resultCode: 'A_POS',
        resultBloodTypeId: bloodType.id,
        sampleCollectedAt: hoursAgo(35),
        completedAt: hoursAgo(30),
      },
    });
    await transaction.donationBloodType.create({
      data: {
        donationId: donation.id,
        bloodTypeId: bloodType.id,
        verifiedByTestId: test.id,
        verifiedAt: hoursAgo(30),
      },
    });

    const storageLocation = await transaction.storageLocation.create({
      data: {
        hospitalId: hospital.id,
        code: 'DEV-FRIDGE-001',
        name: 'Development Refrigerator',
        locationType: 'refrigerator',
        minTemperatureC: '2.0',
        maxTemperatureC: '6.0',
      },
    });
    const bloodUnit = await transaction.bloodUnit.create({
      data: {
        donationId: donation.id,
        unitCode: 'DEV-UNIT-001',
        componentType: 'red_cells',
        unitStatus: 'issued',
        collectedAt: hoursAgo(35),
        expiresAt: hoursFromNow(24 * 30),
      },
    });

    const bloodRequest = await transaction.bloodRequest.create({
      data: {
        requestNumber: 'DEV-REQUEST-001',
        hospitalId: hospital.id,
        requestedByUserId: staffUser.id,
        bloodTypeId: bloodType.id,
        componentType: 'red_cells',
        quantityRequested: 1,
        priority: 'routine',
        requestStatus: 'fulfilled',
        requestedAt: hoursAgo(24),
        neededBy: hoursFromNow(24),
        closedAt: hoursAgo(12),
      },
    });
    await transaction.allocation.create({
      data: {
        bloodRequestId: bloodRequest.id,
        bloodUnitId: bloodUnit.id,
        allocatedByUserId: staffUser.id,
        allocationStatus: 'fulfilled',
        allocatedAt: hoursAgo(18),
        fulfilledAt: hoursAgo(12),
      },
    });
    await transaction.bloodUnitMovement.create({
      data: {
        bloodUnitId: bloodUnit.id,
        toStorageLocationId: storageLocation.id,
        movedByStaffId: staff.id,
        movedAt: hoursAgo(30),
        reasonCode: 'COLLECTED',
      },
    });
    await transaction.bloodUnitMovement.create({
      data: {
        bloodUnitId: bloodUnit.id,
        fromStorageLocationId: storageLocation.id,
        movedByStaffId: staff.id,
        movedAt: hoursAgo(12),
        reasonCode: 'ISSUED',
      },
    });
    await transaction.notification.create({
      data: {
        userId: donorUser.id,
        notificationType: 'DONATION_RECORDED',
        channel: 'in_app',
        deliveryStatus: 'sent',
        sentAt: hoursAgo(30),
      },
    });
    await transaction.auditLog.create({
      data: {
        actorUserId: staffUser.id,
        action: 'development_seed',
        entityType: 'donation',
        entityId: donation.id,
        changedFields: ['donation_status'],
        metadata: { source: 'synthetic_development_seed' },
      },
    });

    const relationCheck = await transaction.$queryRaw`
      SELECT count(*)::int AS linked_donations
      FROM donations d
      JOIN donors donor ON donor.id = d.donor_id
      JOIN hospitals hospital ON hospital.id = d.hospital_id
      JOIN donation_blood_types confirmed ON confirmed.donation_id = d.id
      JOIN laboratory_tests test
        ON test.id = confirmed.verified_by_test_id
       AND test.donation_id = confirmed.donation_id
       AND test.result_blood_type_id = confirmed.blood_type_id
      JOIN blood_units unit ON unit.donation_id = d.id
      JOIN allocations allocation ON allocation.blood_unit_id = unit.id
      JOIN blood_requests request ON request.id = allocation.blood_request_id
      WHERE d.id = ${donation.id}
        AND unit.id = ${bloodUnit.id}
        AND donor.id = ${donor.id}
    `;

    if (relationCheck[0].linked_donations !== 1) {
      throw new Error('Seed relationship verification failed.');
    }

    return true;
  });

  console.log('Inserted synthetic development records and verified donor, donation, test, unit, request, and allocation relationships.');
} catch (error) {
  console.error('Development seed failed:', error.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
