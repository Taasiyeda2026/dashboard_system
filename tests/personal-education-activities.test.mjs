import test from 'node:test';
import assert from 'node:assert/strict';
import { educationIdentityFingerprint, isPersonalEducationViewer, withPersonalEducationRoute, PERSONAL_EDUCATION_ROUTE } from '../frontend/src/personal-education-access.js';
import { personalEducationActivitiesScreen, filterEducationActivities, educationListHtml } from '../frontend/src/screens/personal-education-activities.js';

test('ordinary users never receive the personal route or activity reads', async () => {
  const other = {role:'domain_manager',auth_user_id:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',permissions:{view_activities:'yes'}};
  assert.equal(isPersonalEducationViewer(other),false);
  assert.equal(isPersonalEducationViewer({...other,role:'admin'}),false);
  assert.deepEqual(withPersonalEducationRoute(['dashboard','activities',PERSONAL_EDUCATION_ROUTE],other),['dashboard','activities']);
  assert.deepEqual(await personalEducationActivitiesScreen.load({state:{user:other},api:{activities:()=>{throw Error('forbidden read')}}}),{rows:[]});
  assert.match(personalEducationActivitiesScreen.render({rows:[{name:'PRIVATE'}]},{state:{user:other}}),/אין הרשאה/);
  assert.equal(educationIdentityFingerprint('bad'),'');
});

test('personal view filters existing projections and groups without duplicates or extra data', () => {
  const rows = [
    {name:'חלל',school:'בית ספר',authority:'עיר',group:'ה׳',manager:'מנהל',instructors:['מדריכה','מדריך'],status:'פתוח',start:'2026-11-01',end:'2027-01-01',next:'2026-12-01',total:10,elapsed:4,dates:'01/11/2026',price:'SECRET'},
    {name:'רובוטיקה',school:'בית ספר אחר',authority:'עיר',group:'ו׳',manager:'מנהל',instructors:[],status:'סגור',total:null,elapsed:0}
  ];
  assert.equal(filterEducationActivities(rows,{q:'חלל מדריכה'}).length,1);
  assert.equal(filterEducationActivities(rows,{instructor:'מדריך'}).length,1);
  assert.equal(filterEducationActivities(rows,{status:'סגור'}).length,1);
  const html=educationListHtml(rows,'instructor');
  assert.equal((html.match(/class="edu-card"/g)||[]).length,2);
  assert.doesNotMatch(html,/SECRET|אישור ביצוע|תיאום|נוכחות|חריגות/);
  assert.match(html,/4\/10/);
  assert.match(educationListHtml([{...rows[0],name:'<script>test</script>'}]),/&lt;script&gt;/);
});
