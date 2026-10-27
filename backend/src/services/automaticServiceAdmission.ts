import { FieldValue, type Transaction } from "firebase-admin/firestore";
import { db, rtdb } from "../lib/firebaseAdmin";
import { endpointSnapshotVersion } from "../lib/endpointSnapshotVersion";
import { BoundedKeyedExecutor } from "../lib/boundedKeyedExecutor";
import { startAssignedService, RideSessionStartError, SessionCreationConflict } from "./rideSessionStart";
import { recordBackgroundFailure } from "../lib/backgroundFailureTracker";
import type { DeviceAssignment } from "./deviceTelemetryService";
import type { TelemetryPayload } from "./telemetryPayload";

type AdmissionState = "assignment_required" | "paused" | "awaiting_return" | "setup_pending";
class AdmissionBlocked extends Error {
  constructor(readonly state: AdmissionState) { super(state); }
}
const executor = new BoundedKeyedExecutor<string>({maxConcurrent:8,maxPending:128,maxPendingPerKey:1,maxQueueAgeMs:10000});
const pending = new Map<string,Promise<void>>();
const latest = new Map<string,{assignment:DeviceAssignment;sample:TelemetryPayload}>();
const invalidated = new Set<string>();
const retryAt = new Map<string,number>();
const safeId = /^[A-Za-z0-9_-]{1,128}$/;

async function publishBlocked(assignment:DeviceAssignment,state:AdmissionState) {
  await rtdb.ref(`activeBuses/${assignment.busId}_${assignment.routeId}`).transaction(value=>{
    if (!value || value.sessionId || value.busId!==assignment.busId || value.routeId!==assignment.routeId ||
        Number(value.retiredAssignmentRevision)>Number(assignment.assignmentRevision??0) ||
        value.automaticServiceState===state) return;
    return {...value,automaticServiceState:state};
  },undefined,false);
}

/**
 * How many times one attempt may re-read after a rearm. Each rearm, or each time another replica moved the bus
 * first, spends one; two covers a lost race followed by the next generation also ending early.
 */
const MAX_REARMS=2;
type Rearm="rearmed"|"raced"|"refused";

/**
 * A ride cut short without an operator pause (abandoned-ride cleanup, failure)
 * must not hold the bus paused. Moving to a fresh epoch releases the start key
 * pinned to that ride, so the next admission creates a new service. An admin's
 * "End ride early" sets automaticServicePaused and still requires Resume.
 *
 * This is a compare-and-swap on the epoch (and the return marker, when one is being released) the caller read.
 * "raced" means another replica or writer already moved that state, so the caller must re-read it rather than
 * treat the bus as paused: of several concurrent callers exactly one writes epoch + 1.
 */
async function rearmAfterEarlyEnd(busId:string,generation:number,consumedBy?:string):Promise<Rearm> {
  const ref=db.collection("bus_locations").doc(busId);
  return db.runTransaction<Rearm>(async transaction=>{
    const data=(await transaction.get(ref)).data();
    if (data?.automaticServicePaused===true) return "refused";
    if (Number(data?.automaticServiceEpoch??0)!==generation) return "raced";
    if (consumedBy!==undefined && data?.terminalJourney?.consumedBy!==consumedBy) return "raced";
    transaction.set(ref,{automaticServiceEpoch:FieldValue.increment(1),
      ...(consumedBy!==undefined?{terminalJourney:FieldValue.delete()}:{})},{merge:true});
    return "rearmed";
  });
}

async function admit(assignment:DeviceAssignment,rearms=MAX_REARMS):Promise<void> {
  if (!assignment.deviceId || !safeId.test(assignment.deviceId)) return;
  const driverQuery=db.collection("drivers").where("assignedBusId","==",assignment.busId).limit(2);
  const deviceRef=db.collection("devices").doc(assignment.deviceId);
  const busRef=db.collection("buses").doc(assignment.busId);
  const locationRef=db.collection("bus_locations").doc(assignment.busId);
  const routeRef=db.collection("routes").doc(assignment.routeId);
  const [drivers,location,route]=await Promise.all([driverQuery.get(),locationRef.get(),routeRef.get()]);
  if (drivers.size!==1) throw new AdmissionBlocked("assignment_required");
  const driverId=drivers.docs[0].id;
  const locationData=location.data();
  if (locationData?.automaticServicePaused===true) throw new AdmissionBlocked("paused");
  if (locationData?.terminalJourney) {
    const consumedBy=locationData.terminalJourney.consumedBy;
    if (typeof consumedBy==="string" && safeId.test(consumedBy)) {
      const consumed=(await db.collection("ride_sessions").doc(consumedBy).get()).data();
      if (consumed?.busId===assignment.busId && consumed?.routeId===assignment.routeId && ["failed","interrupted"].includes(consumed.status)) {
        if (rearms>0 && await rearmAfterEarlyEnd(assignment.busId,Number(locationData.automaticServiceEpoch??0),consumedBy)!=="refused")
          return admit(assignment,rearms-1);
        throw new AdmissionBlocked("paused");
      }
    }
    throw new AdmissionBlocked("awaiting_return");
  }
  const endpointVersion=endpointSnapshotVersion(route.data()?.stops);
  if (!safeId.test(driverId) || !endpointVersion) throw new AdmissionBlocked("assignment_required");
  const generation=Number(location.data()?.automaticServiceEpoch??0);
  const verify=async(transaction:Transaction)=>{
    const [currentDrivers,device,bus,currentLocation,currentRoute]=await Promise.all([
      transaction.get(driverQuery),transaction.get(deviceRef),transaction.get(busRef),transaction.get(locationRef),transaction.get(routeRef),
    ]);
    const registry=device.data(), fleet=bus.data(), lifecycle=currentLocation.data();
    const routes=fleet?.assignedRoutes??[fleet?.assignedRouteId];
    if (!device.exists || registry?.enabled===false || registry?.busId!==assignment.busId || registry?.routeId!==assignment.routeId ||
        Number(registry?.assignmentRevision??0)!==Number(assignment.assignmentRevision??0) || !bus.exists || fleet?.active===false ||
        !Array.isArray(routes) || !routes.includes(assignment.routeId) || currentDrivers.size!==1 || currentDrivers.docs[0].id!==driverId ||
        currentDrivers.docs[0].data().enabled===false || currentDrivers.docs[0].data().active===false ||
        endpointSnapshotVersion(currentRoute.data()?.stops)!==endpointVersion) throw new AdmissionBlocked("assignment_required");
    if (lifecycle?.automaticServicePaused===true || fleet?.automaticServiceEnabled===false || Number(lifecycle?.automaticServiceEpoch??0)!==generation)
      throw new AdmissionBlocked("paused");
    if (lifecycle?.terminalJourney) throw new AdmissionBlocked("awaiting_return");
  };
  try {
    await startAssignedService({busId:assignment.busId,routeId:assignment.routeId,driverId},{
      principalScope:`device:${assignment.deviceId}:${assignment.assignmentRevision??0}:${generation}`,
      idempotencyKey:"automatic-service-v1",automatic:true,assignmentRevision:assignment.assignmentRevision??0,verify,
    });
  } catch(error) {
    if (rearms>0 && error instanceof RideSessionStartError && error.reason==="interrupted_session" &&
        await rearmAfterEarlyEnd(assignment.busId,generation)!=="refused") return admit(assignment,rearms-1);
    throw error;
  }
}

function admissionKey(assignment:DeviceAssignment):string {
  return `${assignment.busId}/${assignment.routeId}/${assignment.deviceId}/${assignment.assignmentRevision??0}`;
}

/** True while an attempt is running or backing off, so callers can skip work that only leads back here. */
export function isAutomaticServiceAdmissionDeferred(assignment:DeviceAssignment):boolean {
  const key=admissionKey(assignment);
  return pending.has(key) || (retryAt.get(key)??0)>performance.now();
}

/** One bounded startup attempt per bus; fresh position publication never awaits it. */
export function scheduleAutomaticServiceAdmission(assignment:DeviceAssignment,sample:TelemetryPayload):void {
  const now=Date.now();
  if (now-sample.timestamp>60000 || sample.timestamp>now+10000 || typeof sample.gpsHdop!=="number" ||
      !Number.isFinite(sample.gpsHdop) || sample.gpsHdop<0 || sample.gpsHdop>4 || sample.motionState==="uncertain") return;
  const key=admissionKey(assignment);
  if (pending.has(key)) { latest.set(key,{assignment,sample}); return; }
  if ((retryAt.get(key)??0)>performance.now()) return;
  if (retryAt.size>=1000) retryAt.delete(retryAt.keys().next().value!);
  let admitted:Promise<void>;
  try {
    admitted=executor.run(assignment.busId,async()=>{
      try { await admit(assignment); retryAt.delete(key); }
      catch(error) {
        if (!invalidated.has(key)) retryAt.set(key,performance.now()+30000);
        if (error instanceof SessionCreationConflict) {
          // A fresh accepted fix is the bounded retry trigger for an interrupted
          // projection. Configuration backoff must not discard that repair fix.
          retryAt.delete(key);
        }
        if (error instanceof AdmissionBlocked) await publishBlocked(assignment,error.state);
        else if (error instanceof RideSessionStartError || error instanceof SessionCreationConflict) {
          console.warn("[Devices] Automatic service setup pending:",error.message);
          await publishBlocked(assignment,error instanceof RideSessionStartError && (error.reason==="terminal_session" || error.reason==="interrupted_session") ? "paused" : "setup_pending");
        }
        else throw error;
      }
    });
  } catch(error) {
    retryAt.set(key,performance.now()+2000);
    recordBackgroundFailure("devices.automaticService","Automatic service setup","[Devices] Automatic service admission rejected:",error);
    return;
  }
  const work=admitted.catch(error=>{
    retryAt.set(key,performance.now()+2000);
    recordBackgroundFailure("devices.automaticService","Automatic service setup","[Devices] Automatic service setup failed:",error);
  }).finally(()=>{
    if(pending.get(key)===work)pending.delete(key);
    invalidated.delete(key);
    const next=latest.get(key);latest.delete(key);
    if(next)scheduleAutomaticServiceAdmission(next.assignment,next.sample);
  });
  pending.set(key,work);
}

export async function drainAutomaticServiceAdmission():Promise<void> {
  while(pending.size) await Promise.allSettled([...pending.values()]);
}

/** Registry invalidation also releases a blocked setup retry after configuration repair. */
export function invalidateAutomaticServiceAdmission(deviceId:string):void {
  for(const key of retryAt.keys()) if(key.split("/")[2]===deviceId) retryAt.delete(key);
  for(const key of pending.keys()) if(key.split("/")[2]===deviceId) invalidated.add(key);
}
