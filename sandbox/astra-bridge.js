import { Track } from '../subjects/astra/src/sim/track.js';
import { Vehicle, wakes } from '../subjects/astra/src/sim/vehicle.js';
import { RacingLine } from '../subjects/astra/src/sim/ai.js';
import { AdaptiveDriver } from '../subjects/astra/src/sim/controller.js';

const finite=(v,f=0)=>Number.isFinite(v)?v:f;

// Host +lateral is opposite Astra +lateral; world x/z/yaw and steering agree.
// This boundary copies observed state, never advances shared physics or edits
// a pinned controller. The host remains responsible for forces and contacts.
export function syncAstraShadow(shadow,host,track){
  shadow.x=host.position.x;shadow.z=host.position.z;shadow.y=finite(host.position.y);
  shadow.yaw=host.yaw;shadow.vx=host.velocity.x;shadow.vz=host.velocity.z;
  shadow.u=shadow.vx*Math.sin(shadow.yaw)+shadow.vz*Math.cos(shadow.yaw);
  shadow.v=shadow.vx*Math.cos(shadow.yaw)-shadow.vz*Math.sin(shadow.yaw);
  shadow.speed=Math.hypot(shadow.u,shadow.v);shadow.yawRate=finite(host.yawRate);
  shadow.ax=finite(host.localAcceleration?.z);shadow.ay=finite(host.localAcceleration?.x);
  shadow.steering=finite(host.steering);shadow.pitch=finite(host.pitch);shadow.roll=finite(host.roll);
  shadow.damage=finite(host.damage);shadow.impact=finite(host.impact);shadow.gear=host.gear;shadow.rpm=host.rpm;
  shadow.aero.wake=finite(host.wake?.strength);shadow.aero.downforce=finite(host.aero?.downforceN);
  shadow.setup.brakeBias=host.electronics?.brakeBias??shadow.setup.brakeBias;
  const p=track.surface(shadow.x,shadow.z);shadow.s=p.s;shadow.lateral=p.lateral;shadow.zone=p.zone;
  Object.assign(shadow.controls,host.controls);
  host.wheels.forEach((source,i)=>{
    const w=shadow.wheels[i],t=source.tyre??source.tire??{};
    w.load=finite(source.normalLoad??source.load);w.omega=finite(source.omega);w.steer=finite(source.steerAngle);
    Object.assign(w.tyre,{core:finite(t.carcassTemperatureC,68),surface:finite(t.temperatureMiddleC,72),pressure:finite(t.pressurePa,215000)/100000,
      wear:finite(t.wear),alpha:finite(t.alpha),kappa:finite(t.kappa),fx:finite(t.lastFx),fy:finite(t.lastFy)});
  });
}

export function astraDebug(controller){
  const p=controller.planner,plan=p.plan,path=plan?.points.map(x=>({...x,q:-x.offset,targetSpeed:x.speed}))??[];
  return {state:controller.state,mode:p.intent,phase:p.intent,targetId:p.targetId,reason:p.reason,
    path,planPath:path,targetQ:-(plan?.points[3]?.offset??0),targetSpeed:controller.targetSpeed,
    minimumClearance:p.stats.clearance,terminalCost:plan?.terminalCost??0,
    frontCost:plan?.pack?.frontCost??0,rearCost:plan?.pack?.rearCost??0,
    candidateCount:p.candidates.length,rejected:p.candidates.filter(x=>x.hardConflict).length,
    controllerCadence:'120 Hz control · 25 Hz dynamic rollouts · 12.5 Hz tactics',routeKind:'Astra actual selected trajectory'};
}

export function makeAstraBridge(candidate,vehicle,hostTrack,vehicles){
  const track=new Track('harbor-ring');
  if(Math.abs(track.length-hostTrack.length)>1e-6)throw new Error('Astra/host Harbor Ring geometry mismatch');
  const shadows=vehicles.map((v,i)=>new Vehicle(i,v.name,v.color,'gt'));
  const index=vehicles.indexOf(vehicle),ego=shadows[index];
  // Map the host's declared physical specification into Astra's existing SI
  // fields. This is unit/schema conversion, not per-candidate pace tuning.
  const h=vehicle.spec;
  ego.spec=Object.freeze({...ego.spec,mass:h.mass,wheelbase:h.wheelBase,track:h.trackWidth,cg:h.cgHeight,
    frontWeight:h.weightFront,yawInertia:h.inertia.y,radius:h.wheelRadius,wheelInertia:h.wheelInertia,
    maxTorque:h.maxTorqueNm,gears:h.gearRatios,finalDrive:h.finalDrive,steeringLock:h.steeringLock,
    area:h.aero.area,cd:h.aero.cd,cl:h.aero.frontCl+h.aero.rearCl+h.aero.groundEffect,
    frontAero:h.aero.frontCl/(h.aero.frontCl+h.aero.rearCl),drive:h.drive,tyreGrip:h.tire.mu/1.48});
  const line=new RacingLine(track,ego.spec);let controller=new AdaptiveDriver(index,line,.952,.72);
  const entry={...candidate,vehicle,controller,errors:0,steps:0,
    step(dt){vehicles.forEach((v,i)=>syncAstraShadow(shadows[i],v,track));controller.update(ego,shadows,dt);
      Object.assign(vehicle.controls,ego.controls);entry.steps++;},
    debug(){return astraDebug(controller);},
    reset(){controller=new AdaptiveDriver(index,line,.952,.72);entry.controller=controller;entry.steps=0;}
  };return entry;
}

export function makeAstraNative(candidate,host,slot,candidates){
  const track=new Track('harbor-ring'),car=new Vehicle(candidates.findIndex(c=>c.id===candidate.id),candidate.label,candidate.color,'gt');
  car.place(track,slot.distance,-slot.lateral);
  const shadows=candidates.filter(c=>c.id!==candidate.id).map((c,i)=>new Vehicle(100+i,c.label,c.color));
  const field=[car,...shadows],driver=new AdaptiveDriver(car.id,new RacingLine(track),.952,.72);
  return {...candidate,kind:'astra',vehicle:host,nativeTrack:track,nativeVehicle:car,controller:driver,errors:0,steps:0,
    step(states,phase){
      // The host invokes every native bridge at the shared 120 Hz cadence,
      // including countdown ticks.  Astra intentionally holds its native
      // vehicle during countdown, but those ticks still belong to the bridge
      // clock (and must remain visible to the common-engine smoke check).
      this.steps++;
      if(phase!=='racing')return;
      states.filter(s=>s.id!==candidate.id).forEach((s,i)=>{
        const c=shadows[i];c.x=s.x;c.z=s.z;c.yaw=s.yaw;c.vx=s.velocity.x;c.vz=s.velocity.z;c.speed=s.speed;
        c.u=c.vx*Math.sin(c.yaw)+c.vz*Math.cos(c.yaw);c.v=c.vx*Math.cos(c.yaw)-c.vz*Math.sin(c.yaw);
        const p=track.nearest(c.x,c.z);c.s=p.s;c.lateral=p.lateral;
      });
      driver.update(car,field,1/120);car.step(1/120,track,wakes(field)[0]);
    },debug(){return {...astraDebug(driver),controllerCadence:'Astra native 120 Hz physics and control'};}
  };
}
