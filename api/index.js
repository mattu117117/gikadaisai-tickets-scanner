import { neon } from '@neondatabase/serverless';
import { timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';

const ID_PATTERN = /^[sdpm]\d{2}-\d{3}$/;
const TABLES = {
  tickets: {
    label:'商品券マスター',
    columns:[['management_id','管理番号'],['category','区分'],['source_id','ID'],['serial_no','連番'],['recipient','配布先'],['amount','金額','number'],['status','状態'],['used_store','使用店舗'],['used_at','使用日時','date'],['confirmed_by','確認担当者'],['process_id','処理ID']],
    from:'tickets', order:'management_id ASC',
    search:"concat_ws(' ',management_id,category,source_id,serial_no,recipient,amount,status,used_store,confirmed_by,process_id)"
  },
  usage_logs: {
    label:'使用ログ',
    columns:[['used_at','Timestamp','date'],['management_id','管理番号'],['amount','金額','number'],['store_name','使用店舗'],['confirmed_by','確認担当者'],['process_id','処理ID']],
    from:'usage_logs', order:'used_at DESC, id DESC',
    search:"concat_ws(' ',management_id,amount,store_name,confirmed_by,process_id)"
  },
  sessions: {
    label:'回収セッション',
    columns:[['process_id','処理ID'],['store_name','店舗'],['staff_name','担当者'],['started_at','開始時刻','date'],['finished_at','終了時刻','date'],['ticket_count','枚数','number'],['total_amount','合計金額','number'],['status','状態']],
    from:'sessions', order:'started_at DESC',
    search:"concat_ws(' ',process_id,store_name,staff_name,status)"
  },
  stores: {
    label:'店舗マスター',
    columns:[['store_id','店舗ID'],['store_name','店舗名'],['is_active','有効 / 無効','boolean']],
    from:'stores', order:'store_id ASC', search:"concat_ws(' ',store_id,store_name,CASE WHEN is_active THEN '有効' ELSE '無効' END)"
  },
  staff: {
    label:'担当者マスター',
    columns:[['staff_id','担当者ID'],['staff_name','担当者名'],['is_active','有効 / 無効','boolean']],
    from:'staff', order:'staff_id ASC', search:"concat_ws(' ',staff_id,staff_name,CASE WHEN is_active THEN '有効' ELSE '無効' END)"
  },
  cancellations: {
    label:'取消ログ',
    columns:[['cancelled_at','取消日時','date'],['management_id','管理番号'],['amount','金額','number'],['original_store','元の使用店舗'],['original_used_at','元の使用日時','date'],['original_confirmed_by','元の確認担当者'],['original_process_id','元の処理ID'],['cancelled_by','取消担当者'],['reason','取消理由']],
    from:'cancellations', order:'cancelled_at DESC, id DESC',
    search:"concat_ws(' ',management_id,amount,original_store,original_confirmed_by,original_process_id,cancelled_by,reason)"
  }
};

export default async function handler(req, res) {
  setSecurityHeaders(res);
  const action = String(req.query?.action || 'health');
  try {
    const sql = database();
    switch (action) {
      case 'health': return send(res, 200, { success:true, service:'gikadaisai-tickets-scanner', environment:isTraining()?'training':'production' });
      case 'setup': return await setup(req, res, sql);
      case 'stores': return await listStores(req, res, sql);
      case 'startSession': return await startSession(req, res, sql);
      case 'registerTicket': return await registerTicket(req, res, sql);
      case 'ticketStatus': return await ticketStatus(req, res, sql);
      case 'finishSession': return await finishSession(req, res, sql);
      case 'cancelSession': return await cancelSession(req, res, sql);
      case 'adminSummary': return await adminSummary(req, res, sql);
      case 'adminData': return await adminData(req, res, sql);
      case 'adminExport': return await adminExport(req, res, sql);
      case 'resetTraining': return await resetTraining(req, res, sql);
      default: return send(res, 404, { success:false, message:'APIが見つかりません。' });
    }
  } catch (error) {
    console.error(action, error);
    return send(res, error.statusCode || 500, { success:false, message:error.publicMessage || 'サーバーでエラーが発生しました。' });
  }
}

function database() {
  if (!process.env.DATABASE_URL) throw publicError(503, 'データベースが未設定です。VercelでNeonを接続してください。');
  return neon(process.env.DATABASE_URL);
}

async function setup(req, res, sql) {
  requireMethod(req, 'POST');
  requireSecret(req.headers['x-setup-token'], process.env.SETUP_TOKEN, 'セットアップトークンが違います。');
  const schema = fs.readFileSync(`${process.cwd()}/db/schema.sql`, 'utf8');
  for (const statement of schema.split(';').map(value => value.trim()).filter(Boolean)) await sql.query(statement);

  const stores = Array.isArray(req.body?.stores) ? req.body.stores : [];
  const tickets = Array.isArray(req.body?.tickets) ? req.body.tickets : [];
  if (stores.length > 200 || tickets.length > 500) throw publicError(400, '1回に送信できるデータ件数を超えています。');
  if (stores.length) await sql.query(`
      INSERT INTO stores (store_id, store_name, is_active)
      SELECT x."storeId", x."storeName", x."isActive"
      FROM json_to_recordset($1::json) AS x("storeId" text, "storeName" text, "isActive" boolean)
      ON CONFLICT (store_id) DO UPDATE SET store_name=EXCLUDED.store_name, is_active=EXCLUDED.is_active
    `, [JSON.stringify(stores)]);
  if (tickets.length) {
    if (tickets.some(ticket => !ID_PATTERN.test(String(ticket.managementId || '')) || !Number.isInteger(ticket.amount) || ticket.amount < 0)) throw publicError(400, '商品券データが不正です。');
    await sql.query(`
      INSERT INTO tickets (management_id, category, source_id, serial_no, recipient, amount)
      SELECT x."managementId", x.category, x."sourceId", x.serial, x.recipient, x.amount
      FROM json_to_recordset($1::json) AS x("managementId" text, category text, "sourceId" text, serial text, recipient text, amount integer)
      ON CONFLICT (management_id) DO UPDATE SET
        category=EXCLUDED.category, source_id=EXCLUDED.source_id, serial_no=EXCLUDED.serial_no,
        recipient=EXCLUDED.recipient, amount=EXCLUDED.amount
    `, [JSON.stringify(tickets)]);
  }
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM tickets`;
  const [{ store_count:storeCount }] = await sql`SELECT count(*)::int AS store_count FROM stores`;
  return send(res, 200, { success:true, ticketCount:count, storeCount });
}

async function listStores(req, res, sql) {
  requireMethod(req, 'GET');
  const rows = await sql`SELECT store_id, store_name FROM stores WHERE is_active=true ORDER BY store_id`;
  return send(res, 200, { success:true, environment:isTraining()?'training':'production', stores:rows.map(row => ({ id:row.store_id, name:row.store_name })) });
}

async function startSession(req, res, sql) {
  requireMethod(req, 'POST');
  const staffName = String(req.body?.staffName || '').trim();
  const storeId = String(req.body?.storeId || '').trim();
  if (!staffName || staffName.length > 50 || !storeId) return send(res, 400, { success:false, status:'invalid_selection' });
  const [store] = await sql`SELECT store_id, store_name FROM stores WHERE store_id=${storeId} AND is_active=true`;
  if (!store) return send(res, 400, { success:false, status:'invalid_selection' });
  const active = await getActiveSession(sql, storeId);
  if (active) return activeSessionResponse(res, active, staffName, sql);

  const [{ sequence }] = await sql`SELECT nextval('session_number_seq')::bigint::text AS sequence`;
  const processId = `${dateKeyTokyo()}-${String(sequence).padStart(5,'0')}`;
  try {
    const [session] = await sql`
      INSERT INTO sessions (process_id,store_id,store_name,staff_name)
      VALUES (${processId},${storeId},${store.store_name},${staffName})
      RETURNING process_id,store_name,staff_name,started_at
    `;
    return send(res, 200, { success:true, status:'started', processId:session.process_id, storeName:session.store_name, staffName:session.staff_name, startedAt:formatDate(session.started_at), count:0, totalAmount:0 });
  } catch (error) {
    if (error.code !== '23505') throw error;
    const raced = await getActiveSession(sql, storeId);
    if (!raced) throw error;
    return activeSessionResponse(res, raced, staffName, sql);
  }
}

async function getActiveSession(sql, storeId) {
  const [row] = await sql`SELECT process_id,store_name,staff_name FROM sessions WHERE store_id=${storeId} AND status='処理中' ORDER BY started_at DESC LIMIT 1`;
  return row;
}

async function activeSessionResponse(res, active, staffName, sql) {
  if (active.staff_name !== staffName) return send(res, 200, { success:false, status:'store_in_use', processId:active.process_id, staffName:active.staff_name });
  const [totals] = await sql`SELECT count(*)::int AS count,coalesce(sum(amount),0)::int AS total FROM usage_logs WHERE process_id=${active.process_id}`;
  return send(res, 200, { success:true, status:'resumed', processId:active.process_id, storeName:active.store_name, staffName:active.staff_name, count:totals.count, totalAmount:totals.total });
}

async function registerTicket(req, res, sql) {
  requireMethod(req, 'POST');
  const managementId = normalizeId(req.body?.managementId);
  const processId = String(req.body?.processId || '');
  if (!ID_PATTERN.test(managementId)) return send(res, 200, { success:false, status:'invalid' });
  if (!processId) return send(res, 200, { success:false, status:'invalid_session' });
  const rows = await sql.query(`
    WITH active_session AS (
      SELECT process_id,store_name,staff_name FROM sessions WHERE process_id=$2 AND status='処理中'
    ), updated AS (
      UPDATE tickets t SET status='使用済み',used_store=s.store_name,used_at=now(),confirmed_by=s.staff_name,process_id=s.process_id
      FROM active_session s WHERE t.management_id=$1 AND t.status='未使用'
      RETURNING t.management_id,t.amount,t.used_store,t.used_at,t.confirmed_by,t.process_id
    ), logged AS (
      INSERT INTO usage_logs (used_at,management_id,amount,store_name,confirmed_by,process_id)
      SELECT used_at,management_id,amount,used_store,confirmed_by,process_id FROM updated RETURNING id
    )
    SELECT u.management_id,u.amount,u.used_at FROM updated u CROSS JOIN logged
  `, [managementId, processId]);
  if (rows[0]) return send(res, 200, { success:true, status:'registered', managementId:rows[0].management_id, amount:rows[0].amount, registeredAt:formatDate(rows[0].used_at) });
  return send(res, 200, await resolveTicketStatus(sql, managementId, processId, false));
}

async function ticketStatus(req, res, sql) {
  requireMethod(req, 'POST');
  const managementId = normalizeId(req.body?.managementId);
  if (!ID_PATTERN.test(managementId)) return send(res, 200, { success:false, status:'invalid' });
  return send(res, 200, await resolveTicketStatus(sql, managementId, String(req.body?.processId || ''), true));
}

async function resolveTicketStatus(sql, managementId, processId, allowReconcile) {
  const [session] = await sql`SELECT status FROM sessions WHERE process_id=${processId}`;
  if (!session) return { success:false, status:'invalid_session' };
  if (session.status !== '処理中' && session.status !== '完了') return { success:false, status:'session_closed' };
  const [ticket] = await sql`SELECT management_id,amount,status,used_store,used_at,confirmed_by,process_id FROM tickets WHERE management_id=${managementId}`;
  if (!ticket) return { success:false, status:'not_found', managementId };
  if (ticket.status !== '使用済み') return { success:false, status:'unused', managementId };
  if (ticket.process_id === processId && allowReconcile) return { success:true, status:'registered', reconciled:true, managementId, amount:ticket.amount };
  return { success:false, status:'already_used', managementId, usedStore:ticket.used_store, usedAt:formatDate(ticket.used_at), usedBy:ticket.confirmed_by, processId:ticket.process_id };
}

async function finishSession(req, res, sql) {
  requireMethod(req, 'POST');
  const processId = String(req.body?.processId || '');
  const [session] = await sql.query(`
    UPDATE sessions SET finished_at=now(),
      ticket_count=(SELECT count(*)::int FROM usage_logs WHERE process_id=$1),
      total_amount=(SELECT coalesce(sum(amount),0)::int FROM usage_logs WHERE process_id=$1),status='完了'
    WHERE process_id=$1 AND status='処理中'
    RETURNING process_id,store_name,staff_name,finished_at,ticket_count,total_amount,status
  `, [processId]);
  if (session) return send(res, 200, sessionResponse(session));
  const [existing] = await sql`SELECT process_id,store_name,staff_name,finished_at,ticket_count,total_amount,status FROM sessions WHERE process_id=${processId}`;
  if (existing?.status === '完了') return send(res, 200, sessionResponse(existing));
  return send(res, 404, { success:false, status:'invalid_session' });
}

async function cancelSession(req, res, sql) {
  requireMethod(req, 'POST');
  const processId = String(req.body?.processId || '');
  const [totals] = await sql`SELECT count(*)::int AS count,coalesce(sum(amount),0)::int AS total FROM usage_logs WHERE process_id=${processId}`;
  if (totals.count > 0) return send(res, 200, { success:false, status:'has_registered_tickets', count:totals.count, totalAmount:totals.total });
  const [session] = await sql`UPDATE sessions SET finished_at=now(),status='取消' WHERE process_id=${processId} AND status='処理中' RETURNING process_id`;
  if (session) return send(res, 200, { success:true, status:'cancelled', processId });
  const [existing] = await sql`SELECT status FROM sessions WHERE process_id=${processId}`;
  return send(res, 200, existing?.status === '取消' ? { success:true,status:'cancelled',processId } : { success:false,status:'session_closed' });
}

async function adminSummary(req, res, sql) {
  requireAdmin(req);
  const [row] = await sql`SELECT count(*)::int AS ticket_count,count(*) FILTER (WHERE status='使用済み')::int AS used_count,coalesce(sum(amount) FILTER (WHERE status='使用済み'),0)::int AS used_amount FROM tickets`;
  return send(res, 200, { success:true, environment:isTraining()?'training':'production', ticketCount:row.ticket_count, usedCount:row.used_count, usedAmount:row.used_amount });
}

async function resetTraining(req, res, sql) {
  requireMethod(req, 'POST');
  requireAdmin(req);
  if (!isTraining()) throw publicError(403, '本番環境は初期化できません。');
  await sql`UPDATE tickets SET status='未使用',used_store=NULL,used_at=NULL,confirmed_by=NULL,process_id=NULL`;
  await sql`DELETE FROM usage_logs`;
  await sql`DELETE FROM cancellations`;
  await sql`DELETE FROM sessions`;
  await sql`ALTER SEQUENCE session_number_seq RESTART WITH 1`;
  const [row] = await sql`SELECT count(*)::int AS ticket_count FROM tickets`;
  return send(res, 200, { success:true, ticketCount:row.ticket_count, message:'練習データを初期化しました。' });
}

async function adminData(req, res, sql) {
  requireMethod(req, 'GET');
  requireAdmin(req);
  const config = tableConfig(req.query?.table);
  const query = String(req.query?.q || '').trim().slice(0,100);
  const pageSize = Math.min(Math.max(Number(req.query?.pageSize)||100,1),200);
  const page = Math.max(Number(req.query?.page)||1,1);
  const where = query ? `WHERE ${config.search} ILIKE $1` : '';
  const params = query ? [`%${query}%`] : [];
  const countRows = await sql.query(`SELECT count(*)::int AS total FROM ${config.from} ${where}`, params);
  const offset = (page-1)*pageSize;
  const select = config.columns.map(column => column[0]).join(',');
  const rows = await sql.query(`SELECT ${select} FROM ${config.from} ${where} ORDER BY ${config.order} LIMIT $${params.length+1} OFFSET $${params.length+2}`, [...params,pageSize,offset]);
  return send(res, 200, { success:true, columns:config.columns.map(([key,label,type='text'])=>({key,label,type})), rows, total:countRows[0].total, page, pageSize });
}

async function adminExport(req, res, sql) {
  requireMethod(req, 'GET');
  requireAdmin(req);
  const config = tableConfig(req.query?.table);
  const query = String(req.query?.q || '').trim().slice(0,100);
  const where = query ? `WHERE ${config.search} ILIKE $1` : '';
  const select = config.columns.map(column => column[0]).join(',');
  const rows = await sql.query(`SELECT ${select} FROM ${config.from} ${where} ORDER BY ${config.order}`, query?[`%${query}%`]:[]);
  const isTsv = req.query?.format === 'tsv';
  const separator = isTsv ? '\t' : ',';
  const encode = isTsv ? tsvCell : csvCell;
  const lines = [config.columns.map(column=>encode(column[1])).join(separator)];
  for (const row of rows) lines.push(config.columns.map(([key,,type='text'])=>encode(exportValue(row[key],type))).join(separator));
  if (isTsv) {
    res.setHeader('content-type','text/tab-separated-values; charset=utf-8');
    return res.status(200).send(lines.join('\r\n'));
  }
  const filename = encodeURIComponent(`${config.label}.csv`);
  res.setHeader('content-type','text/csv; charset=utf-8');
  res.setHeader('content-disposition',`attachment; filename*=UTF-8''${filename}`);
  res.status(200).send(`\ufeff${lines.join('\r\n')}`);
}

function tableConfig(name) {
  const config = TABLES[String(name || '')];
  if (!config) throw publicError(400, 'データ種類が不正です。');
  return config;
}
function sessionResponse(session) { return { success:true,status:'completed',processId:session.process_id,storeName:session.store_name,staffName:session.staff_name,finishedAt:formatDate(session.finished_at),count:session.ticket_count,totalAmount:session.total_amount }; }
function normalizeId(value) { return String(value ?? '').trim().toLowerCase(); }
function isTraining() { return process.env.APP_ENV === 'training'; }
function dateKeyTokyo() { const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const value=type=>parts.find(part=>part.type===type).value;return `${value('year')}${value('month')}${value('day')}`; }
function formatDate(value) { return value ? new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value)).replace(/\//g,'/') : ''; }
function exportValue(value,type) { if(value==null)return '';if(type==='date')return formatDate(value);if(type==='boolean')return value?'有効':'無効';return value; }
function csvCell(value) { const text=String(value??'');return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text; }
function tsvCell(value) { return String(value??'').replace(/[\t\r\n]+/g,' '); }
function requireAdmin(req) { requireSecret(req.headers['x-admin-pin'], process.env.ADMIN_PIN, '管理者PINが違います。'); }
function requireSecret(actual, expected, message) { if(!expected)throw publicError(503,'サーバーの認証設定がありません。');const a=Buffer.from(String(actual||''));const b=Buffer.from(String(expected));if(a.length!==b.length||!timingSafeEqual(a,b))throw publicError(401,message); }
function requireMethod(req, method) { if(req.method!==method)throw publicError(405,`${method}でアクセスしてください。`); }
function publicError(statusCode, publicMessage) { const error=new Error(publicMessage);error.statusCode=statusCode;error.publicMessage=publicMessage;return error; }
function send(res,status,data) { res.setHeader('cache-control','no-store');return res.status(status).json(data); }
function setSecurityHeaders(res) { res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','same-origin'); }

export const __test = { normalizeId, isTraining, dateKeyTokyo, formatDate, csvCell, tsvCell, exportValue, TABLES };
