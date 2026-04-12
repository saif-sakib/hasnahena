import { z } from 'zod';

export const bdPhoneRegex = /^01\d{9}$/;
export const bdNidRegex = /^(?:\d{10}|\d{13}|\d{17})$/;

const normalizeOptionalNumber = (value: unknown) => {
  if (value === '' || value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'number' && Number.isNaN(value)) {
    return undefined;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  return value;
};

const registrationBaseObject = z
  .object({
    // Personal Information
    nameEn: z.string().trim().min(3, 'Name must be at least 3 characters').max(80, 'Name must be at most 80 characters'),
    nameBn: z.string().trim().max(80, 'Name must be at most 80 characters').optional().or(z.literal('')),
    fatherName: z.string().trim().min(3, 'Father name is required').max(80, 'Father name must be at most 80 characters'),
    motherName: z.string().trim().min(3, 'Mother name is required').max(80, 'Mother name must be at most 80 characters'),
    phone: z.string().trim().regex(bdPhoneRegex, 'Enter a valid 11-digit Bangladeshi mobile number'),
    email: z.string().trim().email('Enter a valid email address'),
    nidNumber: z.string().trim().regex(bdNidRegex, 'NID must be 10, 13, or 17 digits'),
    maritalStatus: z.enum(['UNMARRIED', 'MARRIED']),
    childrenCount: z.preprocess(
      normalizeOptionalNumber,
      z.number({ invalid_type_error: 'Children count must be a number' })
        .int('Children count must be a whole number')
        .min(0, 'Children count cannot be negative')
        .max(20, 'Children count seems too high')
        .optional(),
    ),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
    bloodGroup: z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']),
    profession: z.string().trim().min(2, 'Profession is required').max(80, 'Profession must be at most 80 characters'),
    dateOfBirth: z.string().trim().min(1, 'Date of birth is required'),

    // Permanent Address
    permanentHouseNo: z.string().trim().min(1, 'Permanent house no is required').max(50, 'House no must be at most 50 characters'),
    permanentRoadNo: z.string().trim().max(50, 'Road no must be at most 50 characters').optional(),
    permanentVillage: z.string().trim().min(1, 'Permanent village is required').max(80, 'Village must be at most 80 characters'),
    permanentUnion: z.string().trim().min(1, 'Permanent union is required').max(80, 'Union must be at most 80 characters'),
    permanentPoliceStation: z.string().trim().min(1, 'Permanent police station is required').max(80, 'Police station must be at most 80 characters'),
    permanentDistrict: z.string().trim().min(1, 'Permanent district is required').max(80, 'District must be at most 80 characters'),

    // Present Address
    sameAsPermanent: z.boolean().optional(),
    presentHouseNo: z.string().trim().max(50, 'House no must be at most 50 characters').optional(),
    presentRoadNo: z.string().trim().max(50, 'Road no must be at most 50 characters').optional(),
    presentVillage: z.string().trim().max(80, 'Village must be at most 80 characters').optional(),
    presentUnion: z.string().trim().max(80, 'Union must be at most 80 characters').optional(),
    presentPoliceStation: z.string().trim().max(80, 'Police station must be at most 80 characters').optional(),
    presentDistrict: z.string().trim().max(80, 'District must be at most 80 characters').optional(),

    // Nominee
    nomineeName: z.string().trim().min(3, 'Nominee name is required').max(80, 'Nominee name must be at most 80 characters'),
    nomineeRelationship: z.string().trim().min(2, 'Relationship is required').max(40, 'Relationship must be at most 40 characters'),
    nomineeNid: z.string().trim().regex(bdNidRegex, 'Nominee NID must be 10, 13, or 17 digits'),
    nomineePhone: z
      .string()
      .trim()
      .optional()
      .or(z.literal(''))
      .refine((value) => typeof value !== 'string' || value === '' || bdPhoneRegex.test(value), {
        message: 'Nominee phone must be a valid 11-digit Bangladeshi mobile number',
      }),
  })
  .strict();

const applySharedRegistrationRules = (
  data: z.infer<typeof registrationBaseObject>,
  ctx: z.RefinementCtx,
) => {
    const dob = data.dateOfBirth.trim();
    const birthDate = new Date(dob);
    if (Number.isNaN(birthDate.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dateOfBirth'],
        message: 'Date of birth is invalid',
      });
    } else {
      const today = new Date();
      if (birthDate > today) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['dateOfBirth'],
          message: 'Date of birth cannot be in the future',
        });
      } else {
        let age = today.getFullYear() - birthDate.getFullYear();
        const hasHadBirthday =
          today.getMonth() > birthDate.getMonth() ||
          (today.getMonth() === birthDate.getMonth() && today.getDate() >= birthDate.getDate());
        if (!hasHadBirthday) {
          age -= 1;
        }
        if (age < 18) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['dateOfBirth'],
            message: 'You must be at least 18 years old to register',
          });
        }
      }
    }

    if (data.maritalStatus === 'UNMARRIED' && (data.childrenCount ?? 0) > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['childrenCount'],
        message: 'Children count must be 0 for unmarried applicants',
      });
    }

    if (!data.sameAsPermanent) {
      const requiredPresentFields: Array<{ key: string; message: string }> = [
        { key: 'presentHouseNo', message: 'Present house no is required' },
        { key: 'presentVillage', message: 'Present village is required' },
        { key: 'presentUnion', message: 'Present union is required' },
        { key: 'presentPoliceStation', message: 'Present police station is required' },
        { key: 'presentDistrict', message: 'Present district is required' },
      ];

      for (const field of requiredPresentFields) {
        const value = (data as Record<string, unknown>)[field.key];
        if (typeof value !== 'string' || value.trim() === '') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field.key],
            message: field.message,
          });
        }
      }
    }
};

export const registerSchema = registrationBaseObject
  .extend({
    // Agreement is required for browser form submit
    agreeToTerms: z.literal(true, {
      errorMap: () => ({ message: 'You must agree to the terms' }),
    }),
  })
  .superRefine((data, ctx) => applySharedRegistrationRules(data, ctx));

export const registerApiSchema = registrationBaseObject
  .superRefine((data, ctx) => applySharedRegistrationRules(data, ctx));

export type RegisterFormData = z.infer<typeof registerSchema>;

const fieldLabels: Record<string, { en: string; bn: string }> = {
  nameEn: { en: 'Name (English)', bn: 'নাম (ইংরেজি)' },
  nameBn: { en: 'Name (Bengali)', bn: 'নাম (বাংলা)' },
  fatherName: { en: "Father's Name", bn: 'পিতার নাম' },
  motherName: { en: "Mother's Name", bn: 'মাতার নাম' },
  phone: { en: 'Mobile Number', bn: 'মোবাইল নম্বর' },
  email: { en: 'Email', bn: 'ই-মেইল' },
  nidNumber: { en: 'NID Number', bn: 'এন.আই.ডি নম্বর' },
  maritalStatus: { en: 'Marital Status', bn: 'বৈবাহিক অবস্থা' },
  childrenCount: { en: 'Number of Children', bn: 'সন্তানের সংখ্যা' },
  gender: { en: 'Gender', bn: 'লিঙ্গ' },
  bloodGroup: { en: 'Blood Group', bn: 'রক্তের গ্রুপ' },
  profession: { en: 'Profession', bn: 'পেশা' },
  dateOfBirth: { en: 'Date of Birth', bn: 'জন্ম তারিখ' },
  permanentHouseNo: { en: 'Permanent House No', bn: 'স্থায়ী বাড়ী নং' },
  permanentRoadNo: { en: 'Permanent Road No', bn: 'স্থায়ী রোড নং' },
  permanentVillage: { en: 'Permanent Village', bn: 'স্থায়ী গ্রাম' },
  permanentUnion: { en: 'Permanent Union', bn: 'স্থায়ী ইউনিয়ন' },
  permanentPoliceStation: { en: 'Permanent Police Station', bn: 'স্থায়ী থানা' },
  permanentDistrict: { en: 'Permanent District', bn: 'স্থায়ী জেলা' },
  presentHouseNo: { en: 'Present House No', bn: 'বর্তমান বাড়ী নং' },
  presentRoadNo: { en: 'Present Road No', bn: 'বর্তমান রোড নং' },
  presentVillage: { en: 'Present Village', bn: 'বর্তমান গ্রাম' },
  presentUnion: { en: 'Present Union', bn: 'বর্তমান ইউনিয়ন' },
  presentPoliceStation: { en: 'Present Police Station', bn: 'বর্তমান থানা' },
  presentDistrict: { en: 'Present District', bn: 'বর্তমান জেলা' },
  nomineeName: { en: 'Nominee Name', bn: 'নমিনীর নাম' },
  nomineeRelationship: { en: 'Nominee Relationship', bn: 'সম্পর্ক' },
  nomineeNid: { en: 'Nominee NID', bn: 'নমিনীর NID' },
  nomineePhone: { en: 'Nominee Phone', bn: 'নমিনীর মোবাইল' },
  agreeToTerms: { en: 'Agreement', bn: 'নিয়মাবলীতে সম্মতি' },
};

export function getRegistrationFieldLabel(field: string, locale: 'en' | 'bn'): string {
  return fieldLabels[field]?.[locale] || field;
}
