import { describe, expect, it } from "vitest";
import { haversineMeters } from "../lib/geo";
import { getRouteMatchingWork, matchRoutePosition } from "./routeMatching";
import { matchRoutePosition as fullScan } from "../test-support/routeMatchingBaseline";
const cumulative = (path: {lat:number;lng:number}[]) => { const values = [0]; for(let i=1;i<path.length;i++) values.push(values[i-1]+haversineMeters(path[i-1],path[i])); return values; };
describe("R19 candidate search equivalence", () => {
  it("uses distance bounds on a dense route while preserving the full-scan answer", () => {
    const path = Array.from({length:10001}, (_,i)=>({lat:23,lng:72+i*.00001}));
    const previous = {segmentIndex:5000, alongRouteDistanceM:cumulative(path)[5000]};
    const before=getRouteMatchingWork();
    expect(matchRoutePosition(path[5000],path,90,previous,25,80)).toEqual(fullScan(path[5000],path,90,previous,25,80));
    const after=getRouteMatchingWork();
    expect(after.segmentProjections-before.segmentProjections).toBeLessThan(165);
    expect(after.boundedSearches-before.boundedSearches).toBe(1);
  });
  it("retains full search for cold/reacquisition input and invalid or absent bounds", () => {
    const path=[{lat:23,lng:72},{lat:23,lng:72.001},{lat:23.001,lng:72.001},{lat:23,lng:72}];
    const previous={segmentIndex:0,alongRouteDistanceM:0};
    const before=getRouteMatchingWork();
    for (const radius of [undefined,Infinity,NaN,-1]) expect(matchRoutePosition(path[1],path,undefined,previous,25,radius)).toEqual(fullScan(path[1],path,undefined,previous,25,radius));
    expect(matchRoutePosition(path[1],path,undefined,null,25,80)).toEqual(fullScan(path[1],path,undefined,null,25,80));
    expect(getRouteMatchingWork().fullSearches-before.fullSearches).toBe(5);
  });
  it("retains long segments spanning the progress window and zero-length boundary ties", () => {
    for (const path of [[{lat:23,lng:72},{lat:23,lng:72.1}], [{lat:23,lng:72},{lat:23,lng:72},{lat:23,lng:72.001},{lat:23,lng:72.001}]]) {
      const previous={segmentIndex:0,alongRouteDistanceM:0};
      for(const radius of [0,25,80,10000]) expect(matchRoutePosition(path[0],path,undefined,previous,25,radius)).toEqual(fullScan(path[0],path,undefined,previous,25,radius));
    }
  });
  it("matches the frozen full scan across seeded loops, crossings, parallel legs, hints and vertex densities", () => {
    let seed=24619; const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296;};
    for(let shape=0;shape<60;shape++) {
      const path=Array.from({length:201},(_,i)=>({lat:23+Math.sin(i/(shape%5+2))*.0005,
        lng:72+(shape%2 ? i*.00001 : Math.cos(i/(shape%7+2))*.0005)}));
      for(let i=15;i<path.length;i+=15) path[i]={...path[i-1]};
      const distances=cumulative(path);
      for(let sample=0;sample<25;sample++) {
        const index=Math.floor(random()*path.length); const priorIndex=Math.floor(random()*path.length);
        const point={lat:path[index].lat+(random()-.5)*.00002,lng:path[index].lng+(random()-.5)*.00002};
        const prior=random()<.15 ? null : {segmentIndex:priorIndex,alongRouteDistanceM:distances[priorIndex]};
        const radius=[0,25,80,200,Infinity,undefined][sample%6]; const heading=sample%3 ? random()*360 : undefined;
        expect(matchRoutePosition(point,path,heading,prior,25,radius),`shape ${shape}, sample ${sample}`).toEqual(fullScan(point,path,heading,prior,25,radius));
      }
    }
  });
});
