import { Circuit as GPTCircuit } from '../subjects/gpt-racing/src/simulation/Track.js';
import { Vehicle as GPTVehicle } from '../subjects/gpt-racing/src/simulation/Vehicle.js';
import { AIRaceDirector } from '../subjects/gpt-racing/src/ai/AIRaceDirector.js';
import { updateAerodynamicWakes as gptWakes } from '../subjects/gpt-racing/src/simulation/VehicleInteractions.js';
import { HARBOR_RING } from '../subjects/gpt-racing/src/scenarios/HarborRing.js';
import { Circuit as NmpccCircuit } from '../subjects/gemini-nmpcc/src/simulation/Track.js';
import { Vehicle as NmpccVehicle } from '../subjects/gemini-nmpcc/src/simulation/Vehicle.js';
import { NextGenAIController as NmpccController } from '../subjects/gemini-nmpcc/src/ai/v2/NextGenAIController.js';
import { updateAerodynamicWakes as nmpccWakes } from '../subjects/gemini-nmpcc/src/simulation/VehicleInteractions.js';
import { Circuit as GPCircuit } from '../subjects/gemini-grand-prix/src/simulation/Track.js';
import { Vehicle as GPVehicle } from '../subjects/gemini-grand-prix/src/simulation/Vehicle.js';
import { NextGenAIController as GPController } from '../subjects/gemini-grand-prix/src/ai/v2/NextGenAIController.js';
import { updateAerodynamicWakes as gpWakes } from '../subjects/gemini-grand-prix/src/simulation/VehicleInteractions.js';
import { Circuit as ClaudeCircuit } from '../subjects/claude-racing/src/sim/Track.js';
import { Race as ClaudeRace } from '../subjects/claude-racing/src/sim/Race.js';
import { TrackGrid } from '../subjects/claude-racing/src/sim/TrackGrid.js';
import { cloneSpec } from '../subjects/claude-racing/src/sim/CarSpecs.js';
import { Pilot } from '../subjects/claude-racing/src/ai/Pilot.js';
import { PlanBudget } from '../subjects/claude-racing/src/ai/Scheduler.js';
import { HARBOR_RING as CLAUDE_HARBOR_RING } from '../subjects/claude-racing/src/scenarios/HarborRing.js';
import line from '../subjects/claude-racing/public/lines/harbor-ring-gt.json' with { type: 'json' };

const DT=1/120, CDT=1/400, SECONDS=40;
function standard(name,Circuit,Vehicle,Controller,wakes,gpt=false){
  const track=new Circuit(HARBOR_RING), car=new Vehicle({id:name,name,color:'#fff',player:false,spec:'gt'}); car.resetTo(track,track.length-18,0);
  const controller=gpt?new Controller({track,vehicles:[car]}):new Controller(1,{track,skill:.96,aggression:.9}); controller.setDebugEnabled?.(true);
  let maxSpeed=0,maxBrake=0,maxOff=0,steps=0;
  return {name,hz:120,step(t){const race={phase:t<4?'countdown':'racing',raceTime:Math.max(0,t-4),elapsed:t,entries:new Map([[car.id,{lap:0,unwrappedDistance:car.distance}]])};if(gpt){const cmd=controller.step({vehicles:[car],track,race,dt:DT});controller.apply(cmd,{vehicles:[car],track});}else controller.update(car,[car],track,race,DT);wakes([car]);car.step(DT,track,t>=4);const surf=track.surfaceAt(car.position.x,car.position.z);maxSpeed=Math.max(maxSpeed,car.speed);maxBrake=Math.max(maxBrake,car.controls.brake);maxOff=Math.max(maxOff,Math.max(0,Math.abs(surf.lateral)-track.roadHalfWidth-track.curbWidth));steps++;},result(){return{name,hz:120,steps,maxSpeed:+maxSpeed.toFixed(2),maxBrake:+maxBrake.toFixed(2),maxOff:+maxOff.toFixed(2)}}};
}
function claude(){const track=new ClaudeCircuit({scenario:CLAUDE_HARBOR_RING}),grid=new TrackGrid(track,cloneSpec('gt'),{solution:line}),race=new ClaudeRace(track,{entries:[{classId:'gt',spec:cloneSpec('gt'),name:'Claude',isPlayer:false,tint:'#fff'}],laps:4,countdown:4}),pilot=new Pilot(race.cars[0],grid,{field:race.cars,budget:new PlanBudget(1),skill:.96,aggression:.72});race.setDriver(0,pilot);let maxSpeed=0,maxBrake=0,maxOff=0,steps=0;return{name:'Claude',hz:400,step(){race.step(CDT);const car=race.cars[0];maxSpeed=Math.max(maxSpeed,car.speed);maxBrake=Math.max(maxBrake,car.controls.brake);maxOff=Math.max(maxOff,car.offTrack);steps++;},result(){return{name:'Claude',hz:400,steps,maxSpeed:+maxSpeed.toFixed(2),maxBrake:+maxBrake.toFixed(2),maxOff:+maxOff.toFixed(2)}}};}
const engines=[standard('GPT',GPTCircuit,GPTVehicle,AIRaceDirector,gptWakes,true),claude(),standard('Gemini NMPCC',NmpccCircuit,NmpccVehicle,NmpccController,nmpccWakes),standard('Gemini GP',GPCircuit,GPVehicle,GPController,gpWakes)];
let ca=0;for(let i=0;i<SECONDS/DT;i++){const t=i*DT;for(const e of engines)if(e.hz===120)e.step(t);ca+=DT;while(ca+1e-10>=CDT){engines[1].step();ca-=CDT;}}
const results=engines.map(e=>e.result());for(const r of results){if(r.steps!==r.hz*SECONDS)throw new Error(`${r.name}: wrong native step count ${r.steps}`);if(r.maxSpeed<20)throw new Error(`${r.name}: never reached racing speed`);if(r.maxBrake<.25)throw new Error(`${r.name}: native controller never braked`);}
console.log(JSON.stringify({status:'native-engine-clocks-passed',seconds:SECONDS,results},null,2));
