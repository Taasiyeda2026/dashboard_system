import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDailyTravelLegs, dailyTravelCancellationMinutes, summarizeDailyTravel,
  dailyTravelReportStatus
} from '../attendance/src/services/daily-travel.js';

test('daily chain deducts 45 minutes only from first and last leg', () => {
  const legs = [{kind:'outbound', minutes:70, kilometers:50},
    {kind:'between', minutes:25, gapMinutes:25, kilometers:15},
    {kind:'return', minutes:65, kilometers:45}];
  assert.equal(dailyTravelCancellationMinutes(legs),70);
  assert.deepEqual(summarizeDailyTravel(legs),
    {complete:true, kilometers:110, cancellationMinutes:70});
});

test('travel chain does not deduct middle legs and requires full report', () => {
  assert.equal(dailyTravelCancellationMinutes([
    {kind:'outbound', minutes:30}, {kind:'between', minutes:5, gapMinutes:5},
    {kind:'return', minutes:38}
  ]),5);
  assert.equal(summarizeDailyTravel([
    {kind:'outbound', minutes:70, kilometers:50},
    {kind:'return', minutes:null, kilometers:45}]).complete,false);
});

test('activity-day route connects activities once instead of roundtrips', () => {
  const activities = [
    {recordId:'a',date:'2026-11-03',startTime:'09:00',endTime:'10:00',
      destinationAddress:'בית ספר א',activityType:'קורס'},
    {recordId:'b',date:'2026-11-03',startTime:'11:00',endTime:'12:00',
      destinationAddress:'בית ספר ב',activityType:'קורס'}
  ];
  const legs = buildDailyTravelLegs(activities);
  assert.deepEqual(legs.map(l=>l.kind),['outbound','between','return']);
  assert.deepEqual(legs.map(l=>[l.from,l.to]),
    [['בית','בית ספר א'],['בית ספר א','בית ספר ב'],['בית ספר ב','בית']]);
  assert.equal(dailyTravelReportStatus(activities,null),'missing');
  assert.equal(dailyTravelReportStatus(activities,{no_travel:true}),'not_required');
  assert.equal(dailyTravelReportStatus(activities,{legs:legs.map(l=>({...l,minutes:50,gapMinutes:l.kind==='between'?60:null,kilometers:20}))}),'reported');
});

test('same-site gap is payable without kilometres; separate outer legs deduct 45 minutes each',()=>{
 const legs=[
   {kind:'outbound',minutes:60,kilometers:31},
   {kind:'between',gapMinutes:40,minutes:0,kilometers:0,sameLocation:true},
   {kind:'return',minutes:70,kilometers:31}
 ];
 assert.deepEqual(summarizeDailyTravel(legs),{
   complete:true,kilometers:62,cancellationMinutes:80
 });
 assert.equal(dailyTravelCancellationMinutes([
   {kind:'outbound',minutes:45},
   {kind:'between',gapMinutes:40},
   {kind:'return',minutes:44}
 ]),40);
 assert.equal(summarizeDailyTravel([
   {kind:'outbound',minutes:60,kilometers:31},
   {kind:'between',gapMinutes:40,sameLocation:false,kilometers:null},
   {kind:'return',minutes:70,kilometers:31}
 ]).complete,false);
});
