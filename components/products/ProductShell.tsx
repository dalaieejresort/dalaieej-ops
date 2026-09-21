import type { ReactNode } from 'react';
import type { OpsRole } from '@/lib/auth-types';
import { OperationsChrome } from '@/components/navigation/OperationsChrome';
import styles from './Products.module.css';
export function ProductShell({archive=false,role,children}:{archive?:boolean;role:OpsRole;children:ReactNode}) {
  return <div className={styles.workspace}><OperationsChrome role={role} active={archive?'archive':'products'}/><main className={styles.main}>{children}</main></div>;
}
