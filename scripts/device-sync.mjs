import {readFile} from 'node:fs/promises';
import dotenv from 'dotenv';
import {neon} from '@neondatabase/serverless';
import {catalogDatabase} from '../server/catalog-index.mjs';
import {createDeviceSyncStore} from '../server/device-sync.mjs';
dotenv.config({path:'.env.local',quiet:true});
dotenv.config({path:'.env.catalog.local',quiet:true});
const command=process.argv[2];
try{
  const query=catalogDatabase();
  if(command==='migrate'){
    const schema=await readFile(new URL('../server/device-sync-schema.sql',import.meta.url),'utf8');
    const url=process.env.CATALOG_DATABASE_URL||process.env.CATALOG_POSTGRES_URL_NON_POOLING||process.env.CATALOG_POSTGRES_URL;
    const sql=neon(url);
    await sql.transaction(schema.split(';').map(value=>value.trim()).filter(Boolean).map(statement=>sql.query(statement)),{fetchOptions:{signal:AbortSignal.timeout(20000)}}); 
    console.log('Private device-sync schema ready; catalogue tables unchanged.');
  }else if(command==='status'){
    const rows=await query(`SELECT (SELECT count(*)::int FROM openstream_sync.spaces WHERE closed_at IS NULL) AS spaces,
      (SELECT count(*)::int FROM openstream_sync.devices WHERE approved_at IS NOT NULL AND revoked_at IS NULL) AS devices,
      (SELECT count(*)::int FROM openstream_sync.records) AS records`);
    console.log(JSON.stringify(rows[0]));
  }else if(command==='prune'){
    await createDeviceSyncStore({query}).prune();console.log('Expired pairing requests and operation receipts pruned.');
  }else throw Error();
}catch{console.error('Device-sync operation stopped. Check the selected database and configuration.');process.exitCode=1;}
