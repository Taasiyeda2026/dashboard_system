import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultGefenCourseRate,isGefenFundingName,coursePriceFromRate,agreedCourseRate,gefenSlotGross,courseFormPricing} from '../frontend/src/course-hourly-pricing.js';
test('approved catalog defaults and distinct Ofek identities',()=>{
  for (const [code,rate] of Object.entries({'6089':600,'57651':630,'9545':640,'53819':630,'27342':550,'57646':640,'67867':640})) assert.equal(defaultGefenCourseRate({activity_no:code}),rate);
  assert.equal(defaultGefenCourseRate({activity_no:'52279',activity_name:'אופק פרימיום',program_name:'פורצות דרך'}),575);
  assert.equal(defaultGefenCourseRate({activity_no:'52279',activity_name:'אופק יזמות פרימיום לתעשייה'}),640);
  assert.equal(defaultGefenCourseRate({activity_no:'52279'}),null);
  assert.equal(defaultGefenCourseRate({activity_no:'52279',activity_name:'אופק פרימיום',program_name:'בינה מלאכותית'}),null);
  assert.equal(defaultGefenCourseRate({activity_no:'3604'}),null);
  assert.equal(defaultGefenCourseRate({activity_no:'3604',activity_name:'פורצות דרך'}),575);
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

test('proposal conversion preserves exact quoted rate, agreed total and hours',()=>{
  const hours={textContent:''};
  const host={hidden:false,querySelector:()=>hours};
  const rate={value:'633.3333',dataset:{rateSource:'proposal',originalRate:'633.3333',originalSessions:'10',originalPrice:'9500',proposalHours:'15'},closest:()=>host,setCustomValidity(message){this.validation=message;}};
  const price={value:'9500',readOnly:false};
  const sessions={value:'10'};
  const type={value:'course'};
  const fields={'[name="course_hourly_rate"]':rate,'[name="price"]':price,'[name="sessions"]':sessions,'[name="activity_type"]':type,'[name="activity_name"]':{value:'טכנולוגיות החלל'},'[name="gefen_number"]':{value:'57651'},'select[name="funding_sources"]':{selectedOptions:[{textContent:'גפן'}]}};
  const form={querySelector:key=>fields[key]||null,querySelectorAll:()=>[]};
  const result=courseFormPricing(form,{applyDefault:true});
  assert.equal(result.preserved,true);
  assert.equal(result.valid,true);
  assert.equal(rate.value,'633.3333');
  assert.equal(price.value,'9500');
  assert.equal(hours.textContent,'15');
  assert.equal(price.readOnly,true);
  // Explicit rate edit recomputes rather than silently applying catalog default.
  rate.value='640';
  assert.equal(courseFormPricing(form).total,9600);
  assert.equal(price.value,'9600');
  // Reverting to the original rate restores the original agreement.
  rate.value='633.3333';
  assert.equal(courseFormPricing(form).total,9500);
});
test('proposal with nonstandard original hours retains its original agreement',()=>{
  const hours={textContent:''};
  const host={querySelector:()=>hours};
  const rate={value:'500',dataset:{rateSource:'proposal',originalRate:'500',originalSessions:'12',originalPrice:'12000',proposalHours:'24'},closest:()=>host,setCustomValidity(){}};
  const price={value:'12000'};
  const fields={'[name="course_hourly_rate"]':rate,'[name="price"]':price,'[name="sessions"]':{value:'12'},'[name="activity_type"]':{value:'course'}};
  const form={querySelector:key=>fields[key]||null,querySelectorAll:()=>[]};
  assert.equal(courseFormPricing(form).total,12000);
  assert.equal(hours.textContent,'24');
});
