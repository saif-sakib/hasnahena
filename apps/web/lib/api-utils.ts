/**
 * Shared utilities for API routes
 */
import crypto from 'crypto';

/**
 * Convert BigInt fields to numbers for JSON serialization
 */
export function serializeTransaction(tx: any) {
  return {
    ...tx,
    amount: tx.amount ? Number(tx.amount) : null,
    balanceAfter: tx.balanceAfter ? Number(tx.balanceAfter) : null,
    savingsAfter: tx.savingsAfter ? Number(tx.savingsAfter) : null,
    loanAfter: tx.loanAfter ? Number(tx.loanAfter) : null,
    disputeCorrectAmount: tx.disputeCorrectAmount ? Number(tx.disputeCorrectAmount) : null,
  };
}

/**
 * Serialize loan data for JSON response
 */
export function serializeLoan(loan: any) {
  return {
    ...loan,
    principalAmount: loan.principalAmount ? Number(loan.principalAmount) : null,
    remainingAmount: loan.remainingAmount ? Number(loan.remainingAmount) : null,
    installmentAmount: loan.installmentAmount ? Number(loan.installmentAmount) : null,
    applicationFee: loan.applicationFee ? Number(loan.applicationFee) : null,
    totalPaid: loan.totalPaid ? Number(loan.totalPaid) : null,
    amount: loan.amount ? Number(loan.amount) : null,
    monthlyInstallment: loan.monthlyInstallment ? Number(loan.monthlyInstallment) : null,
  };
}

/**
 * Generate a secure temporary password
 */
export function generateTemporaryPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += chars[bytes[i] % chars.length];
  return out;
}
