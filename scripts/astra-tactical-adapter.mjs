import { pathToFileURL } from 'node:url';
import path from 'node:path';

export async function astraAdapter(root,scenario){
  const module=relative=>import(pathToFileURL(path.join(root,'src/sim',relative)));
  const [{Vehicle},{TacticalPlanner},{PerformanceModel},{RaceStrategy}]=await Promise.all([module('vehicle.js'),module('planner.js'),module('performance.js'),module('strategy.js')]);
  // Same synthetic centreline/speed card used by the other adapters. No native
  // simulator or private race data is supplied during this tactical replay.
  const track={id:'replay',length:1000,halfWidth:8.2,wetness:0,rubber:new Float32Array(13000),
    at(s,offset=0){s=(s%1000+1000)%1000;return {s,x:offset,z:s,y:0,tx:0,tz:1,nx:1,nz:0,heading:0,curvature:scenario.corner&&s>=106?.006:.001,index:Math.floor(s)};},
    nearest(x,z){return {...this.at(z),lateral:x};},laneAt(l){return Math.max(0,Math.min(12,Math.floor((l+8.2)/16.4*13)));},
    zoneAt(l){return Math.abs(l)<8.2?'asphalt':'kerb';}};
  const line={track,at(s){return {...track.at(s),offset:0,speed:40,conservativeSpeed:40};},offsetAt:()=>0};
  const car=new Vehicle(0);car.place(track,100,-scenario.ego.lateral,scenario.ego.speed);
  const rivals=scenario.opponents.map((o,i)=>{const c=new Vehicle(i+1,o.id);c.place(track,100+o.delta,-o.lateral,o.speed);return c;});
  const model=new PerformanceModel(track);model.update(car,1/120);
  const planner=new TacticalPlanner(line,model,new RaceStrategy(0,.72));planner.age=5;planner.update(car,[car,...rivals],1/120);
  return {decision:planner.intent==='ATTACK'?'ATTACK':planner.intent==='DEFEND'?'DEFEND':'PACE',phase:planner.intent,
    targetLateral:-planner.plan.points.at(-1).offset,committed:planner.commit>0,reason:planner.reason};
}
