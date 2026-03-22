# Hasnahena Member Registration Form

> **Organization:** হাসনাহেনা (Hasnahena)  
> **Type:** করজে হাসানাহ্ ভিত্তিক অলাভজনক আর্থিক প্রতিষ্ঠান (Qard al-Hasan based non-profit financial institution)  
> **Motto:** "সুদ ও দারিদ্রমুক্ত সমাজ গড়ি" (Building an interest-free and poverty-free society)  
> **Location:** ভেকুটিয়া, সদর, যশোর (Vekutia, Sadar, Jessore)

---

## Form Fields Specification

### Section 1: Member Identification

| Field (Bengali) | Field (English) | Type | Required | Validation |
|-----------------|-----------------|------|----------|------------|
| গ্রাহক আই.ডি | Member ID | Text | Auto-generated | System generated unique ID |
| ফরম নং | Form Number | Text | Auto-generated | Sequential form number |

### Section 2: Personal Information

| Field (Bengali) | Field (English) | Type | Required | Validation |
|-----------------|-----------------|------|----------|------------|
| গ্রাহকের নাম | Member Name | Text | ✓ | Min 3 characters |
| পিতার নাম | Father's Name | Text | ✓ | Min 3 characters |
| মাতার নাম | Mother's Name | Text | ✓ | Min 3 characters |
| মোবাইল নাম্বার | Mobile Number | Phone | ✓ | Valid BD number (01XXXXXXXXX) |
| ই-মেইল | Email | Email | ○ | Valid email format |
| এন.আই.ডি নং | NID Number | Text | ✓* | 10 or 17 digit NID |
| বৈবাহিক অবস্থা | Marital Status | Select | ✓ | বিবাহিত/অবিবাহিত (Married/Unmarried) |
| সন্তানের সংখ্যা | Number of Children | Number | ○ | 0 or positive integer |

> *Note: For members under 18 years, parent's NID is required instead:
> - পিতার এন.আই.ডি নং (Father's NID Number)
> - মাতার এন.আই.ডি নং (Mother's NID Number)

### Section 3: Permanent Address (স্থায়ী ঠিকানা)

| Field (Bengali) | Field (English) | Type | Required |
|-----------------|-----------------|------|----------|
| বাড়ী নং | House Number | Text | ✓ |
| রোড নং | Road Number | Text | ○ |
| গ্রাম | Village | Text | ✓ |
| ইউনিয়ন | Union | Text | ✓ |
| থানা | Police Station | Text | ✓ |
| জেলা | District | Text | ✓ |
| দেশ | Country | Text | ✓ (Default: বাংলাদেশ) |

### Section 4: Present Address (বর্তমান ঠিকানা)

Same fields as Permanent Address with option to copy from permanent address.

### Section 5: Religious Practice (Optional Survey)

| Field (Bengali) | Field (English) | Type | Options |
|-----------------|-----------------|------|---------|
| নামাজ আদায় | Prayer Practice | Select | জামাতে (Congregation) / একাকী (Alone) |
| ওয়াক্ত | Prayer Frequency | Number | Number of daily prayers |
| কুরআন পড়া হয় | Quran Reading | Boolean | হ্যাঁ (Yes) / না (No) |
| হাদিস পড়া হয় | Hadith Reading | Boolean | হ্যাঁ (Yes) / না (No) |

> Note: These fields are for organizational survey purposes only and do not affect membership eligibility.

### Section 6: Nominee Information (নমিনী)

| Field (Bengali) | Field (English) | Type | Required |
|-----------------|-----------------|------|----------|
| নমিনীর নাম | Nominee Name | Text | ✓ |
| সম্পর্ক | Relationship | Text | ✓ |
| নমিনীর NID | Nominee NID | Text | ✓ |
| গ্রাহকের হিসাব নং | Member Account No | Text | Auto-linked |

---

## Required Attachments (সংযুক্তি)

1. **দুই কপি পাসপোর্ট সাইজের ছবি** - Two passport-sized photographs of member
2. **ভোটার আই ডি কার্ডের ফটোকপি** - Photocopy of Voter ID / NID Card
3. **নমিনীর এক কপি পাসপোর্ট সাইজের ছবি** - One passport-sized photograph of nominee

---

## Rules and Regulations (নিয়মাবলী)

### Bengali (Original)

১. সুদ মুক্ত সমাজ গঠনের লক্ষ্যে এককালীন ১০০ টাকা অনুদান দিয়ে কর্জ প্রদানে ওয়াদাবদ্ধ হয়ে যে কেউ সদস্য হতে পারবে। উল্লেখ্য যে, সদস্যদের অনুদান অবশ্যই হালাল হতে হবে।

২. কোন সদস্য জমাকৃত টাকা উত্তোলন করতে চাইলে তাকে কমপক্ষে তিন মাস আগে কর্তৃপক্ষকে অবহিত করতে হবে।

৩. সদস্য জমাকৃত টাকার উপর কোন প্রকার লভ্যাংশ পাবে না।

### English Translation

1. **Membership Fee:** Anyone can become a member by donating a one-time fee of ৳100 and committing to provide interest-free loans. Note: Member donations must be from halal (permissible) sources.

2. **Withdrawal Notice:** If a member wishes to withdraw deposited funds, they must notify the management at least three months in advance.

3. **No Interest/Dividends:** Members will not receive any interest or dividends on their deposited funds.

---

## Commitment/Pledge (অঙ্গীকারনামা)

### Bengali (Original)

আমি অঙ্গীকার করছি যে, অত্র ম্যানেজমেন্টের যাবতীয় নিয়ম কানুন নীতিমালা ও গৃহীত সকল সিদ্ধান্ত আন্তরিকভাবে মেনে চলব। অত্র ম্যানেজমেন্টের স্বার্থ ও মান ক্ষুন্ন ও নিয়ম পরিপন্থী কর্মকান্ডে লিপ্ত হব না। আমি অঙ্গিকার করছি যে, ম্যানেজমেন্টের উন্নতি কল্পে প্রকাশ্যে-অপ্রকাশ্যে চলা ফেরা ও কথাবার্তায় এবং আর্থিক সহযোগিতায় সর্বদা নিজেকে নিয়োজিত রাখব।

### English Translation

I pledge that I will sincerely abide by all rules, regulations, policies, and decisions of this management. I will not engage in any activities that harm the interests or standards of this management or violate its rules. I pledge that I will always keep myself engaged in the betterment of the management through my conduct, speech, and financial support, both publicly and privately.

---

## Signature Fields

| Field | Purpose |
|-------|---------|
| সদস্যর স্বাক্ষর | Member's Signature |
| আবেদনকারীর স্বাক্ষর ও তারিখ | Applicant's Signature and Date |
| ব্যবস্থাপনা পরিচালকের স্বাক্ষর | Managing Director's Signature |

---

## Guiding Principles (মূলনীতি)

> সকল প্রশংসা মহান আল্লাহ্ তা'আলার। আমাদের সকল কাজের মূল উদ্দেশ্য শুধুমাত্র আল্লাহর সন্তুষ্টি অর্জন করা। "হাসনাহেনা" প্রতিষ্ঠানের সকল আর্থিক কার্যক্রম কুরআন ও হাদিসের আলোকে পরিচালনা করার জন্য অঙ্গীকার বদ্ধ। সুদ ও দারিদ্রমুক্ত সমাজ গড়ার লক্ষ্যে আমাদের এই ক্ষুদ্র প্রচেষ্টাকে আল্লাহ্ কবুল করুন। (আমীন)

**Translation:** All praise belongs to Allah the Almighty. The sole purpose of all our activities is to attain Allah's pleasure. The "Hasnahena" organization is committed to conducting all financial activities in the light of the Quran and Hadith. May Allah accept our humble effort to build an interest-free and poverty-free society. (Ameen)

---

## Digital Implementation Notes

### For Web Application

1. **Multi-step Form:** Break into logical sections (Personal → Address → Nominee → Documents)
2. **Bilingual Support:** All labels should display in both Bengali and English
3. **Validation:** Real-time validation with clear error messages
4. **Document Upload:** Accept JPG/PNG for photos, PDF for NID copies
5. **Address Autocomplete:** Consider integration with Bangladesh postal data
6. **Progress Indicator:** Show completion percentage
7. **Save Draft:** Allow saving incomplete forms
8. **Mobile Responsive:** Optimize for smartphone usage (primary device in BD)

### Database Mapping

```
Registration Form → users table (personal info)
                 → addresses table (permanent & present)
                 → nominees table (nominee info)
                 → documents table (uploaded files)
                 → registration_requests table (approval workflow)
```
