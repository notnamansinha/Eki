import {beforeEach,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({run:vi.fn(),start:vi.fn(),failure:vi.fn(),
  location:{} as Record<string,unknown>,consumed:{} as Record<string,unknown>,blocked:[] as unknown[]}));
vi.mock("../lib/boundedKeyedExecutor",()=>({BoundedKeyedExecutor:class {run(...args:unknown[]){return state.run(...args);}}}));
vi.mock("../lib/firebaseAdmin",()=>({db:{collection:(name:string)=>({
  where:()=>({limit:()=>({get:async()=>({size:1,docs:[{id:"driver"}]})})}),
  doc:()=>({get:async()=>({data:()=>name==="bus_locations"?state.location:name==="ride_sessions"?state.consumed:{stops:[]}})}),
}),runTransaction:async(work:(transaction:unknown)=>Promise<unknown>)=>work({
  get:async()=>({data:()=>state.location}),
  set:(_ref:unknown,data:Record<string,unknown>)=>{
    const next={...state.location,automaticServiceEpoch:Number(state.location.automaticServiceEpoch??0)+1};
    if("terminalJourney" in data)delete next.terminalJourney;
    state.location=next;
  },
})},rtdb:{ref:()=>({transaction:async(update:(value:unknown)=>unknown)=>{
  state.blocked.push(update({busId:"bus",routeId:"route"}));
}})}}));
vi.mock("../lib/endpointSnapshotVersion",()=>({endpointSnapshotVersion:()=>"route-version"}));
vi.mock("./rideSessionStart",()=>({startAssignedService:state.start,RideSessionStartError:class extends Error{constructor(readonly statusCode:number,message:string,readonly reason?:string){super(message);}},SessionCreationConflict:class extends Error{}}));
vi.mock("../lib/backgroundFailureTracker",()=>({recordBackgroundFailure:state.failure}));
const assignment={busId:"bus",routeId:"route",deviceId:"device",assignmentRevision:1};
const sample=()=>({lat:23,lng:72,speed:0,heading:0,gpsHdop:1,motionState:"stopped" as const,seq:1,timestamp:Date.now(),deviceSentAt:Date.now()});
beforeEach(()=>{vi.resetModules();vi.clearAllMocks();state.location={};state.consumed={};state.blocked=[];state.run.mockReset();state.start.mockReset();});
async function admitOnce(){
  state.run.mockImplementation((_key:string,work:()=>Promise<void>)=>work());
  const {scheduleAutomaticServiceAdmission,drainAutomaticServiceAdmission}=await import("./automaticServiceAdmission");
  const {RideSessionStartError}=await import("./rideSessionStart");
  return {RideSessionStartError,run:async()=>{scheduleAutomaticServiceAdmission(assignment,sample());await drainAutomaticServiceAdmission();}};
}
it("starts a new automatic service after cleanup interrupts the previous one",async()=>{
  const {RideSessionStartError,run}=await admitOnce();
  state.start.mockRejectedValueOnce(new RideSessionStartError(409,"ended early","interrupted_session")).mockResolvedValueOnce(undefined);
  await run();
  expect(state.start).toHaveBeenCalledTimes(2);
  expect(state.start.mock.calls[1][1].principalScope).toBe("device:device:1:1");
  expect(state.blocked).toEqual([]);
});
it("keeps an operator-ended service paused until an explicit resume",async()=>{
  const {RideSessionStartError,run}=await admitOnce();
  state.location={automaticServicePaused:true};
  state.start.mockRejectedValue(new RideSessionStartError(409,"ended early","interrupted_session"));
  await run();
  expect(state.start).not.toHaveBeenCalled();
  expect(state.blocked).toEqual([expect.objectContaining({automaticServiceState:"paused"})]);
});
it("starts a new automatic service after a consumed return ride is cut short",async()=>{
  const {run}=await admitOnce();
  state.location={terminalJourney:{consumedBy:"return_ride"}};
  state.consumed={busId:"bus",routeId:"route",status:"interrupted"};
  state.start.mockResolvedValue(undefined);
  await run();
  expect(state.location).toEqual({automaticServiceEpoch:1});
  expect(state.start).toHaveBeenCalledOnce();
});
it("handles synchronous capacity rejection without escaping telemetry background scheduling",async()=>{
  const exhausted=new Error("capacity exhausted");state.run.mockImplementation(()=>{throw exhausted;});
  const {scheduleAutomaticServiceAdmission,drainAutomaticServiceAdmission}=await import("./automaticServiceAdmission");
  expect(()=>scheduleAutomaticServiceAdmission(assignment,sample())).not.toThrow();
  await drainAutomaticServiceAdmission();
  expect(state.failure).toHaveBeenCalledWith("devices.automaticService","Automatic service setup",expect.any(String),exhausted);
  scheduleAutomaticServiceAdmission(assignment,sample());expect(state.run).toHaveBeenCalledTimes(1);
});
it("contains a synchronous capacity rejection while rescheduling the retained latest fix",async()=>{
  let finish!:()=>void;state.start.mockReturnValue(new Promise<void>(resolve=>{finish=resolve;}));
  const exhausted=new Error("reschedule capacity exhausted");
  state.run.mockImplementationOnce((_key:string,work:()=>Promise<void>)=>work()).mockImplementation(()=>{throw exhausted;});
  const {scheduleAutomaticServiceAdmission,drainAutomaticServiceAdmission}=await import("./automaticServiceAdmission");
  scheduleAutomaticServiceAdmission(assignment,sample());await vi.waitFor(()=>expect(state.start).toHaveBeenCalledOnce());
  scheduleAutomaticServiceAdmission(assignment,{...sample(),seq:2});
  const drained=drainAutomaticServiceAdmission();finish();await drained;
  expect(state.run).toHaveBeenCalledTimes(2);
  expect(state.failure).toHaveBeenCalledWith("devices.automaticService","Automatic service setup",expect.any(String),exhausted);
});
