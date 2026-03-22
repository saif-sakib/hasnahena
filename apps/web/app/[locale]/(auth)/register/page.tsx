'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ChevronLeft, ChevronRight, Check, User, MapPin, Users, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Header } from '@/components/layout/header';
import { Footer } from '@/components/layout/footer';

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
  const [currentStep, setCurrentStep] = useState(0);
  const [sameAsPermanent, setSameAsPermanent] = useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      maritalStatus: 'UNMARRIED',
      gender: 'MALE',
      childrenCount: 0,
    },
  });

  const onSubmit = async (data: RegisterFormData) => {
    console.log('Register data:', data);
    // TODO: Submit to API
  };

  const nextStep = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
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
    <>
      <Header />
      <main className="flex-1 py-8 px-4 bg-muted/30">
        <div className="container-wide max-w-4xl">
          {/* Progress Steps */}
          <div className="mb-8">
            <div className="flex items-center justify-between">
              {steps.map((step, index) => (
                <div key={step.id} className="flex items-center">
                  <div className="flex flex-col items-center">
                    <div
                      className={`h-10 w-10 rounded-full flex items-center justify-center border-2 transition-colors ${
                        index < currentStep
                          ? 'bg-primary border-primary text-primary-foreground'
                          : index === currentStep
                          ? 'border-primary text-primary'
                          : 'border-muted-foreground/30 text-muted-foreground'
                      }`}
                    >
                      {index < currentStep ? (
                        <Check className="h-5 w-5" />
                      ) : (
                        <step.icon className="h-5 w-5" />
                      )}
                    </div>
                    <span className="text-xs mt-2 hidden sm:block">
                      {stepTitles[index]}
                    </span>
                  </div>
                  {index < steps.length - 1 && (
                    <div
                      className={`h-1 w-12 sm:w-24 mx-2 ${
                        index < currentStep ? 'bg-primary' : 'bg-muted-foreground/30'
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">
                {locale === 'bn' ? 'হাসনাহেনায় নিবন্ধন' : 'Register for Hasnahena'}
              </CardTitle>
              <CardDescription>
                {locale === 'bn'
                  ? 'সুদমুক্ত অর্থায়নে আপনার যাত্রা শুরু করুন'
                  : 'Start your journey to interest-free finance'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit(onSubmit)}>
                {/* Step 1: Personal Information */}
                {currentStep === 0 && (
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold border-b pb-2">
                      {locale === 'bn' ? 'ব্যক্তিগত তথ্য' : 'Personal Information'}
                    </h3>
                    
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="nameEn">
                          {locale === 'bn' ? 'নাম (ইংরেজি) *' : 'Name (English) *'}
                        </Label>
                        <Input
                          id="nameEn"
                          placeholder="Full name in English"
                          {...register('nameEn')}
                        />
                        {errors.nameEn && (
                          <p className="text-sm text-destructive">{errors.nameEn.message}</p>
                        )}
                      </div>
                      
                      <div className="space-y-2">
                        <Label htmlFor="nameBn">
                          {locale === 'bn' ? 'নাম (বাংলা)' : 'Name (Bengali)'}
                        </Label>
                        <Input
                          id="nameBn"
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
                        onChange={(e) => setSameAsPermanent(e.target.checked)}
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
        </div>
      </main>
      <Footer />
    </>
  );
}
