import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number, locale: string = 'en') {
  return new Intl.NumberFormat(locale === 'bn' ? 'bn-BD' : 'en-BD', {
    style: 'currency',
    currency: 'BDT',
    minimumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(date: string | Date, locale: string = 'en') {
  return new Date(date).toLocaleDateString(locale === 'bn' ? 'bn-BD' : 'en-BD', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
