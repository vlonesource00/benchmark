import assert from 'node:assert/strict';
import { Circuit } from '../subjects/gpt-racing/src/simulation/Track.js';
import { Vehicle } from '../subjects/gpt-racing/src/simulation/Vehicle.js';
import { HARBOR_RING } from '../subjects/gpt-racing/src/scenarios/HarborRing.js';
import { makeAstraBridge,makeAstraNative,syncAstraShadow } from '../sandbox/astra-bridge.js';
import { Vehicle as AstraVehicle } from '../subjects/astra/src/sim/vehicle.js';
import { Track } from '../subjects/astra/src/sim/track.js';

const track=new Circuit(HARBOR_RING),nativeTrack=new Track('harbor-ring');
const candidate={id:'astra',label:'Astra',color:'#df482d'},car=new Vehicle({id:'astra',spec:'gt'});
car.resetTo(track,100,2);car.velocity.x=track.atDistance(100).tangent.x*20;car.velocity.z=track.atDistance(100).tangent.z*20;
const shadow=new AstraVehicle();syncAstraShadow(shadow,car,nativeTrack);
assert.ok(Math.abs(shadow.lateral+2)<.05,'host and Astra lateral signs must be opposite');
assert.ok(Math.abs(shadow.speed-20)<1e-6);
const bridge=makeAstraBridge(candidate,car,track,[car]);
for(let i=0;i<1200;i++){
  bridge.step(1/120);assert.ok(Object.values(car.controls).every(Number.isFinite));
  assert.ok(Math.abs(car.controls.steer)<=1&&car.controls.brake>=0&&car.controls.brake<=1);
  car.step(1/120,track,true);
}
assert.ok(car.speed>5);assert.ok(bridge.debug().path.length>0);
const native=makeAstraNative(candidate,car,{distance:100,lateral:2},[candidate]);
const initial=native.nativeVehicle.s;native.step([],'countdown',0);assert.equal(native.nativeVehicle.s,initial);
for(let i=0;i<1200;i++)native.step([],'racing',i/120);
assert.ok(native.nativeVehicle.speed>5);assert.ok(native.debug().path.length>0);
console.log(JSON.stringify({shared:{steps:bridge.steps,speed:car.speed,route:bridge.debug().path.length},native:{steps:native.steps,speed:native.nativeVehicle.speed,route:native.debug().path.length},lateralConvention:'verified',countdownHold:'verified'}));
