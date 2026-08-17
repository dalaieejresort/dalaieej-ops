export const PAYMENT_LOG_HEADERS = [
  'payment_id',
  'transaction_id',
  'timestamp',
  'staff',
  'payment_method',
  'amount',
  'cash_received',
  'change_due',
  'qpay_invoice_id',
  'notes',
  'receipt_id',
  'session_id',
  'business_date',
];

export const RECEIPT_LOG_HEADERS = [
  'receipt_id',
  'timestamp',
  'session_id',
  'business_date',
  'staff',
  'order_ids',
  'total',
  'payment_summary',
  'cash_received',
  'change_due',
  'qpay_invoice_id',
  'notes',
  'client_request_id',
  'operation_status',
];

export function makeUniformControlNumber(
  prefix: 'ORD' | 'RCP' | 'PAY' | 'RFN' | 'SES',
  date = new Date(),
) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ulaanbaatar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(item => item.type === type)?.value ?? '00';
  const day = `${part('year')}${part('month')}${part('day')}`;
  const time = `${part('hour')}${part('minute')}${part('second')}`;
  const nonce = crypto.randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();

  return `${prefix}-${day}-${time}-${nonce}`;
}

export function compactBusinessDate(businessDate: string) {
  const digits = businessDate.replace(/\D/g, '');
  return /^\d{8}$/.test(digits) ? digits : '00000000';
}

export function makeGlobalSequenceNumber(
  prefix: 'ORD' | 'RCP' | 'SES',
  rowNumber: number,
  businessDate: string,
) {
  const sequence = Math.max(rowNumber - 1, 1);
  return `${prefix}-${compactBusinessDate(businessDate)}-${sequence
    .toString()
    .padStart(6, '0')}`;
}

export function makeUniformOrderNumber(
  rowNumber: number,
  businessDate: string,
) {
  return makeGlobalSequenceNumber('ORD', rowNumber, businessDate);
}

export function makeUniformReceiptNumber(
  rowNumber: number,
  businessDate: string,
) {
  return makeGlobalSequenceNumber('RCP', rowNumber, businessDate);
}

export function makeUniformSessionNumber(
  rowNumber: number,
  businessDate: string,
) {
  return makeGlobalSequenceNumber('SES', rowNumber, businessDate);
}

export function makePaymentLineNumber(receiptId: string, index: number) {
  return `PAY-${receiptId.replace(/^RCP-/, '')}-${Math.max(index, 1)
    .toString()
    .padStart(2, '0')}`;
}
