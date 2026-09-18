import 'server-only';
import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { PostgresDocument } from './postgres';
import { posBackend, posQuery, posSchema } from './transaction';
import type { PosDocument } from './types';
export type { PosDocument, PosWorksheet } from './types';
export { posBackend } from './transaction';
export function createPosDocument():PosDocument {
  if(posBackend()==='postgres')return new PostgresDocument(posQuery,posSchema());
  const required=(name:string)=>{const value=process.env[name]?.trim();if(!value)throw new Error(`${name} is missing`);return value.replace(/^"|"$/g,'');};
  const auth=new JWT({email:required('GOOGLE_SERVICE_ACCOUNT_EMAIL'),key:required('GOOGLE_PRIVATE_KEY').replace(/\\n/g,'\n'),scopes:['https://www.googleapis.com/auth/spreadsheets']});
  return new GoogleSpreadsheet(required('GOOGLE_SHEET_ID'),auth) as unknown as PosDocument;
}
