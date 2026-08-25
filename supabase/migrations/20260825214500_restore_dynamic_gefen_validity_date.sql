update public.proposal_template_sections
set
  section_body = $$הצעה זו בתוקף עד ליום {{valid_until}}. שריון צוותי ההדרכה, מועדי הפעילות והיקף התוכנית יבוצעו על פי סדר השלמת ההזמנות במערכת הגפ"ן.

כל עוד לא אושרה ההזמנה, השריון אינו מובטח ולאחר תום תוקף ההצעה, תעשיידע רשאית להקצות את הקיבולת לבתי ספר אחרים.$$, 
  updated_at = now()
where template_key = 'gefen'
  and section_key = 'validity';