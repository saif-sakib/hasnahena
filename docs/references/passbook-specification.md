# Hasnahena Passbook (সঞ্চয় ও ঋণ পাস বই) Specification

> **Document Type:** Member Passbook / Account Book  
> **Purpose:** Track savings deposits, withdrawals, and loan transactions  
> **Issued By:** Hasnahena Foundation

---

## Passbook Structure

The physical passbook contains multiple sections. This document specifies how each section maps to the digital system.

---

## Section 1: Cover Page

### Organization Header

| Bengali | English | Notes |
|---------|---------|-------|
| হাসনাহেনা | Hasnahena | Organization name |
| করজে হাসানাহ্ ভিত্তিক অলাভজনক আর্থিক প্রতিষ্ঠান | Qard al-Hasan based non-profit financial institution | Tagline |
| প্রধান কার্যালয় | Head Office | Address section |
| বেলাশেষে/৪৯৩, কারিগরপাড়া, ভেকুটিয়া, সদর, যশোর | Belasheshe/493, Karigarpara, Vekutia, Sadar, Jessore | Full address |

### Passbook Identification

| Field (Bengali) | Field (English) | Database Column |
|-----------------|-----------------|-----------------|
| সঞ্চয় ও ঋণ পাশ বই | Savings & Loan Passbook | - |
| গ্রাহক কপি | Customer Copy | passbook_type |
| শাখা | Branch | branch_id |

---

## Section 2: Member Information Page

| Field (Bengali) | Field (English) | Database Column | Required |
|-----------------|-----------------|-----------------|----------|
| গ্রাহকের নাম | Member Name | users.full_name | ✓ |
| সদস্য/সদস্যার হিসাব নং | Member Account Number | users.account_number | ✓ |
| মোবাইল নাম্বার | Mobile Number | users.phone | ✓ |
| পিতা/স্বামী | Father/Husband | users.guardian_name | ✓ |
| এরিয়া | Area | addresses.area | ○ |
| পাশ বই ইস্যুর তারিখ | Passbook Issue Date | passbooks.issued_at | ✓ |

### Signature Section

| Field | Purpose | Database |
|-------|---------|----------|
| গ্রাহকের ছবি | Member Photo | users.photo_url |
| সদস্যর নমুনা স্বাক্ষর | Member Sample Signature | users.signature_url |
| সত্যায়িত কর্মকর্তার স্বাক্ষর | Certifying Officer Signature | passbooks.certified_by |
| হিসাব রক্ষকের স্বাক্ষর | Accountant Signature | passbooks.accountant_id |

---

## Section 3: Staff Assignment Record

Tracks which staff members have handled this account over time.

| Field (Bengali) | Field (English) | Database Column |
|-----------------|-----------------|-----------------|
| ক্রমিক নং | Serial Number | staff_assignments.id |
| কর্মীর নাম | Staff Name | users.full_name (staff) |
| পিন নং | PIN Number | users.pin_code |
| দায়িত্বকাল হইতে | Responsibility From | staff_assignments.start_date |
| দায়িত্বকাল পর্যন্ত | Responsibility Until | staff_assignments.end_date |
| স্বাক্ষর | Signature | staff_assignments.signature |

---

## Section 4: Loan Information (ঋণ সংক্রান্ত তথ্য)

| Field (Bengali) | Field (English) | Database Column | Type |
|-----------------|-----------------|-----------------|------|
| ঋণ নম্বর | Loan Number | loans.loan_number | String |
| বিতরণের তারিখ | Disbursement Date | loans.disbursed_at | Date |
| ঋণের পরিমাণ | Loan Amount | loans.principal_amount | Decimal |
| কিস্তির সংখ্যা | Number of Installments | loans.installment_count | Integer |
| প্রতি কিস্তির পরিমাণ | Amount per Installment | loans.installment_amount | Decimal |
| কিস্তি শুরুর তারিখ | Installment Start Date | loans.first_installment_date | Date |
| ঋণ পরিশোধের সম্ভাব্য তারিখ | Expected Repayment Date | loans.due_date | Date |
| গ্রহণের উদ্দেশ্য | Loan Purpose | loans.purpose | Text |
| আবেদন ফি | Application Fee | loans.application_fee | Decimal |

### Loan Approval Signatures

| Signature | Role | Database |
|-----------|------|----------|
| স্বাক্ষর (হিসাব রক্ষক) | Accountant Signature | loans.accountant_approved_by |
| স্বাক্ষর (শাখা ব্যবস্থাপক) | Branch Manager Signature | loans.manager_approved_by |

---

## Section 5: Transaction Ledger (সঞ্চয় ও ঋণ পাস বই)

This is the main transaction recording section with columns for both savings and loan tracking.

### Savings Account Columns (সঞ্চয় হিসাব)

| Column (Bengali) | Column (English) | Database Column | Type |
|------------------|------------------|-----------------|------|
| তারিখ | Date | transactions.created_at | DateTime |
| রশিদ নম্বর | Receipt Number | transactions.receipt_number | String |
| জমা | Deposit | transactions.amount (type=DEPOSIT) | Decimal |
| ফেরত | Withdrawal | transactions.amount (type=WITHDRAWAL) | Decimal |
| সঞ্চয় স্থিতি | Savings Balance | calculated field | Decimal |

### Loan Account Columns (ঋণের হিসাব)

| Column (Bengali) | Column (English) | Database Column | Type |
|------------------|------------------|-----------------|------|
| ঋণের পরিমাণ | Loan Amount | loans.principal_amount | Decimal |
| কিস্তি জমার পরিমাণ | Installment Paid | transactions.amount (type=LOAN_REPAYMENT) | Decimal |
| ঋণ স্থিতি | Loan Balance | calculated field | Decimal |

### Signature Columns

| Column (Bengali) | Column (English) | Purpose |
|------------------|------------------|---------|
| সঞ্চয় উত্তোলনকারীর স্বাক্ষর | Withdrawal Signature | Member confirms withdrawal |
| কর্মকর্তার স্বাক্ষর | Officer Signature | Staff confirms transaction |

---

## Section 6: Passbook Renewal (নবায়ন)

When the passbook pages are filled, it gets renewed.

| Field | Database Column |
|-------|-----------------|
| ১ম বার পর্যন্ত নবায়ন করা হলো | passbook_renewals (renewal_number=1) |
| ২য় বার পর্যন্ত নবায়ন করা হলো | passbook_renewals (renewal_number=2) |
| ৩য় বার পর্যন্ত নবায়ন করা হলো | passbook_renewals (renewal_number=3) |

Each renewal requires:
- স্বাক্ষর (হিসাব রক্ষক) - Accountant Signature
- স্বাক্ষর (শাখা ব্যবস্থাপক) - Branch Manager Signature

---

## Section 7: Clearance Certificate (ছাড়পত্র)

Issued when a member closes their account with no outstanding dues.

### Certificate Content

```
হাসনাহেনা ফাউন্ডেশনের ছাড়পত্র

প্রত্যয়ন করা যাচ্ছে যে,
[নাম] পিতা/স্বামী: [পিতা/স্বামীর নাম]
গ্রাম: [গ্রাম] উপজেলা: [উপজেলা] জেলা: [জেলা]
এর কাছে হাসনাহেনা ফাউন্ডেশনের [শাখা] শাখার কোন প্রকার দেনা-পাওনা নাই।

স্বাক্ষর (হিসাব রক্ষক)
স্বাক্ষর (শাখা ব্যবস্থাপক)
তাং
```

### English Translation

```
Hasnahena Foundation Clearance Certificate

This is to certify that,
[Name] Father/Husband: [Guardian Name]
Village: [Village] Upazila: [Upazila] District: [District]
has no outstanding dues with the [Branch] branch of Hasnahena Foundation.

Signature (Accountant)
Signature (Branch Manager)
Date
```

---

## Section 8: Loan Commitment (ঋণ অঙ্গীকার)

### Hadith References (Important for Context)

These hadiths are printed in the passbook to remind members of their obligations:

1. **Hadith 1 (Sahih Bukhari 2387):**
   > "যে মানুষ সম্পদ পরিশোধের নিয়তে (ঋণ) নেয়, আল্লাহ্ তার পক্ষ থেকে পরিশোধ করে দেন। আর যে আত্মসাতের উদ্দেশ্যে নেয়, আল্লাহ তা ধ্বংস করে দেন।"
   
   *Translation: "Whoever takes people's wealth intending to repay it, Allah will repay it on his behalf. And whoever takes it intending to destroy it, Allah will destroy him."*

2. **Hadith 2 (Ibn Majah):**
   > "যে ব্যক্তি ঋণ গ্রহণ করেছে কিন্তু তা পরিশোধ করার ইচ্ছা পোষণ করেনি সে ব্যক্তি চোর সাব্যস্ত হয়ে আল্লাহর কাছে উপস্থিত হবে।"
   
   *Translation: "Whoever takes a loan and does not intend to repay it will meet Allah as a thief."*

3. **Hadith 3 (Sahih Muslim 1886):**
   > "ঋণ ছাড়া শহীদের সমস্ত গোনাহ মাফ করে দেওয়া হয়।"
   
   *Translation: "All sins of a martyr are forgiven except debt."*

### Member Commitment Text

```
অঙ্গীকার:
আমি [নাম] উপরোক্ত হাদীসগুলো মনে রাখবো এবং "হাসনাহেনা" কর্যে হাসানাহ্ কার্যক্রম 
প্রণীত নীতিমালা মেনে গৃহীত ঋণ যথাসময়ে পরিশোধ করতে চেষ্টা করবো। 
অন্যথায় কর্তৃপক্ষের গৃহীত সিদ্ধান্ত মেনে নিতে বাধ্য হবো।

কর্জ গ্রহীতার স্বাক্ষর: _______________
তারিখ: _______________
```

---

## Digital System Implementation

### Dashboard Views

#### Member Dashboard
- Current savings balance
- Active loan details and remaining balance
- Recent transactions
- Upcoming installment due date
- Download transaction statement (PDF)

#### Worker Dashboard
- Process deposit/withdrawal requests
- Record loan installments
- Generate receipts

#### Admin Dashboard
- Approve/reject loans
- View all member accounts
- Generate reports
- Issue clearance certificates

### Key Calculated Fields

```javascript
// Savings Balance
savings_balance = SUM(deposits) - SUM(withdrawals)

// Loan Balance  
loan_balance = principal_amount - SUM(installments_paid)

// Loan Eligibility
max_loan = MIN(
  personal_cap,      // 5 × current_deposit
  fairness_cap,      // 2 × (total_pool / active_members)
  solvency_cap       // available_lending_funds
)
```

### Transaction Receipt Fields

Each transaction generates a receipt with:
- Receipt Number (unique)
- Transaction Date & Time
- Transaction Type
- Amount
- Previous Balance
- New Balance
- Member Name & Account Number
- Processed By (Worker Name)
- Branch Name

---

## Notes for Development

1. **Bilingual Support:** All labels must display in both Bengali and English
2. **Print Compatibility:** Design transaction statements to match physical passbook format
3. **Offline Capability:** Consider local storage for areas with poor connectivity
4. **Signature Capture:** Allow digital signature capture on mobile devices
5. **Photo Verification:** Display member photo on worker screens for identity verification
