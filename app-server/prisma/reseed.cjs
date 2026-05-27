const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  await prisma.prescription.deleteMany({});
  await prisma.medicalRecord.deleteMany({});
  await prisma.appointment.deleteMany({});
  await prisma.patientProfile.deleteMany({});
  await prisma.user.deleteMany({});
  console.log('Database cleared');

  const doctorHash = await bcrypt.hash('Doctor@123', 10);
  await prisma.user.create({
    data: { email: 'Vinod Patil', passwordHash: doctorHash, role: 'DOCTOR' },
  });

  const compounderHash = await bcrypt.hash('Compounder@123', 10);
  await prisma.user.create({
    data: { email: 'compounder@aarogyam.com', passwordHash: compounderHash, role: 'COMPOUNDER' },
  });

  const patientHash = await bcrypt.hash('Patient@123', 10);
  const patient = await prisma.user.create({
    data: { email: 'patient@aarogyam.com', passwordHash: patientHash, role: 'PATIENT' },
  });

  await prisma.patientProfile.create({
    data: {
      fullName: 'Test Patient',
      dateOfBirth: '1990-01-01',
      gender: 'Male',
      contact: '9999999999',
      medicalHistory: 'No known allergies',
      profileComplete: true,
      userId: patient.id,
    },
  });

  console.log('Seeded: doctor, compounder, patient');
  console.log('Doctor:     Vinod Patil     / Doctor@123');
  console.log('Compounder: compounder@aarogyam.com / Compounder@123');
  console.log('Patient:    patient@aarogyam.com    / Patient@123');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
