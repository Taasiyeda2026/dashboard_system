import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultGefenCourseRate,isGefenFundingName,coursePriceFromRate,agreedCourseRate,gefenSlotGross} from '../frontend/src/course-hourly-pricing.js';
test('approved catalog defaults and distinct Ofek identities',()=>{
  for (const [code,rate] of Object.entries({'6089':600,'57651':630,'9545':640,'53819':630,'27342':550,'57646':640,'67867':640})) assert.equal(defaultGefenCourseRate({activity_no:code}),rate);
  assert.equal(defaultGefenCourseRate({activity_no:'52279',activity_name:'אופק פרימיום',program_name:'פורצות דרך'}),575);
  assert.equal(defaultGefenCourseRate({activity_no:'52279',activity_name:'אופק יזמות פרימיום לתעשייה'}),640);
  assert.equal(defaultGefenCourseRate({activity_no:'52279'}),null);
  assert.equal(defaultGefenCourseRate({activity_no:'52279',activity_name:'אופק פרימיום',program_name:'בינה מלאכותית'}),null);
  assert.equal(defaultGefenCourseRate({activity_no:'3604'}),null);
});
test('funding detection is independent from catalog/order presence',()=>{
  assert.equal(isGefenFundingName('גפ״ן'),true);
  assert.equal(isGefenFundingName('גפן'),true);
  assert.equal(isGefenFundingName('רשות'),false);
});
test('rate and meeting count recalculate price without silent shekel rounding',()=>{
  assert.equal(coursePriceFromRate(630,16),15120);
  assert.equal(coursePriceFromRate(630,12),11340);
  assert.equal(coursePriceFromRate(575,1),null);
  assert.equal(coursePriceFromRate(0,12),null);
  assert.equal(coursePriceFromRate(600,0),null);
  assert.equal(coursePriceFromRate(600,36),null);
  assert.equal(coursePriceFromRate(agreedCourseRate(8000,10),10),8000);
});
test('Gefen charges full rate until funding cap, including partial last slot',()=>{
  assert.deepEqual([1,2,3,4].map(i=>gefenSlotGross(600,2000,i)),[900,900,200,0]);
  assert.equal([1,2,3,4].reduce((s,i)=>s+gefenSlotGross(600,2000,i),0),2000);
});
