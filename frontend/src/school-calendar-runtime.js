import { loadSchoolCalendarRows } from './screens/shared/school-calendar-data.js';
import { startSchoolCalendarUi } from './screens/shared/school-calendar-ui.js';
import { startSchoolCalendarFormGuard } from './screens/shared/school-calendar-form-guard.js';

startSchoolCalendarUi();
startSchoolCalendarFormGuard();
void loadSchoolCalendarRows();
