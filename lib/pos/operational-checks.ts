import type { DataQualityReport } from '@/lib/data-quality-types';

export type PendingOperation = {
  type: string;
  requestId: string;
  resourceId: string;
  businessDate: string;
  actor: string;
  error: string;
  recoverable: boolean;
};

export function needsOperationalAttention(
  quality: DataQualityReport | null,
  pending: PendingOperation[],
  errors: string[],
) {
  return errors.length > 0 || pending.length > 0 || quality?.status === 'attention';
}

export function lowStockProducts<T extends { tracked: boolean; stock: number }>(products: T[]) {
  return products.filter(product => product.tracked && product.stock <= 3)
    .sort((a, b) => a.stock - b.stock);
}
