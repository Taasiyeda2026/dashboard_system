import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDailyTravelLegs, dailyTravelCancellationMinutes, summarizeDailyTravel,
  dailyTravelReportStatus
} from '../attendance/src/services/daily-travel.js';

test('daily chain deducts 40 minutes only from first and last leg', () => {
  const legs = [{kind:'outbound', minutes:70, kilometers:50},
    {kind:'between', minutes:25, kilometers:15},
    {kind:'return', minutes:65, kilometers:45}];
  assert.equal(dailyTravelCancellationMinutes(legs),80);
  assert.deepEqual(summarizeDailyTravel(legs),
    {complete:true, kilometers:110, cancellationMinutes:80});
});

test('travel chain does not deduct middle legs and requires full report', () => {
  assert.equal(dailyTravelCancellationMinutes([
    {kind:'outbound', minutes:30}, {kind:'between', minutes:5},
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
  assert.equal(dailyTravelReportStatus(activities,{legs:legs.map(l=>({...l,minutes:50,kilometers:20}))}),'reported');
});
