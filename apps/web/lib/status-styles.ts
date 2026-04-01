// Shared status styling utilities for consistent badge/label appearance across the app

export type MemberStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'PENDING';
export type TransactionStatus = 'CONFIRMED' | 'PENDING' | 'PROCESSING' | 'REJECTED' | 'CANCELLED';
export type TransactionType = 'DEPOSIT' | 'WITHDRAWAL' | 'LOAN_DISBURSEMENT' | 'LOAN_REPAYMENT' | 'DONATION';
export type LoanStatus = 'PENDING' | 'APPROVED' | 'ACTIVE' | 'COMPLETED' | 'REJECTED' | 'DEFAULTED';
export type WorkerRole = 'ADMIN' | 'WORKER' | 'MEMBER';

// Badge style classes
export const statusStyles = {
  // Member status
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-gray-100 text-gray-600',
  SUSPENDED: 'bg-red-100 text-red-700',
  PENDING: 'bg-amber-100 text-amber-700',
  
  // Transaction status
  CONFIRMED: 'bg-green-100 text-green-700',
  PROCESSING: 'bg-blue-100 text-blue-700',
  REJECTED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-600',
  
  // Loan status
  APPROVED: 'bg-green-100 text-green-700',
  COMPLETED: 'bg-gray-100 text-gray-600',
  DEFAULTED: 'bg-red-100 text-red-700',
  
  // Roles
  ADMIN: 'bg-purple-100 text-purple-700',
  WORKER: 'bg-blue-100 text-blue-700',
  MEMBER: 'bg-gray-100 text-gray-600',
} as const;

// Status labels with bilingual support
export const statusLabels = {
  // Member status
  ACTIVE: { en: 'Active', bn: 'সক্রিয়' },
  INACTIVE: { en: 'Inactive', bn: 'নিষ্ক্রিয়' },
  SUSPENDED: { en: 'Suspended', bn: 'স্থগিত' },
  PENDING: { en: 'Pending', bn: 'অপেক্ষমাণ' },
  
  // Transaction status
  CONFIRMED: { en: 'Confirmed', bn: 'নিশ্চিত' },
  PROCESSING: { en: 'Processing', bn: 'প্রক্রিয়াধীন' },
  REJECTED: { en: 'Rejected', bn: 'প্রত্যাখ্যাত' },
  CANCELLED: { en: 'Cancelled', bn: 'বাতিল' },
  
  // Loan status
  APPROVED: { en: 'Approved', bn: 'অনুমোদিত' },
  COMPLETED: { en: 'Completed', bn: 'সম্পন্ন' },
  DEFAULTED: { en: 'Defaulted', bn: 'খেলাপি' },
  
  // Transaction types
  DEPOSIT: { en: 'Deposit', bn: 'জমা' },
  WITHDRAWAL: { en: 'Withdrawal', bn: 'উত্তোলন' },
  LOAN_DISBURSEMENT: { en: 'Loan', bn: 'ঋণ বিতরণ' },
  LOAN_REPAYMENT: { en: 'Repayment', bn: 'ঋণ পরিশোধ' },
  DONATION: { en: 'Donation', bn: 'দান' },
  
  // Roles
  ADMIN: { en: 'Admin', bn: 'অ্যাডমিন' },
  WORKER: { en: 'Worker', bn: 'কর্মী' },
  MEMBER: { en: 'Member', bn: 'সদস্য' },
} as const;

// Type icons mapping
export const typeStyles = {
  DEPOSIT: 'bg-green-100 text-green-700',
  WITHDRAWAL: 'bg-blue-100 text-blue-700',
  LOAN_DISBURSEMENT: 'bg-purple-100 text-purple-700',
  LOAN_REPAYMENT: 'bg-amber-100 text-amber-700',
  DONATION: 'bg-pink-100 text-pink-700',
} as const;

// Helper functions
export function getStatusStyle(status: string): string {
  return statusStyles[status as keyof typeof statusStyles] || 'bg-gray-100 text-gray-600';
}

export function getStatusLabel(status: string, locale: string): string {
  const labels = statusLabels[status as keyof typeof statusLabels];
  if (!labels) return status;
  return locale === 'bn' ? labels.bn : labels.en;
}

export function getTypeStyle(type: string): string {
  return typeStyles[type as keyof typeof typeStyles] || 'bg-gray-100 text-gray-600';
}

// Status badge component helper
export function getStatusBadgeClass(status: string): string {
  return `px-2 py-0.5 text-xs rounded ${getStatusStyle(status)}`;
}
