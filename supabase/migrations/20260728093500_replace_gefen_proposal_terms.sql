-- Replace the active GEFEN proposal terms with the approved wording.

update public.proposal_template_sections
set section_title = 'תוקף ההצעה וזמינות הפעילות',
    section_body = E' הצעה זו בתוקף עד ליום {{valid_until}}.\n שריון צוותי ההדרכה, מועדי הפעילות והיקף התוכנית יבוצע בהתאם לסדר השלמת הזמנות העבודה במערכת גפ״ן.\n כל עוד הזמנת העבודה לא אושרה, השריון אינו מובטח. לאחר תום תוקף ההצעה, תעשיידע תהיה רשאית להקצות את הקיבולת לבתי ספר אחרים.',
    updated_at = now()
where template_key = 'gefen'
  and section_key = 'validity';

update public.proposal_template_sections
set section_title = 'תיאום והפעלת הפעילות',
    section_body = E' מינוי איש קשר לתיאום הפעילות ולקשר שוטף עם תעשיידע.\n נוכחות איש צוות חינוכי מטעם בית הספר בכל המפגשים\n עדכון מראש על כל שינוי במועדי הפעילות או בלוחות הזמנים.\n העמדת כיתה מתאימה וציוד בסיסי: מקרן, לוח וחיבור תקין לאינטרנט.\n בית הספר יפתח הזמנה במערכת גפ״ן בהתאם לפרטי הצעה זו.',
    updated_at = now()
where template_key = 'gefen'
  and section_key = 'school_responsibility';

update public.proposal_template_sections
set section_title = 'אחריות תעשיידע',
    section_body = E' הפעלת התוכנית בהתאם לסילבוס המאושר ולפרטי ההזמנה במערכת גפ״ן.\n העמדת צוותי הדרכה מקצועיים, חומרי הדרכה ופעילות וליווי מקצועי שוטף.\n תיאום שוטף ודיווח על המפגשים במערכת הספקים לאורך תקופת הפעילות.',
    updated_at = now()
where template_key = 'gefen'
  and section_key = 'taasiyeda_responsibility';

update public.proposal_template_sections
set section_title = 'תנאי תשלום',
    section_body = E' תעשיידע היא מלכ״ר הפטור ממע״מ. המחירים המפורטים בהצעה הם סופיים.\n חשבונית תונפק בגין מפגשים שבוצעו בפועל ודווחו במערכת גפ״ן.\n התשלום יבוצע בהתאם לכללים החלים על הבעלות או הרשות ובכפוף להוראות חוק מוסר תשלומים לספקים, התשע״ז–2017.',
    updated_at = now()
where template_key = 'gefen'
  and section_key = 'payment_terms';

update public.proposal_template_sections
set section_title = 'שינויים, ביטולים והפחתת היקף',
    section_body = E' בקשה לשינוי או לדחיית מועד תימסר מוקדם ככל האפשר ורצוי לפחות 3 ימי עבודה מראש.\n ביטול או שינוי שנמסרו פחות מ-48 שעות לפני המפגש יחייבו אישור בכתב של מנהל/ת בית הספר ויטופלו בתיאום בין הצדדים.\n הפסקת תוכנית לאחר תחילת הפעילות ייעשו בהודעה בכתב לפחות 30 ימים מראש.\n בתקופת ההודעה המוקדמת יישא בית הספר בתשלום עבור פעילויות שבוצעו או שתוכננו לתקופה זו, בהתאם להזמנת העבודה המאושרת ולהוראות גפ״ן.\n במקרה של מצב חירום יתואם בהתאם להוראות גפ״ן מתווה חלופי, לרבות דחייה, התאמה או מעבר לפעילות מקוונת. פעילות מקוונת תתומחר לפי תעריף גפ״ן, בהפחתה של 10% ככל שנדרש.\n במקרה של סתירה בין הצעה זו לבין הוראות גפ״ן או הזמנת העבודה המאושרת במערכת, יגברו הוראות גפ״ן והזמנת העבודה המאושרת.',
    updated_at = now()
where template_key = 'gefen'
  and section_key = 'cancellation_terms';

delete from public.proposal_template_sections
where template_key = 'gefen'
  and section_key = 'precedence';
