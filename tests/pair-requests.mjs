import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const migration = async (name) => readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
const repair = await migration('202609190002_repair_pair_requests');
const improvements = await migration('202609200001_product_improvements');
const db = new PGlite();
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function asUser(n) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid(n)]);
  await db.exec('set role authenticated');
}
const scalar = async (sql, args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
const fails = (sql,args=[]) => assert.rejects(()=>db.query(sql,args));
try {
  await db.exec("create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;");
  await db.exec(await migration('202609140001_hadzar'));
  // The reported production state: base schema exists but the request migration does not.
  await db.exec(repair);
  await db.exec(improvements);
  await db.exec(repair);
  for (let n=1;n<=16;n++) {
    await db.query('insert into auth.users values($1)',[uid(n)]);
    await db.query('insert into public.profiles(id,name,nickname) values($1,$2,$3)',[uid(n),`Person ${n}`,`person_${n}`]);
  }
  for (const [a,b,soloA,soloB] of [[1,2,false,false],[3,4,true,false],[5,6,false,true],[7,8,true,true]]) {
    await asUser(a);
    let retained = soloA ? await scalar('select public.create_pair()') : null;
    await asUser(b);
    const previous = soloB ? await scalar('select public.create_pair()') : null;
    if (!retained) retained = previous;
    if (soloA && soloB) {
      await db.query("insert into public.notes(couple_id,author_id,title) values($1,$2,'Keep this note')",[previous,uid(b)]);
      await db.query("insert into public.messages(couple_id,sender_id,body) values($1,$2,'Keep this message')",[previous,uid(b)]);
      await db.query("insert into public.events(couple_id,user_id,day,title,start_min,end_min) values($1,$2,'2026-09-20','Keep this event',600,660)",[previous,uid(b)]);
      await db.query("insert into public.schedule_days values($1,$2,'2026-09-20')",[previous,uid(b)]);
      await db.query("select public.add_task('Keep this task','',$1,now()+interval '1 day',1000)",[uid(b)]);
    }
    const before = {};
    for (const table of ['notes','messages','tasks','events','schedule_days']) before[table]=(await db.query(`select * from public.${table}`)).rows;
    await asUser(a);
    const request = await scalar('select public.send_pair_request($1)',[` @PERSON_${b} `]);
    assert.equal(await scalar('select public.send_pair_request($1)',[`person_${b}`]),request,'Duplicate send is idempotent');
    await fails('select public.accept_pair_request($1)',[request]);
    await asUser(16);
    assert.equal(await scalar('select count(*) from public.pair_requests'),0,'Requests are private');
    await fails('select public.accept_pair_request($1)',[request]);
    await fails('select public.decline_pair_request($1)',[request]);
    await asUser(b);
    const pair = await scalar('select public.accept_pair_request($1)',[request]);
    if(retained) assert.equal(pair,retained);
    assert.equal(await scalar('select public.accept_pair_request($1)',[request]),pair,'Retry acceptance is idempotent');
    assert.equal(await scalar('select count(*) from public.couples'),1);
    assert.equal(await scalar('select count(*) from public.profiles'),2);
    for(const table of Object.keys(before)) {
      assert.deepEqual((await db.query(`select * from public.${table}`)).rows,before[table].map(r=>({...r,couple_id:pair})),`${table}: content survives merging`);
    }
    await fails('select public.send_pair_request($1)',['person_16']);
  }
  // Decline, stale requests, invitation invalidation, and cleanup for BOTH people.
  await asUser(9);
  await scalar('select public.create_pair()');
  const oldInviteA = await scalar('select public.create_invitation()');
  await fails('select public.send_pair_request($1)',['person_9']);
  await fails('select public.send_pair_request($1)',['does_not_exist']);
  await fails('select public.send_pair_request($1)',['person_1']);
  const declined = await scalar('select public.send_pair_request($1)',['person_10']);
  await asUser(10);
  await scalar('select public.create_pair()');
  const oldInviteB = await scalar('select public.create_invitation()');
  await db.query('select public.decline_pair_request($1)',[declined]);
  await fails('select public.accept_pair_request($1)',[declined]);
  await asUser(9);
  const accepted = await scalar('select public.send_pair_request($1)',['person_10']);
  await scalar('select public.send_pair_request($1)',['person_11']);
  await asUser(10);
  await scalar('select public.send_pair_request($1)',['person_9']);
  await asUser(11);
  await scalar('select public.send_pair_request($1)',['person_10']);
  await asUser(10);
  await scalar('select public.accept_pair_request($1)',[accepted]);
  await asUser(9);
  assert.equal(await scalar("select count(*) from public.pair_requests where status='pending'"),0);
  await asUser(10);
  assert.equal(await scalar("select count(*) from public.pair_requests where status='pending'"),0);
  await asUser(11);
  await fails('select public.join_pair($1)',[oldInviteA]);
  await fails('select public.join_pair($1)',[oldInviteB]);
  // Link invitations also work after the invitee creates a solo workspace.
  await asUser(12);
  const linkPair = await scalar('select public.create_pair()');
  const code = await scalar('select public.create_invitation()');
  await asUser(13);
  const solo = await scalar('select public.create_pair()');
  await db.query("insert into public.notes(couple_id,author_id,title) values($1,$2,'Link join note')",[solo,uid(13)]);
  assert.equal(await scalar('select public.join_pair($1)',[code]),linkPair);
  assert.equal(await scalar('select title from public.notes'),'Link join note');
  // A failed timezone merge must preserve both spaces and the pending request.
  await asUser(14);
  await scalar('select public.create_pair()');
  const tzRequest = await scalar('select public.send_pair_request($1)',['person_15']);
  await asUser(15);
  const tzSpace = await scalar('select public.create_pair()');
  await db.query("select public.save_pair_settings('UTC',480,1320,30,0,2500)");
  await db.query("insert into public.events(couple_id,user_id,day,title,start_min,end_min) values($1,$2,'2026-09-20','UTC event',600,660)",[tzSpace,uid(15)]);
  await fails('select public.accept_pair_request($1)',[tzRequest]);
  assert.equal(await scalar('select id from public.couples'),tzSpace);
  assert.equal(await scalar('select title from public.events'),'UTC event');
  assert.equal(await scalar('select status from public.pair_requests'), 'pending');
  await db.exec('reset role');
  assert.equal((await db.query('select id from (select member_one as id from public.couples union all select member_two from public.couples where member_two is not null) x group by id having count(*)>1')).rows.length,0);
  await db.exec(repair);
  await db.exec('set role anon');
  await fails('select * from public.pair_requests');
  await fails('select public.send_pair_request($1)',['person_16']);
  await fails('select private.connect_pair($1,$2)',[uid(15),uid(16)]);
  console.log('PASS: missing migration repair/rerun, all four account states, preserved content, RLS, consent, duplicate sends, declines, cleanup, invitation merge, timezone rollback.');
} catch(e) {
  console.error(e.message, e.where || '');
  process.exitCode=1;
} finally {await db.close();}
