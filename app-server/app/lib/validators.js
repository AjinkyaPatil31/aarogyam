import { z } from 'zod';

// Registration schema
export const registerSchema = z.object({
  email: z.string().email("Invalid email/user ID format"),
  password: z.string().min(8, "Password must be at least 8 characters long"),
  role: z.enum(['DOCTOR', 'COMPOUNDER', 'PATIENT'], {
    errorMap: () => ({ message: "Invalid role. Must be DOCTOR, COMPOUNDER, or PATIENT" })
  })});

// Login schema
export const loginSchema = z.object({
  email: z.string().min(1, "Email/user ID is required"),
  password: z.string().min(1, "Password is required")});

// Patient creation schema
export const createPatientSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  fullName: z.string().min(1, "Full name is required"),
  contact: z.string().regex(/^\d{10}$/, "Contact number must be exactly 10 digits"),
  medicalHistory: z.string().optional(),
  gender: z.string().optional(),
  dob: z.string().optional()});

// Patient update schema
export const updatePatientSchema = z.object({
  patientId: z.string().min(1, "patientId is required"),
  fullName: z.string().optional(),
  contact: z.string().regex(/^\d{10}$/, "Contact number must be exactly 10 digits").optional().or(z.literal('')),
  medicalHistory: z.string().optional(),
  gender: z.string().optional(),
  dateOfBirth: z.string().optional()});

// Appointment booking schema
export const bookAppointmentSchema = z.object({
  patientId: z.string().min(1, "patientId is required"),
  doctorId: z.string().min(1, "doctorId is required"),
  appointmentDate: z.string().min(1, "appointmentDate is required"),
  timeSlot: z.string().min(1, "timeSlot is required")});

// Consultation creation schema
export const createConsultationSchema = z.object({
  patientId: z.string().min(1, "patientId is required"),
  doctorId: z.string().min(1, "doctorId is required"),
  symptoms: z.string().min(1, "Symptoms are required"),
  diagnosis: z.string().min(1, "Diagnosis is required"),
  bloodPressure: z.string().optional(),
  heartRate: z.number().optional(),
  temperature: z.number().optional(),
  spo2: z.number().optional(),
  weight: z.number().optional(),
  respiratoryRate: z.number().optional(),
  rsExam: z.string().optional(),
  cvsExam: z.string().optional(),
  cnsExam: z.string().optional(),
  paExam: z.string().optional(),
  allergy: z.boolean().optional(),
  allergyNote: z.string().optional(),
  edema: z.boolean().optional(),
  edemaNote: z.string().optional(),
  clubbing: z.boolean().optional(),
  icterus: z.boolean().optional(),
  pallor: z.boolean().optional(),
  historyDM: z.boolean().optional(),
  historyHTN: z.boolean().optional(),
  historyIHD: z.boolean().optional(),
  historyCVA: z.boolean().optional(),
  historyCKD: z.boolean().optional(),
  historyHypothyroid: z.boolean().optional(),
  historyCOPD: z.boolean().optional(),
  prescriptions: z.array(z.object({
    // Only the medication name is mandatory; dosage, frequency and
    // duration are optional so a prescription can be issued without them.
    medicationName: z.string().min(1, "Medication name required"),
    dosage: z.string().optional(),
    frequency: z.string().optional(),
    duration: z.string().optional(),
    instructions: z.string().optional()
  })).optional()});

// WhatsApp share schema
export const whatsappShareSchema = z.object({
  phone: z.string().min(10, "Valid phone number required"),
  message: z.string().min(1, "Message is required")});

/**
 * Validates data against a Zod schema.
 * Returns { data, errorResponse }
 */
export function validateRequest(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const errorMessages = result.error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(', ');
    return { errorResponse: Response.json({ error: 'Validation failed', details: errorMessages }, { status: 400 }) };
  }
  return { data: result.data };
}
