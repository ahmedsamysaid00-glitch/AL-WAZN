export const PAYOUT_METHODS = [
  'vodafone_cash',
  'orange_cash',
  'etisalat_cash',
  'we_pay',
  'instapay',
  'bank_transfer',
] as const;

export const RECEIPT_ACCEPTED_TYPES = 'image/jpeg,image/png,image/jpg,application/pdf';
export const RECEIPT_MAX_SIZE_BYTES = 10 * 1024 * 1024;

export const DEFAULT_PAYMENT_RECEIVING_NUMBER = '01025716442';
