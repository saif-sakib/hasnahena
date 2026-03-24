'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ChevronLeft, ChevronRight, Check, User, MapPin, Users, FileText, Globe, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Logo } from '@/components/ui/logo';
import { toast } from '@/hooks/use-toast';

const steps = [
  { id: 'personal', icon: User },
  { id: 'address', icon: MapPin },
  { id: 'nominee', icon: Users },
  { id: 'documents', icon: FileText },
];

const registerSchema = z.object({
  // Personal Information
  nameEn: z.string().min(3, 'Name must be at least 3 characters'),
  nameBn: z.string().optional(),
  fatherName: z.string().min(3, 'Father name is required'),
  motherName: z.string().min(3, 'Mother name is required'),
  phone: z.string().min(11, 'Phone must be 11 digits').regex(/^01\d{9}$/, 'Invalid BD phone number'),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  nidNumber: z.string().min(10, 'NID must be 10 or 17 digits'),
  maritalStatus: z.enum(['UNMARRIED', 'MARRIED']),
  childrenCount: z.number().min(0).optional(),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
  dateOfBirth: z.string().optional(),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string(),
  
  // Permanent Address
  permanentHouseNo: z.string().min(1, 'House number is required'),
  permanentRoadNo: z.string().optional(),
  permanentVillage: z.string().min(1, 'Village is required'),
  permanentUnion: z.string().min(1, 'Union is required'),
  permanentPoliceStation: z.string().min(1, 'Police station is required'),
  permanentDistrict: z.string().min(1, 'District is required'),
  
  // Present Address
  sameAsPermanent: z.boolean().optional(),
  presentHouseNo: z.string().optional(),
  presentRoadNo: z.string().optional(),
  presentVillage: z.string().optional(),
  presentUnion: z.string().optional(),
  presentPoliceStation: z.string().optional(),
  presentDistrict: z.string().optional(),
  
  // Nominee
  nomineeName: z.string().min(3, 'Nominee name is required'),
  nomineeRelationship: z.string().min(1, 'Relationship is required'),
  nomineeNid: z.string().min(10, 'Nominee NID is required'),
  nomineePhone: z.string().optional(),
  
  // Agreement
  agreeToTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must agree to the terms' }),
  }),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
});

type RegisterFormData = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0);
  const [sameAsPermanent, setSameAsPermanent] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      maritalStatus: 'UNMARRIED',
      gender: 'MALE',
      childrenCount: 0,
    },
    mode: 'onBlur', // Validate on blur for better UX
  });

  // Fields to validate per step
  const stepFields: (keyof RegisterFormData)[][] = [
    // Step 0: Personal Info
    ['nameEn', 'fatherName', 'motherName', 'phone', 'nidNumber', 'gender', 'maritalStatus', 'password', 'confirmPassword'],
    // Step 1: Address
    ['permanentHouseNo', 'permanentVillage', 'permanentUnion', 'permanentPoliceStation', 'permanentDistrict'],
    // Step 2: Nominee
    ['nomineeName', 'nomineeRelationship', 'nomineeNid'],
    // Step 3: Documents & Agreement
    ['agreeToTerms'],
  ];

  const onSubmit = async (data: RegisterFormData) => {
    setSubmitError(null);

    try {
      const response = await fetch('/api/v1/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Personal Info
          nameEn: data.nameEn,
          nameBn: data.nameBn,
          fatherName: data.fatherName,
          motherName: data.motherName,
          phone: data.phone,
          email: data.email,
          nidNumber: data.nidNumber,
          maritalStatus: data.maritalStatus,
          childrenCount: data.childrenCount,
          gender: data.gender,
          dateOfBirth: data.dateOfBirth,
          password: data.password,

          // Permanent Address
          permanentHouseNo: data.permanentHouseNo,
          permanentRoadNo: data.permanentRoadNo,
          permanentVillage: data.permanentVillage,
          permanentUnion: data.permanentUnion,
          permanentPoliceStation: data.permanentPoliceStation,
          permanentDistrict: data.permanentDistrict,

          // Present Address
          sameAsPermanent: data.sameAsPermanent ?? false,
          presentHouseNo: data.presentHouseNo,
          presentRoadNo: data.presentRoadNo,
          presentVillage: data.presentVillage,
          presentUnion: data.presentUnion,
          presentPoliceStation: data.presentPoliceStation,
          presentDistrict: data.presentDistrict,

          // Nominee
          nomineeName: data.nomineeName,
          nomineeRelationship: data.nomineeRelationship,
          nomineeNid: data.nomineeNid,
          nomineePhone: data.nomineePhone,
        }),
      });

      const json = (await response.json().catch(() => ({}))) as {
        error?: string;
        details?: { fieldErrors?: Record<string, string[]> }
      };

      if (!response.ok) {
        // Show detailed validation errors if available
        if (json?.details?.fieldErrors) {
          const fieldErrors = json.details.fieldErrors;
          const errorMessages = Object.entries(fieldErrors)
            .map(([field, messages]) => `${field}: ${messages.join(', ')}`)
            .join('\n');
          setSubmitError(
            locale === 'bn'
              ? `ফর্মে ত্রুটি রয়েছে:\n${errorMessages}`
              : `Form has errors:\n${errorMessages}`
          );
        } else {
          setSubmitError(json?.error ?? (locale === 'bn' ? 'নিবন্ধন ব্যর্থ হয়েছে' : 'Registration failed'));
        }
        return;
      }

      // Show success toast
      toast({
        title: locale === 'bn' ? 'নিবন্ধন সফল!' : 'Registration Successful!',
        description: locale === 'bn'
          ? 'আপনার আবেদন জমা হয়েছে। অ্যাডমিনের অনুমোদনের জন্য অপেক্ষা করুন।'
          : 'Your application has been submitted. Please wait for admin approval.',
        variant: 'success',
      });

      // Redirect after a short delay so user can see the message
      setTimeout(() => {
        router.push(`/${locale}/login`);
      }, 2000);
    } catch {
      setSubmitError(
        locale === 'bn'
          ? 'নিবন্ধন ব্যর্থ হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।'
          : 'Registration failed. Please try again.'
      );
    }
  };

  const nextStep = async () => {
    // Validate current step fields before proceeding
    const fieldsToValidate = stepFields[currentStep];
    const isValid = await trigger(fieldsToValidate);

    if (isValid && currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else if (!isValid) {
      // Show toast about validation errors
      toast({
        title: locale === 'bn' ? 'অনুগ্রহ করে ত্রুটি সংশোধন করুন' : 'Please fix the errors',
        description: locale === 'bn'
          ? 'সব প্রয়োজনীয় ফিল্ড সঠিকভাবে পূরণ করুন।'
          : 'Please fill all required fields correctly.',
        variant: 'destructive',
      });
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const stepTitles = locale === 'bn' 
    ? ['ব্যক্তিগত তথ্য', 'ঠিকানা', 'নমিনী', 'নথি ও চুক্তি']
    : ['Personal Info', 'Address', 'Nominee', 'Documents'];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header with Navigation */}
      <header className="sticky top-0 z-50 border-b border-slate-100 bg-white/95 backdrop-blur-md">
        <div className="container-wide flex h-14 items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href={`/${locale}`}>
              <Logo size="sm" showTagline={false} />
            </Link>
            <Link
              href={`/${locale}`}
              className="hidden sm:flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← {locale === 'bn' ? 'হোম' : 'Home'}
            </Link>
          </div>
          <div className="flex items-center gap-4">
            <Link href={`/${locale === 'en' ? 'bn' : 'en'}/register`}>
              <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
                <Globe className="h-4 w-4" />
                <span className="text-sm">{locale === 'en' ? 'বাংলা' : 'English'}</span>
              </Button>
            </Link>
            <Link
              href={`/${locale}/login`}
              className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
            >
              {locale === 'bn' ? 'লগইন করুন' : 'Login'}
            </Link>
          </div>
        </div>
      </header>

      <main className="py-8 px-4">
        <div className="container-wide max-w-4xl">
          {/* Progress Steps */}
          <div className="mb-12 relative">
            <div className="absolute top-1/2 left-0 w-full h-1 bg-slate-200 dark:bg-slate-800 -translate-y-1/2 rounded-full z-0" />
            <div className="flex items-center justify-between relative z-10">
              {steps.map((step, index) => (
                <div key={step.id} className="flex flex-col items-center group">
                  <div
                    className={`h-14 w-14 rounded-2xl flex items-center justify-center border-4 transition-all duration-500 ${
                      index < currentStep
                        ? 'bg-emerald-600 border-emerald-600 text-white shadow-lg shadow-emerald-600/30 scale-100'
                        : index === currentStep
                        ? 'bg-white border-emerald-600 text-emerald-600 shadow-xl shadow-emerald-600/20 scale-110'
                        : 'bg-white border-slate-200 text-slate-400 dark:bg-slate-900 dark:border-slate-800'
                    }`}
                  >
                    {index < currentStep ? (
                      <Check className="h-6 w-6 animate-in zoom-in duration-300" />
                    ) : (
                      <step.icon className={`h-6 w-6 ${index === currentStep ? 'animate-bounce' : ''}`} />
                    )}
                  </div>
                  <span className={`text-sm mt-3 font-semibold transition-colors duration-300 ${
                    index <= currentStep ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-400 dark:text-slate-600'
                  }`}>
                    {stepTitles[index]}
                  </span>
                </div>
              ))}
            </div>
            
            <div 
              className="absolute top-1/2 left-0 h-1 bg-emerald-600 -translate-y-1/2 rounded-full z-0 transition-all duration-700 ease-in-out"
              style={{ width: `${(currentStep / (steps.length - 1)) * 100}%` }}
            />
          </div>

          <Card className="border-0 shadow-2xl shadow-emerald-900/10 dark:shadow-black/40 overflow-hidden bg-white/80 dark:bg-slate-900/80 backdrop-blur-md">
            <div className="h-2 w-full bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600" />
            <CardHeader className="pb-8 text-center border-b border-slate-100 dark:border-slate-800/50">
              <CardTitle className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-700 dark:from-white dark:to-slate-300">
                {locale === 'bn' ? 'হাসনাহেনায় নিবন্ধন' : 'Register for Hasnahena'}
              </CardTitle>
              <CardDescription className="text-lg mt-2 text-slate-500 dark:text-slate-400">
                {locale === 'bn'
                  ? 'সুদমুক্ত অর্থায়নে আপনার যাত্রা শুরু করুন'
                  : 'Start your journey to interest-free finance'}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-8 md:p-10">
              {submitError && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {submitError}
                </div>
              )}
              <form onSubmit={handleSubmit(onSubmit)}>
                {/* Step 1: Personal Information */}
                {currentStep === 0 && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold border-b border-slate-100 pb-3 text-slate-800">
                      {locale === 'bn' ? 'ব্যক্তিগত তথ্য' : 'Personal Information'}
                    </h3>
                    
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="nameEn" className="text-sm font-medium">
                          {locale === 'bn' ? 'নাম (ইংরেজি) *' : 'Name (English) *'}
                        </Label>
                        <Input
                          id="nameEn"
                          className="h-11 bg-white border-slate-200 focus:border-primary"
                          placeholder="Full name in English"
                          {...register('nameEn')}
                        />
                        {errors.nameEn && (
                          <p className="text-sm text-red-500">{errors.nameEn.message}</p>
                        )}
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="nameBn" className="text-sm font-medium">
                          {locale === 'bn' ? 'নাম (বাংলা)' : 'Name (Bengali)'}
                        </Label>
                        <Input
                          id="nameBn"
                          className="h-11 bg-white border-slate-200 focus:border-primary"
                          placeholder="পূর্ণ নাম বাংলায়"
                          {...register('nameBn')}
                        />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="fatherName">
                          {locale === 'bn' ? 'পিতার নাম *' : "Father's Name *"}
                        </Label>
                        <Input
                          id="fatherName"
                          {...register('fatherName')}
                        />
                        {errors.fatherName && (
                          <p className="text-sm text-destructive">{errors.fatherName.message}</p>
                        )}
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="motherName">
                          {locale === 'bn' ? 'মাতার নাম *' : "Mother's Name *"}
                        </Label>
                        <Input
                          id="motherName"
                          {...register('motherName')}
                        />
                        {errors.motherName && (
                          <p className="text-sm text-destructive">{errors.motherName.message}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="phone">
                          {locale === 'bn' ? 'মোবাইল নম্বর *' : 'Mobile Number *'}
                        </Label>
                        <Input
                          id="phone"
                          type="tel"
                          placeholder="01XXXXXXXXX"
                          {...register('phone')}
                        />
                        {errors.phone && (
                          <p className="text-sm text-destructive">{errors.phone.message}</p>
                        )}
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="email">
                          {locale === 'bn' ? 'ই-মেইল' : 'Email'}
                        </Label>
                        <Input
                          id="email"
                          type="email"
                          placeholder="name@example.com"
                          {...register('email')}
                        />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="nidNumber">
                          {locale === 'bn' ? 'এন.আই.ডি নং *' : 'NID Number *'}
                        </Label>
                        <Input
                          id="nidNumber"
                          placeholder="10 or 17 digits"
                          {...register('nidNumber')}
                        />
                        {errors.nidNumber && (
                          <p className="text-sm text-destructive">{errors.nidNumber.message}</p>
                        )}
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="gender">
                          {locale === 'bn' ? 'লিঙ্গ *' : 'Gender *'}
                        </Label>
                        <select
                          id="gender"
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                          {...register('gender')}
                        >
                          <option value="MALE">{locale === 'bn' ? 'পুরুষ' : 'Male'}</option>
                          <option value="FEMALE">{locale === 'bn' ? 'মহিলা' : 'Female'}</option>
                          <option value="OTHER">{locale === 'bn' ? 'অন্যান্য' : 'Other'}</option>
                        </select>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="dateOfBirth">
                          {locale === 'bn' ? 'জন্ম তারিখ' : 'Date of Birth'}
                        </Label>
                        <Input
                          id="dateOfBirth"
                          type="date"
                          {...register('dateOfBirth')}
                        />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="maritalStatus">
                          {locale === 'bn' ? 'বৈবাহিক অবস্থা *' : 'Marital Status *'}
                        </Label>
                        <select
                          id="maritalStatus"
                          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                          {...register('maritalStatus')}
                        >
                          <option value="UNMARRIED">{locale === 'bn' ? 'অবিবাহিত' : 'Unmarried'}</option>
                          <option value="MARRIED">{locale === 'bn' ? 'বিবাহিত' : 'Married'}</option>
                        </select>
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="childrenCount">
                          {locale === 'bn' ? 'সন্তানের সংখ্যা' : 'Number of Children'}
                        </Label>
                        <Input
                          id="childrenCount"
                          type="number"
                          min="0"
                          {...register('childrenCount', { valueAsNumber: true })}
                        />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="password">
                          {locale === 'bn' ? 'পাসওয়ার্ড *' : 'Password *'}
                        </Label>
                        <Input
                          id="password"
                          type="password"
                          {...register('password')}
                        />
                        {errors.password && (
                          <p className="text-sm text-destructive">{errors.password.message}</p>
                        )}
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="confirmPassword">
                          {locale === 'bn' ? 'পাসওয়ার্ড নিশ্চিত করুন *' : 'Confirm Password *'}
                        </Label>
                        <Input
                          id="confirmPassword"
                          type="password"
                          {...register('confirmPassword')}
                        />
                        {errors.confirmPassword && (
                          <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 2: Address */}
                {currentStep === 1 && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold border-b pb-2">
                      {locale === 'bn' ? 'স্থায়ী ঠিকানা' : 'Permanent Address'}
                    </h3>
                    
                    <div className="grid sm:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="permanentHouseNo">
                          {locale === 'bn' ? 'বাড়ী নং *' : 'House No *'}
                        </Label>
                        <Input
                          id="permanentHouseNo"
                          {...register('permanentHouseNo')}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="permanentRoadNo">
                          {locale === 'bn' ? 'রোড নং' : 'Road No'}
                        </Label>
                        <Input
                          id="permanentRoadNo"
                          {...register('permanentRoadNo')}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="permanentVillage">
                          {locale === 'bn' ? 'গ্রাম *' : 'Village *'}
                        </Label>
                        <Input
                          id="permanentVillage"
                          {...register('permanentVillage')}
                        />
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="permanentUnion">
                          {locale === 'bn' ? 'ইউনিয়ন *' : 'Union *'}
                        </Label>
                        <Input
                          id="permanentUnion"
                          {...register('permanentUnion')}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="permanentPoliceStation">
                          {locale === 'bn' ? 'থানা *' : 'Police Station *'}
                        </Label>
                        <Input
                          id="permanentPoliceStation"
                          {...register('permanentPoliceStation')}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="permanentDistrict">
                          {locale === 'bn' ? 'জেলা *' : 'District *'}
                        </Label>
                        <Input
                          id="permanentDistrict"
                          {...register('permanentDistrict')}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-4 border-t">
                      <input
                        type="checkbox"
                        id="sameAsPermanent"
                        checked={sameAsPermanent}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSameAsPermanent(checked);
                          setValue('sameAsPermanent', checked);
                        }}
                        className="h-4 w-4"
                      />
                      <Label htmlFor="sameAsPermanent" className="text-sm font-normal">
                        {locale === 'bn'
                          ? 'বর্তমান ঠিকানা স্থায়ী ঠিকানার সাথে একই'
                          : 'Present address is same as permanent address'}
                      </Label>
                    </div>

                    {!sameAsPermanent && (
                      <>
                        <h3 className="text-lg font-semibold border-b pb-2">
                          {locale === 'bn' ? 'বর্তমান ঠিকানা' : 'Present Address'}
                        </h3>
                        
                        <div className="grid sm:grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="presentHouseNo">
                              {locale === 'bn' ? 'বাড়ী নং' : 'House No'}
                            </Label>
                            <Input
                              id="presentHouseNo"
                              {...register('presentHouseNo')}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="presentRoadNo">
                              {locale === 'bn' ? 'রোড নং' : 'Road No'}
                            </Label>
                            <Input
                              id="presentRoadNo"
                              {...register('presentRoadNo')}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="presentVillage">
                              {locale === 'bn' ? 'গ্রাম' : 'Village'}
                            </Label>
                            <Input
                              id="presentVillage"
                              {...register('presentVillage')}
                            />
                          </div>
                        </div>

                        <div className="grid sm:grid-cols-3 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="presentUnion">
                              {locale === 'bn' ? 'ইউনিয়ন' : 'Union'}
                            </Label>
                            <Input
                              id="presentUnion"
                              {...register('presentUnion')}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="presentPoliceStation">
                              {locale === 'bn' ? 'থানা' : 'Police Station'}
                            </Label>
                            <Input
                              id="presentPoliceStation"
                              {...register('presentPoliceStation')}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="presentDistrict">
                              {locale === 'bn' ? 'জেলা' : 'District'}
                            </Label>
                            <Input
                              id="presentDistrict"
                              {...register('presentDistrict')}
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Step 3: Nominee */}
                {currentStep === 2 && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold border-b pb-2">
                      {locale === 'bn' ? 'নমিনী তথ্য' : 'Nominee Information'}
                    </h3>
                    
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="nomineeName">
                          {locale === 'bn' ? 'নমিনীর নাম *' : 'Nominee Name *'}
                        </Label>
                        <Input
                          id="nomineeName"
                          {...register('nomineeName')}
                        />
                        {errors.nomineeName && (
                          <p className="text-sm text-destructive">{errors.nomineeName.message}</p>
                        )}
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="nomineeRelationship">
                          {locale === 'bn' ? 'সম্পর্ক *' : 'Relationship *'}
                        </Label>
                        <Input
                          id="nomineeRelationship"
                          placeholder={locale === 'bn' ? 'যেমন: পিতা, মাতা, স্ত্রী, স্বামী' : 'e.g. Father, Mother, Wife, Husband'}
                          {...register('nomineeRelationship')}
                        />
                        {errors.nomineeRelationship && (
                          <p className="text-sm text-destructive">{errors.nomineeRelationship.message}</p>
                        )}
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="nomineeNid">
                          {locale === 'bn' ? 'নমিনীর NID *' : 'Nominee NID *'}
                        </Label>
                        <Input
                          id="nomineeNid"
                          {...register('nomineeNid')}
                        />
                        {errors.nomineeNid && (
                          <p className="text-sm text-destructive">{errors.nomineeNid.message}</p>
                        )}
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="nomineePhone">
                          {locale === 'bn' ? 'নমিনীর মোবাইল' : 'Nominee Phone'}
                        </Label>
                        <Input
                          id="nomineePhone"
                          type="tel"
                          {...register('nomineePhone')}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Step 4: Documents & Agreement */}
                {currentStep === 3 && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold border-b pb-2">
                      {locale === 'bn' ? 'প্রয়োজনীয় নথি' : 'Required Documents'}
                    </h3>
                    
                    <div className="bg-muted/50 rounded-lg p-4 text-sm">
                      <p className="font-medium mb-2">
                        {locale === 'bn' ? 'নিম্নলিখিত নথি প্রয়োজন:' : 'Following documents are required:'}
                      </p>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                        <li>{locale === 'bn' ? 'দুই কপি পাসপোর্ট সাইজের ছবি' : 'Two passport-sized photographs'}</li>
                        <li>{locale === 'bn' ? 'ভোটার আই ডি কার্ডের ফটোকপি' : 'Photocopy of NID Card'}</li>
                        <li>{locale === 'bn' ? 'নমিনীর এক কপি পাসপোর্ট সাইজের ছবি' : 'One passport-sized photo of nominee'}</li>
                      </ul>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {locale === 'bn'
                          ? '(নিবন্ধনের পর অফিসে জমা দিতে হবে)'
                          : '(Submit at office after registration)'}
                      </p>
                    </div>

                    <h3 className="text-lg font-semibold border-b pb-2">
                      {locale === 'bn' ? 'নিয়মাবলী' : 'Rules & Regulations'}
                    </h3>
                    
                    <div className="bg-amber-50 dark:bg-amber-950/30 rounded-lg p-4 text-sm space-y-3">
                      <p>
                        {locale === 'bn'
                          ? '১. সুদ মুক্ত সমাজ গঠনের লক্ষ্যে এককালীন ১০০ টাকা অনুদান দিয়ে কর্জ প্রদানে ওয়াদাবদ্ধ হয়ে যে কেউ সদস্য হতে পারবে। উল্লেখ্য যে, সদস্যদের অনুদান অবশ্যই হালাল হতে হবে।'
                          : '1. Anyone can become a member by donating a one-time fee of ৳100 and committing to provide interest-free loans. Note: Member donations must be from halal sources.'}
                      </p>
                      <p>
                        {locale === 'bn'
                          ? '২. কোন সদস্য জমাকৃত টাকা উত্তোলন করতে চাইলে তাকে কমপক্ষে তিন মাস আগে কর্তৃপক্ষকে অবহিত করতে হবে।'
                          : '2. If a member wishes to withdraw deposited funds, they must notify the management at least three months in advance.'}
                      </p>
                      <p>
                        {locale === 'bn'
                          ? '৩. সদস্য জমাকৃত টাকার উপর কোন প্রকার লভ্যাংশ পাবে না।'
                          : '3. Members will not receive any interest or dividends on their deposited funds.'}
                      </p>
                    </div>

                    <h3 className="text-lg font-semibold border-b pb-2">
                      {locale === 'bn' ? 'অঙ্গীকারনামা' : 'Pledge'}
                    </h3>
                    
                    <div className="bg-muted/50 rounded-lg p-4 text-sm">
                      <p className="font-bengali">
                        {locale === 'bn'
                          ? 'আমি অঙ্গীকার করছি যে, অত্র ম্যানেজমেন্টের যাবতীয় নিয়ম কানুন নীতিমালা ও গৃহীত সকল সিদ্ধান্ত আন্তরিকভাবে মেনে চলব। অত্র ম্যানেজমেন্টের স্বার্থ ও মান ক্ষুন্ন ও নিয়ম পরিপন্থী কর্মকান্ডে লিপ্ত হব না।'
                          : 'I pledge that I will sincerely abide by all rules, regulations, policies, and decisions of this management. I will not engage in any activities that harm the interests or violate the rules of this management.'}
                      </p>
                    </div>

                    <div className="flex items-start gap-2 pt-4">
                      <input
                        type="checkbox"
                        id="agreeToTerms"
                        className="h-4 w-4 mt-1"
                        {...register('agreeToTerms')}
                      />
                      <Label htmlFor="agreeToTerms" className="text-sm font-normal">
                        {locale === 'bn'
                          ? 'আমি উপরের সকল নিয়মাবলী পড়েছি এবং মেনে চলতে সম্মত আছি *'
                          : 'I have read and agree to all the above rules and regulations *'}
                      </Label>
                    </div>
                    {errors.agreeToTerms && (
                      <p className="text-sm text-destructive">{errors.agreeToTerms.message}</p>
                    )}
                  </div>
                )}

                {/* Navigation Buttons */}
                <div className="flex justify-between mt-8 pt-6 border-t">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={prevStep}
                    disabled={currentStep === 0}
                    className="gap-2"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    {locale === 'bn' ? 'পেছনে' : 'Back'}
                  </Button>

                  {currentStep < steps.length - 1 ? (
                    <Button type="button" onClick={nextStep} className="gap-2">
                      {locale === 'bn' ? 'পরবর্তী' : 'Next'}
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  ) : (
                    <Button type="submit" disabled={isSubmitting} className="gap-2">
                      {isSubmitting ? (
                        <span className="flex items-center gap-2">
                          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          {locale === 'bn' ? 'জমা হচ্ছে...' : 'Submitting...'}
                        </span>
                      ) : (
                        <>
                          {locale === 'bn' ? 'নিবন্ধন সম্পন্ন করুন' : 'Complete Registration'}
                          <Check className="h-4 w-4" />
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </form>

              <div className="mt-6 text-center text-sm">
                <span className="text-muted-foreground">
                  {locale === 'bn' ? 'ইতিমধ্যে অ্যাকাউন্ট আছে?' : 'Already have an account?'}{' '}
                </span>
                <Link
                  href={`/${locale}/login`}
                  className="text-primary hover:underline font-medium"
                >
                  {locale === 'bn' ? 'সাইন ইন' : 'Sign In'}
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Back to home link */}
          <p className="text-center mt-8">
            <Link
              href={`/${locale}`}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              ← {locale === 'bn' ? 'হোম পেজে ফিরে যান' : 'Back to home'}
            </Link>
          </p>
        </div>
      </main>

      {/* Simple Footer */}
      <footer className="border-t border-slate-100 py-6 mt-8">
        <p className="text-center text-sm text-muted-foreground">
          © {new Date().getFullYear()} Hasnahena. {locale === 'bn' ? 'সর্বস্বত্ব সংরক্ষিত।' : 'All rights reserved.'}
        </p>
      </footer>
    </div>
  );
}
