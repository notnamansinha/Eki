import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getDatabase, type Database, type Query, type Reference } from "firebase-admin/database";
import { WorkerFence } from "./lib/workerFence";
import { createStaleBusSweeper } from "./services/staleBusSweeper";
const integration = process.env.FIREBASE_RULES_TEST === "1" ? describe : describe.skip;
integration("R19 indexed stale pages on the actual loopback RTDB emulator", () => {
  let app: App; let readerApp: App; let realtime: Database; let source: Reference; let reader: Reference;
  const keys = new Set<string>();
  const key = (name: string) => { const value = `r19_${name}_r19`; keys.add(value); return value; };
  beforeAll(() => {
    const host = process.env.FIREBASE_DATABASE_EMULATOR_HOST;
    if (!host || !/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host)) throw new Error("Loopback RTDB emulator required");
    app = initializeApp({ projectId: "eki-rules-test", databaseURL: "https://eki-rules-test-default-rtdb.firebaseio.com",
      credential: { getAccessToken: async () => ({ access_token: "owner", expires_in: 3600 }) } }, "r19-indexed-scan");
    readerApp = initializeApp({ projectId: "eki-rules-test", databaseURL: "https://eki-rules-test-default-rtdb.firebaseio.com",
      credential: { getAccessToken: async () => ({ access_token: "owner", expires_in: 3600 }) } }, "r19-indexed-reader");
    realtime = getDatabase(app); source = realtime.ref("activeBuses"); reader = getDatabase(readerApp).ref("activeBuses");
  });
  afterAll(async () => { if (source) await source.update(Object.fromEntries([...keys].map(k => [k,null]))); if (readerApp) await deleteApp(readerApp); if (app) await deleteApp(app); });
  it("excludes fresh payloads, preserves stale rides and traverses deleted timestamp ties within page/write bounds", async () => {
    const now=Date.now(); const timestamp=now-60_000; const seed: Record<string, any> = {};
    const fields = (busId: string, at: number) => ({busId,routeId:"r19",timestamp:at,seq:1,lat:23,lng:72,status:"offline",
      routeMatchHistory:Array.from({length:4},(_,i)=>({lat:23+i*.00001,lng:72,sampledAt:at-i*1000,seq:i}))});
    for(let i=0;i<1000;i++) seed[key(`fresh_${i}`)] = fields(`r19_fresh_${i}`,now);
    for(let i=0;i<52;i++) seed[key(`old_${String(i).padStart(3,"0")}`)] = fields(`r19_old_${i}`,timestamp);
    for(let i=0;i<5;i++) seed[key(`active_${i}`)] = {...fields(`r19_active_${i}`,timestamp), status:"active",tripState:"in_service",sessionId:`s${i}`,deviceState:"online"};
    await source.update(seed);
    const baseline=(await source.once("value")).val();
    const bytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value));
    let pageBytes=0; const received=new Set<string>();
    const wrap=(query: Query): any => ({
      startAt:(value:number)=>wrap(query.startAt(value)), startAfter:(value:number,k:string)=>wrap(query.startAfter(value,k)),
      endAt:(value:number)=>wrap(query.endAt(value)), limitToFirst:(limit:number)=>{expect(limit).toBe(25);return wrap(query.limitToFirst(limit));},
      once:async()=>{const page=await query.once("value");pageBytes+=bytes(page.val());page.forEach(child=>{received.add(child.key!);});return page;},
    });
    const observed={orderByChild:(field:string)=>{expect(field).toBe("timestamp");return wrap(reader.orderByChild(field));}} as unknown as Reference;
    const errors: unknown[]=[]; const sweeper=createStaleBusSweeper(observed,10_000,error=>errors.push(error),()=>now);
    const fence=new WorkerFence("r19",1,performance.now()+60_000);
    for(let page=0;page<4;page++) await fence.run(()=>sweeper.tick());
    expect(errors).toEqual([]);
    expect(sweeper.snapshot()).toMatchObject({removed:52,markedOffline:5,examined:57,cycles:1,maxPageRecords:25,maxActiveWrites:4});
    expect([...received].some(k=>k.includes("_fresh_"))).toBe(false);
    expect(pageBytes).toBeLessThan(bytes(baseline)*.1);
    expect((await source.child(key("active_0")).once("value")).val()).toMatchObject({sessionId:"s0",deviceState:"offline",status:"active"});
    process.stdout.write(`R19_STALE_MEASUREMENT ${JSON.stringify({sourceRecords:Object.keys(baseline).length,baselineBytes:bytes(baseline),pageBytes,...sweeper.snapshot()})}\n`);
  },30_000);
  it("does not delete an armed replacement session with the same stale timestamp", async () => {
    const id=key("race"); const timestamp=Date.now()-60_000;
    await source.child(id).set({busId:"r19_race",routeId:"r19",timestamp,status:"offline",tripState:"completed",sessionId:"old"});
    let replaced=false;
    const wrap=(query:Query):any=>({
      startAt:(value:number)=>wrap(query.startAt(value)),startAfter:(value:number,k:string)=>wrap(query.startAfter(value,k)),
      endAt:(value:number)=>wrap(query.endAt(value)),limitToFirst:(n:number)=>wrap(query.limitToFirst(n)),
      once:async()=>{const page=await query.once("value"); if(!replaced){replaced=true;await source.child(id).update({status:"active",tripState:"pre_departure",sessionId:"new",deviceState:"online"});} return page;},
    });
    const observed={orderByChild:(field:string)=>wrap(reader.orderByChild(field))} as unknown as Reference;
    const sweeper=createStaleBusSweeper(observed,10_000,error=>{throw error;});
    await new WorkerFence("r19",2,performance.now()+10_000).run(()=>sweeper.tick());
    expect((await source.child(id).once("value")).val()).toMatchObject({sessionId:"new",status:"active",tripState:"pre_departure",deviceState:"online"});
    expect(sweeper.snapshot().aborted).toBeGreaterThanOrEqual(1);
  });
});
