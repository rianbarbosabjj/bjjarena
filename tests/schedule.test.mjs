import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCategory, applyCommand, participants } from '../operacao/engine.mjs';
import { initializeOperations, applyOperation, projectSchedule, restForMatch } from '../operations.mjs';

function fixture(){const categories=['a','b'].map((id,i)=>makeCategory({id,title:id,mat:i+1,duration:360,maxWeight:76},[1,2,3,4].map(n=>id+n)));return initializeOperations({draw:{matCount:2},categories,athletes:categories.flatMap(c=>c.athleteIds.map(id=>({id,checkin:'approved'}))),audit:[],revision:0,operations:{startAt:'2026-11-18T12:00:00.000Z',turnaroundSeconds:60}});}
const move=(s,c,m,mat,position)=>applyOperation(s,{type:'move',categoryId:c,matchId:m,mat,position},Date.parse('2026-11-18T12:00:00Z'));
test('moving dependencies across mats cannot create a circular queue',()=>{
 let s=fixture();s=move(s,'a','a-1-0',2,1);
 // Area 1: A semifinal, A semifinal, B final. Area 2: A final, B semis.
 // Both finals would wait on a semifinal blocked behind the other final.
 assert.throws(()=>move(s,'b','b-1-0',1,1),/classificatória/);
 assert.equal(s.categories[1].matches.at(-1).mat,2);
});
test('independent mats start together and later forecasts roll forward with server time',()=>{
 const s=fixture(),now=Date.parse('2026-11-18T12:00:00Z'),a=projectSchedule(s,now),b=projectSchedule(s,now+300000);
 assert.equal(a.rows.find(r=>r.matchId==='a-0-0').startAt,a.rows.find(r=>r.matchId==='b-0-0').startAt);
 assert.equal(b.rows[0].startAt,now+300000);assert.equal(b.rows[1].startAt-a.rows[1].startAt,300000);
});
test('schedule uses the actual end of a bout and does not add rest after W.O.',()=>{
 let s=fixture(),now=Date.parse('2026-11-18T12:00:00Z');const c=s.categories[0],first=c.matches[0];
 s=applyCommand(s,{type:'start',categoryId:c.id,matchId:first.id},now);
 s=applyCommand(s,{type:'result',categoryId:c.id,matchId:first.id,winnerId:participants(c,first)[0],method:'submission',technique:'Armlock'},now+10000);
 const second=s.categories[0].matches[1];s=applyCommand(s,{type:'result',categoryId:c.id,matchId:second.id,winnerId:participants(c,second)[0],method:'wo'},now+20000);
 const category=s.categories[0],final=category.matches.at(-1),rest=restForMatch(s,category,final,now+20000);
 assert.equal(rest.readyAt,now+10000+720000);assert.equal(projectSchedule(s,now+20000).rows.find(r=>r.matchId===final.id).startAt,rest.readyAt);
});
test('legacy aggregates acquire queue configuration without changing clock, results or revision',()=>{
 const s=fixture();delete s.operations;for(const c of s.categories)for(const m of c.matches)delete m.queueOrder;
 const before=structuredClone(s.categories);initializeOperations(s);assert.equal(s.revision,0);assert.equal(s.operations.startAt,null);
 for(const [i,c]of s.categories.entries())for(const [j,m]of c.matches.entries()){assert.deepEqual(m.clock,before[i].matches[j].clock);assert.deepEqual(m.result,before[i].matches[j].result);}
});
