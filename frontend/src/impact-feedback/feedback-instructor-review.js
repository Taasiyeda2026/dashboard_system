/**
 * Optional five-minute instructor deep-review (Hebrew / Arabic).
 * Feedback questions remain untouched. The review is submitted in the same transaction.
 */
export const MAX_INSTRUCTOR_RECOMMENDATIONS = 8;
const AREAS = [
  ['content','תוכן הקורס','محتوى الدورة'],['slides','מצגות ושקופיות','العروض والشرائح'],
  ['activity','פעילויות','الأنشطة'],['structure','סדר המפגשים וזמנים','تسلسل اللقاءات والوقت'],
  ['materials','מערכי שיעור וחומרי הדרכה','خطط الدروس والمواد'],['equipment','ציוד ועזרים','المعدات والوسائل'],
  ['other','נושא אחר','موضوع آخر']
];
const ACTIONS = [
  ['fix','לתקן','تصحيح'],['update','לעדכן','تحديث'],['replace','להחליף','استبدال'],
  ['reorder','לשנות סדר','إعادة ترتيب'],['simplify','לפשט ולהנגיש','تبسيط وتيسير'],
  ['illustrate','להוסיף המחשה','إضافة توضيح'],['engage','להגביר עניין','زيادة التشويق'],
  ['extend','להוסיף או להרחיב','إضافة أو توسيع'],['remove','להסיר','حذف']
];
function escapeHtml(value) {
  return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function blank() {
  return { area:'', meeting:'', reference:'', actions:[], issue:'', recommendation:'', priority:'normal' };
}
export function mountInstructorExtendedReview(container, { language = 'he', initialReview, onChange } = {}) {
  if (!container) return null;
  const ar = language === 'ar';
  const tr = (he,arabic) => ar ? arabic : he;
  const review = {
    opted_in: typeof initialReview?.opted_in === 'boolean' ? initialReview.opted_in : null,
    items: Array.isArray(initialReview?.items) ? initialReview.items.slice(0, MAX_INSTRUCTOR_RECOMMENDATIONS)
      .map((item) => ({ ...blank(), ...(item && typeof item === 'object' ? item : {}), actions: Array.isArray(item?.actions) ? item.actions : [] })) : []
  };
  container.innerHTML = [
    '<section class="ifb-extra-review" aria-labelledby="ifb-extra-title">',
    '<h2 id="ifb-extra-title">',tr('נשמח ללמוד עוד מהניסיון שלך','يسعدنا الاستفادة أكثر من خبرتك'),'</h2>',
    '<p>',tr('הניסיון שלך בהדרכת הקורס חשוב לנו. כל הערה שלך יכולה לסייע לנו לשפר את התכנים, המצגות והפעילויות במחזורים הבאים.',
      'خبرتك في إرشاد الدورة مهمة لنا. كل ملاحظة يمكن أن تساعدنا في تحسين المحتوى والعروض والأنشطة في الدورات القادمة.'),'</p>',
    '<fieldset class="ifb-extra-choice"><legend><strong>',
      tr('האם תהיה מוכן/ה להקדיש כ־5 דקות נוספות להערכה מקצועית מפורטת ולהמלצות לשיפור הקורס؟',
         'هل أنت مستعد/ة لتخصيص نحو 5 دقائق إضافية لتقييم مهني مفصل وتوصيات لتحسين الدورة؟'),
    '</strong></legend>',
    '<label><input type="radio" name="ifb-extra-consent" value="yes"',
      review.opted_in === true ? ' checked' : '', '> ',tr('כן, אשמח לשתף בהמלצות נוספות','نعم، أود تقديم اقتراحات إضافية'),'</label>',
    '<label><input type="radio" name="ifb-extra-consent" value="no"',
      review.opted_in === false ? ' checked' : '', '> ',tr('לא כרגע, ברצוני לסיים את המשוב','ليس الآن، أود إنهاء الاستبيان'),'</label></fieldset>',
    '<div data-review-details',review.opted_in ? '' : ' hidden','><p class="ifb-extra-guidance">',
      tr('אפשר להוסיף כמה המלצות נפרדות. רצוי לציין מפגש, שקופית או פעילות ולתאר מה כדאי לשנות.',
         'يمكنك إضافة عدة اقتراحات منفصلة. يُفضّل ذكر اللقاء أو الشريحة أو النشاط وشرح ما ينبغي تغييره.'),
    '</p><div data-review-items></div>',
    '<button type="button" class="ifb-extra-add" data-review-add>',
      tr('הוספת המלצה נוספת','إضافة اقتراح آخر'),'</button></div>',
    '<p class="ifb-extra-error" role="alert" data-review-error hidden></p></section>'
  ].join('');
  const section = container.querySelector('.ifb-extra-review');
  const details = section.querySelector('[data-review-details]');
  const itemsEl = section.querySelector('[data-review-items]');
  const addBtn = section.querySelector('[data-review-add]');
  const errorEl = section.querySelector('[data-review-error]');
  const notify = () => onChange?.({ opted_in:review.opted_in,
    items:review.items.map((item) => ({...item,actions:[...item.actions]})) });

  function field(idx,name,value,max,caption) {
    return '<label>'+caption+'<input type="text" maxlength="'+max+'" data-review-index="'+idx+
      '" data-review-field="'+name+'" value="'+escapeHtml(value)+'"></label>';
  }
  function textarea(idx,name,value,caption) {
    return '<label>'+caption+'<textarea maxlength="2000" rows="3" data-review-index="'+idx+
      '" data-review-field="'+name+'">'+escapeHtml(value)+'</textarea></label>';
  }
  function render() {
    itemsEl.innerHTML = review.items.map((item,idx) => {
      const options = AREAS.map((c) => '<option value="'+c[0]+'"'+(c[0] === item.area ? ' selected' : '')+
        '>'+(ar?c[2]:c[1])+'</option>').join('');
      const actions = ACTIONS.map((c) => '<label><input type="checkbox" data-review-index="'+idx+
        '" data-review-field="actions" value="'+c[0]+'"'+(item.actions.includes(c[0])?' checked':'')+
        '> '+(ar?c[2]:c[1])+'</label>').join('');
      const priorities = [['normal',tr('שיפור רצוי','تحسين مرغوب')],['high',tr('חשוב לפני המחזור הבא','مهم قبل الدورة القادمة')],
        ['urgent',tr('דחוף — מקשה על ההדרכה','عاجل — يعيق الإرشاد')]]
        .map((c)=>'<option value="'+c[0]+'"'+(item.priority===c[0]?' selected':'')+'>'+c[1]+'</option>').join('');
      return [
        '<fieldset class="ifb-extra-item"><legend><strong>',tr('המלצה','اقتراح'),' ',idx+1,'</strong></legend>',
        '<label>',tr('לאיזה תחום מתייחסת ההערה?','إلى أي مجال تتعلق الملاحظة؟'),
        '<select data-review-index="',idx,'" data-review-field="area"><option value="">',
        tr('בחירת תחום','اختيار المجال'),'</option>',options,'</select></label>',
        '<div class="ifb-extra-two">',
        field(idx,'meeting',item.meeting,60,tr('מספר מפגש (אם ידוע)','رقم اللقاء (إن عُرف)')),
        field(idx,'reference',item.reference,160,tr('שקופית / פעילות / נושא (אם ידוע)','شريحة / نشاط / موضوع (إن عُرف)')),
        '</div><fieldset class="ifb-extra-actions"><legend>',
        tr('מה כדאי לעשות? ניתן לבחור כמה אפשרויות','ما الذي ينبغي فعله؟ يمكن اختيار عدة خيارات'),
        '</legend>',actions,'</fieldset>',
        textarea(idx,'issue',item.issue,tr('מה זיהית בפועל? מה דורש שיפור?','ما الذي لاحظته فعليًا؟ ما الذي يحتاج لتحسين؟')),
        textarea(idx,'recommendation',item.recommendation,tr('מה היית ממליץ/ה לעשות אחרת؟','ما الذي تقترح فعله بشكل مختلف؟')),
        '<label>',tr('חשיבות השינוי','أهمية التغيير'),'<select data-review-index="',idx,
        '" data-review-field="priority">',priorities,'</select></label>',
        review.items.length>1 ? '<button type="button" class="ifb-extra-remove" data-review-remove="'+idx+'">'+
          tr('הסרת המלצה זו','حذف هذا الاقتراح')+'</button>' : '',
        '</fieldset>'
      ].join('');
    }).join('');
    addBtn.hidden = review.items.length >= MAX_INSTRUCTOR_RECOMMENDATIONS;
    addBtn.disabled = addBtn.hidden;
  }
  section.addEventListener('change',(event) => {
    const input = event.target;
    if (input.name === 'ifb-extra-consent') {
      review.opted_in = input.value === 'yes';
      if (review.opted_in && !review.items.length) review.items.push(blank());
      details.hidden = !review.opted_in;
      errorEl.hidden = true; render(); notify(); return;
    }
    const idx = Number(input.dataset.reviewIndex);
    const name = input.dataset.reviewField;
    if (!name || !review.items[idx]) return;
    if (name === 'actions') {
      const set = new Set(review.items[idx].actions);
      if (input.checked) set.add(input.value); else set.delete(input.value);
      review.items[idx].actions = [...set];
    } else review.items[idx][name] = input.value;
    errorEl.hidden = true; notify();
  });
  section.addEventListener('input',(event) => {
    const input = event.target;
    const name = input.dataset.reviewField;
    if (!['meeting','reference','issue','recommendation'].includes(name)) return;
    const item = review.items[Number(input.dataset.reviewIndex)];
    if (!item) return;
    item[name] = input.value; errorEl.hidden = true; notify();
  });
  section.addEventListener('click',(event) => {
    if (event.target.closest('[data-review-add]')) {
      if (review.items.length >= MAX_INSTRUCTOR_RECOMMENDATIONS) return;
      review.items.push(blank()); render(); notify(); return;
    }
    const remove = event.target.closest('[data-review-remove]');
    if (remove) { review.items.splice(Number(remove.dataset.reviewRemove),1); render(); notify(); }
  });
  if (review.opted_in && !review.items.length) review.items.push(blank());
  render();
  return {
    getReview: () => ({ opted_in:review.opted_in, items:review.opted_in ? review.items.map((item)=>({
      ...item,actions:[...item.actions]
    })) : [] }),
    validate: () => {
      let message = '';
      if (typeof review.opted_in !== 'boolean')
        message = tr('יש לבחור אם ברצונך להרחיב את המשוב.','يرجى تحديد ما إذا كنت تريد/ين توسيع الاستبيان.');
      else if (review.opted_in && (!review.items.length || review.items.some((item) =>
        !item.area || !item.actions.length || !item.issue.trim() || !item.recommendation.trim())))
        message = tr('בכל המלצה יש לבחור תחום ופעולה ולתאר את הבעיה והפתרון המוצע.',
          'يرجى تحديد المجال والإجراء ووصف المشكلة والحل المقترح لكل اقتراح.');
      if (!message) return true;
      errorEl.textContent = message; errorEl.hidden = false;
      section.scrollIntoView({behavior:'smooth',block:'center'});
      return false;
    }
  };
}
