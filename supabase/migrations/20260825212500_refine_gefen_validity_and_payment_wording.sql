update public.proposal_template_sections
set
  section_body = $$הצעה זו בתוקף עד ליום 17.09.2026. שריון צוותי ההדרכה, מועדי הפעילות והיקף התוכנית יבוצעו על פי סדר השלמת ההזמנות במערכת הגפ"ן.

כל עוד לא אושרה ההזמנה, השריון אינו מובטח ולאחר תום תוקף ההצעה, תעשיידע רשאית להקצות את הקיבולת לבתי ספר אחרים.$$, 
  updated_at = now()
where template_key = 'gefen'
  and section_key = 'validity';

update public.proposal_template_sections
set
  section_body = $$תעשיידע היא מלכ״ר הפטור ממע״מ והמחירים בהצעה הינם סופיים. חשבונית תונפק עבור מפגשים שבוצעו בפועל ודווחו במערכת הגפ״ן.

התשלום יבוצע בהתאם לכללים החלים על הבעלות או הרשות ולהוראות חוק מוסר תשלומים לספקים.$$, 
  updated_at = now()
where template_key = 'gefen'
  and section_key = 'payment_terms';
