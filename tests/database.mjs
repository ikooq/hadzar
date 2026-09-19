import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(
  `create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`,
);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/202609140001_hadzar.sql", import.meta.url),
    "utf8",
  ),
);
await db.exec(
  await readFile(
    new URL("../supabase/migrations/202609190001_pair_requests.sql", import.meta.url),
    "utf8",
  ),
);
const ids = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
  "66666666-6666-4666-8666-666666666666",
];
for (let i = 0; i < ids.length; i++) {
  await db.query("insert into auth.users values($1)", [ids[i]]);
  await db.query(
    "insert into public.profiles(id,name,nickname) values($1,$2,$3)",
    [ids[i], `Person ${i}`, `person_${i}`],
  );
}
async function asUser(id) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec("set role authenticated");
}
async function fails(sql, args = []) {
  await assert.rejects(() => db.query(sql, args));
}
await asUser(ids[0]);
const pair = (await db.query("select public.create_pair() as id")).rows[0].id;
await fails("select public.create_pair()");
const invite = (await db.query("select public.create_invitation() as code"))
  .rows[0].code;
await asUser(ids[1]);
assert.equal(
  (await db.query("select public.join_pair($1) as id", [invite])).rows[0].id,
  pair,
);
assert.equal((await db.query("select * from public.profiles")).rows.length, 2);
await fails("select public.create_pair()");
await asUser(ids[2]);
await fails("select public.join_pair($1)", [invite]);
assert.equal((await db.query("select * from public.couples")).rows.length, 0);
await db.query("select public.create_pair() as id");
await fails(
  "insert into public.notes(couple_id,author_id,title) values($1,$2,'intrusion')",
  [pair, ids[2]],
);
await asUser(ids[0]);
await db.query(
  "insert into public.notes(couple_id,author_id,title) values($1,$2,'Private note')",
  [pair, ids[0]],
);
await db.query(
  "insert into public.messages(couple_id,sender_id,body) values($1,$2,'Private message')",
  [pair, ids[0]],
);
await fails(
  "insert into public.messages(couple_id,sender_id,body) values($1,$2,'Impersonation')",
  [pair, ids[1]],
);
await fails("update public.couples set member_two=$1 where id=$2", [
  ids[2],
  pair,
]);
const task = (
  await db.query(
    "select public.add_task('A promise','', $1,now()+interval '1 day',2500) as id",
    [ids[1]],
  )
).rows[0].id;
assert.equal(
  (await db.query("select accepted_at from public.tasks where id=$1", [task]))
    .rows[0].accepted_at,
  null,
);
await fails("select public.act_on_task($1,'accept')", [task]);
await fails("update public.tasks set penalty=0 where id=$1", [task]);
await asUser(ids[1]);
await fails("select public.act_on_task($1,'complete')", [task]);
await db.query("select public.act_on_task($1,'accept')", [task]);
await db.query("select public.act_on_task($1,'complete')", [task]);
await fails("select public.act_on_task($1,'paid')", [task]);
await asUser(ids[2]);
for (const table of ["notes", "messages", "tasks", "events"])
  assert.equal(
    (await db.query(`select * from public.${table}`)).rows.length,
    0,
    `${table} must be isolated`,
  );
await fails("select public.act_on_task($1,'complete')", [task]);
await fails(
  "select public.add_task('Wrong pair','',$1,now()+interval '1 day',1000)",
  [ids[0]],
);
await asUser(ids[0]);
await fails("select public.plan_window('2026-09-15',810,900,'Lunch')");
await db.query("insert into public.schedule_days values($1,$2,'2026-09-15')", [
  pair,
  ids[0],
]);
await asUser(ids[1]);
await db.query("insert into public.schedule_days values($1,$2,'2026-09-15')", [
  pair,
  ids[1],
]);
await db.query("select public.plan_window('2026-09-15',810,900,'Lunch')");
await fails("select public.plan_window('2026-09-15',810,900,'Duplicate')");
await asUser(ids[0]);
await db.query(
  "select public.save_pair_settings($1,480,1320,45,15,3000)",
  ["Asia/Almaty"],
);
assert.equal(
  (await db.query("select minimum_window from public.couples")).rows[0]
    .minimum_window,
  45,
);
await fails(
  "select public.save_pair_settings('Invalid/Zone',480,1320,30,0,2500)",
);
await asUser(ids[2]);
const code1 = (await db.query("select public.create_invitation() as code"))
  .rows[0].code;
const code2 = (await db.query("select public.create_invitation() as code"))
  .rows[0].code;
await asUser(ids[3]);
await fails("select public.join_pair($1)", [code1]);
await db.query("select public.join_pair($1)", [code2]);
await asUser(ids[4]);
await db.query("select public.create_pair()");
await db.query("select public.send_pair_request($1)", ["person_5"]);
await asUser(ids[5]);
const request = (
  await db.query("select * from public.pair_requests where status='pending'")
).rows[0];
assert.equal(request.sender_id, ids[4]);
assert.equal(request.recipient_id, ids[5]);
await db.query("select public.accept_pair_request($1)", [request.id]);
assert.equal(
  (
    await db.query(
      "select member_one,member_two from public.couples where member_one=$1 or member_two=$1",
      [ids[4]],
    )
  ).rows[0].member_two,
  ids[5],
);
assert.equal(
  (await db.query("select status from public.pair_requests where id=$1", [request.id]))
    .rows[0].status,
  "accepted",
);
await db.exec("reset role; set role anon");
await fails("select * from public.notes");
await fails("select public.create_pair()");
await db.close();
console.log(
  "PASS: migrations, pair creation, nickname requests, request acceptance, single-use/rotated invitations, profile visibility, cross-pair isolation, impersonation prevention, task acceptance/ownership, payment guard, schedule confirmation, overlap prevention, settings validation, anonymous access.",
);
